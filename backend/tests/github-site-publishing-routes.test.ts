import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createGitHubPublishingRouter, type GitHubPublishingOptions } from "../../server/site-publishing/github-service.js";
import { GitHubApi, GitHubApiError } from "../../server/site-publishing/github-api.js";
import { GitHubPublishingStore } from "../../server/site-publishing/github-store.js";
import { createSitePublishDraft, buildSiteExportRequest } from "../../src/features/site-publishing/model.js";
import type { GitHubPublishingStatus } from "../../src/features/site-publishing/github-model.js";
import { createFakeGitHub, siteEntries } from "./fixtures/github-publishing.js";
import { LocalSitePublisher } from "../../server/site-publishing/local-site.js";
import { load } from "cheerio";

async function fixture(overrides: Partial<GitHubPublishingOptions> = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-github-routes-"));
  const github = createFakeGitHub();
  github.fake.installations = [{ id: github.repository.installationId, appId: github.config.appId,
    repositories: [{ id: github.repository.id, name: github.repository.name, owner: { login: github.repository.owner }, permissions: { push: true } }] }];
  github.fake.hooks.beforeRefUpdate = ({ sha }) => { github.fake.buildOnRequest = { commit: sha, status: "built" }; };
  const app = express(); app.use(express.json({ limit: "8mb" }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const base = origin + "/api/site-publishing/github";
  const config = { ...github.config, callbackUrl: base + "/callback" };
  const api = new GitHubApi(config, github.fake.fetchImpl);
  if (overrides.localSitePublisher) app.use("/notes", overrides.localSitePublisher.router());
  app.use("/api/site-publishing/github", await createGitHubPublishingRouter({
    dataDirectory: directory, rootDirectory: process.cwd(), imagesDirectory: directory, publicDirectory: path.join(process.cwd(), "public"),
    getUser: async (request, response) => { const id = request.get("x-test-user"); if (id) return { id }; response.status(401).json({ error: "login required" }); return null; },
    isSameOrigin: (request) => !request.get("origin") || request.get("origin") === origin,
    publicOrigin: () => origin, config, api, pollMs: 1, timeoutMs: 90_000,
    build: async () => siteEntries({ "index.html": "<h1>Site</h1>" }), ...overrides,
  }));
  const store = new GitHubPublishingStore(directory, config.tokenKey);
  async function request(endpoint: string, options: { actor?: string | null; method?: string; data?: unknown; cookie?: string; origin?: string; expectedRepositoryId?: string | null } = {}) {
    return fetch(base + endpoint, { method: options.method || "GET", redirect: "manual", headers: {
      ...(options.actor === null ? {} : { "x-test-user": options.actor || "alice" }),
      ...(options.data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(endpoint === "/publish" && options.expectedRepositoryId !== null ? { "X-Notes-GitHub-Repository-Id": options.expectedRepositoryId ?? String(github.repository.id) } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.origin ? { Origin: options.origin } : {}),
    }, body: options.data === undefined ? undefined : JSON.stringify(options.data) });
  }
  async function seed(owner = "alice") {
    await store.update(owner, () => ({ connection: { user: github.fake.user, tokens: store.seal(owner, { accessToken: "fake-user-token" }) }, repository: github.repository }));
  }
  async function waitJob(owner = "alice") {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const status = await (await request("/status", { actor: owner })).json() as GitHubPublishingStatus;
      if (status.job && ["published", "failed", "interrupted"].includes(status.job.phase)) return status.job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("job wait timed out");
  }
  return { ...github, api, origin, base, store, request, seed, waitJob, async close() {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  } };
}
function payload(id = "note-a", body = "# 发布内容\n\n正文") {
  const draft = createSitePublishDraft();
  // 这条端到端用例保留仓库站点根路径的既有预期；新草稿默认 /notes/ 由模型与 Hugo 集成测试覆盖。
  draft.settings.basePath = "/";
  draft.selections = [{ noteId: id, categoryId: "guides" }];
  return buildSiteExportRequest(draft, [{ id, markdown: body, createdAt: 1, updatedAt: 1, normalOrder: 0, folderId: null, pinnedAt: null, isStarred: false, deletedAt: null }]);
}
function cookie(response: Response) { return response.headers.getSetCookie().at(-1)!.split(";")[0]; }

test("GitHub succeeds before a separately rebased Hugo site is published anonymously on this deployment", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-local-hugo-"));
  const publisher = new LocalSitePublisher(directory, "alice");
  const f = await fixture({ localSitePublisher: publisher, build: undefined });
  try {
    await f.seed();
    const before = await (await f.request("/status")).json() as GitHubPublishingStatus;
    assert.equal(before.localSiteEnabled, true);
    assert.equal((await fetch(f.origin + "/notes/")).status, 404);
    const started = await f.request("/publish", { method: "POST", data: payload("note-a", "# Dual site\n\nPUBLIC_LOCAL_MARKER") });
    assert.equal(started.status, 202);
    const initial = (await started.json()).job;
    assert.equal(initial.localSite.phase, "pending");
    assert.equal(initial.localSite.url, f.origin + "/notes/");
    const job = await f.waitJob();
    assert.equal(job.phase, "published"); assert.equal(job.localSite?.phase, "published");
    assert.match(job.siteUrl!, /github\.io\/notes-site\/$/);
    const response = await fetch(f.origin + "/notes/");
    assert.equal(response.status, 200);
    const home = load(await response.text());
    assert.equal(home("link[rel=canonical]").attr("href"), f.origin + "/notes/");
    assert.equal(home(".site-brand").attr("href"), "/notes/");
    assert.equal((await fetch(f.origin + "/notes/logo.png")).status, 200);
    const search = await (await fetch(f.origin + "/notes/index.json")).json() as { pages: Array<{ permalink: string }> };
    assert.equal(search.pages.length, 1); assert.ok(search.pages[0].permalink.startsWith("/notes/"));
    const article = await fetch(new URL(search.pages[0].permalink, f.origin));
    assert.equal(article.status, 200); assert.match(await article.text(), /PUBLIC_LOCAL_MARKER/);
    assert.equal((await fetch(f.origin + "/notes/missing.js")).status, 404);
    // A different Notes account follows the normal GitHub ownership checks,
    // without receiving local hosting privileges or replacing this website.
    await f.seed("bob");
    assert.equal((await (await f.request("/status", { actor: "bob" })).json()).localSiteEnabled, undefined);
    const localPointer = await fs.readFile(path.join(directory, "current.json"), "utf8");
    assert.equal((await f.request("/publish", { actor: "bob", method: "POST", data: payload("bob-note", "OTHER_ACCOUNT_MARKER") })).status, 202);
    assert.equal((await f.waitJob("bob")).localSite, undefined);
    assert.equal(await fs.readFile(path.join(directory, "current.json"), "utf8"), localPointer);
  } finally { await f.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("local failure preserves GitHub success and previous files, and unchanged GitHub content can retry the local update", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-local-retry-"));
  const publisher = new LocalSitePublisher(directory, "alice");
  await publisher.publish("alice", siteEntries({ "index.html": "PREVIOUS_LOCAL_VERSION" }), new AbortController().signal);
  let failLocal = true;
  const settingsSeen: string[] = [];
  const f = await fixture({ localSitePublisher: publisher, build: async (request) => {
    settingsSeen.push(request.settings.basePath);
    if (request.settings.basePath === "/notes/" && failLocal) throw new Error("synthetic local build failure");
    return siteEntries({ "index.html": "UPDATED_SITE" });
  } });
  try {
    await f.seed();
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const failedLocal = await f.waitJob();
    assert.equal(failedLocal.phase, "published"); assert.equal(failedLocal.localSite?.phase, "failed");
    assert.ok(failedLocal.commitSha); assert.match(failedLocal.message, /GitHub Pages 已发布/);
    assert.equal(await (await fetch(f.origin + "/notes/")).text(), "PREVIOUS_LOCAL_VERSION");
    failLocal = false;
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const retried = await f.waitJob();
    assert.equal(retried.phase, "published"); assert.equal(retried.localSite?.phase, "published");
    assert.equal(retried.commitSha, failedLocal.commitSha);
    assert.equal(await (await fetch(f.origin + "/notes/")).text(), "UPDATED_SITE");
    assert.deepEqual(settingsSeen, ["/notes-site/", "/notes/", "/notes-site/", "/notes/"]);
  } finally { await f.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("failed GitHub publication never activates a local version", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "notes-local-github-failed-"));
  const publisher = new LocalSitePublisher(directory, "alice");
  await publisher.publish("alice", siteEntries({ "index.html": "PREVIOUS" }), new AbortController().signal);
  const f = await fixture({ localSitePublisher: publisher, build: async () => { throw new Error("synthetic GitHub build failure"); } });
  try {
    await f.seed();
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const job = await f.waitJob();
    assert.equal(job.phase, "failed"); assert.equal(job.localSite?.phase, "failed");
    assert.equal(await (await fetch(f.origin + "/notes/")).text(), "PREVIOUS");
  } finally { await f.close(); await fs.rm(directory, { recursive: true, force: true }); }
});

test("GitHub 发布 API 只接受当前网页登录账号、拒绝跨站，未配置时仍能读取状态", async () => {
  const f = await fixture({ config: null, api: undefined });
  try {
    for (const endpoint of ["/status", "/repositories"]) assert.equal((await f.request(endpoint, { actor: null })).status, 401);
    assert.equal((await f.request("/connect", { method: "POST", origin: "https://evil.example" })).status, 403);
    const response = await f.request("/status"); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { enabled: false, connected: false, repository: null, job: null });
    assert.equal((await f.request("/connect", { method: "POST" })).status, 503);
  } finally { await f.close(); }
});

test("GitHub 安装回调以单次 state + Cookie + Notes 账号和 PKCE 完成授权，不能靠 installation_id 冒认仓库", async () => {
  const f = await fixture();
  try {
    const start = await f.request("/connect", { method: "POST" });
    const install = new URL((await start.json()).url);
    assert.equal(install.hostname, "github.com");
    const installationState = install.searchParams.get("state")!;
    const query = `/callback?state=${installationState}&installation_id=999999`;
    // state 不能跨账号使用，不能缺少浏览器 Cookie。
    assert.match((await f.request(query, { actor: "bob", cookie: cookie(start) })).headers.get("location")!, /githubPublish=error/);
    assert.match((await f.request(query)).headers.get("location")!, /githubPublish=error/);
    const setup = await f.request(query, { cookie: cookie(start) });
    const oauth = new URL(setup.headers.get("location")!);
    assert.equal(oauth.pathname, "/login/oauth/authorize");
    assert.equal(oauth.searchParams.get("code_challenge_method"), "S256");
    const oauthState = oauth.searchParams.get("state")!;
    const callback = `/callback?state=${oauthState}&code=fake-code`;
    const finish = await f.request(callback, { cookie: cookie(setup) });
    assert.match(finish.headers.get("location")!, /githubPublish=connected/);
    const tokenCall = f.fake.calls.find((call) => call.path === "/login/oauth/access_token")!;
    const fields = tokenCall.body as { code_verifier: string; client_secret: string };
    assert.equal(createHash("sha256").update(fields.code_verifier).digest("base64url"), oauth.searchParams.get("code_challenge"));
    assert.ok(fields.client_secret);
    const status = await (await f.request("/status")).json();
    assert.equal(status.connected, true); assert.equal(status.githubLogin, "octo");
    assert.equal(JSON.stringify(status).includes("token"), false);
    const replay = await f.request(callback, { cookie: cookie(setup) });
    assert.match(replay.headers.get("location")!, /githubPublish=error/);
    assert.equal(f.fake.calls.filter((call) => call.path === "/login/oauth/access_token").length, 1);
    assert.equal((await f.request("/repository", { method: "PUT", data: { repositoryId: 999999, installationId: 999999 } })).status, 403);
    assert.equal((await f.request("/repository", { method: "PUT", data: { repositoryId: f.repository.id, installationId: f.repository.installationId, owner: "evil" } })).status, 200);
    const bound = await (await f.request("/status")).json(); assert.equal(bound.repository.owner, f.repository.owner);
    assert.equal((await (await f.request("/status", { actor: "bob" })).json()).connected, false);
  } finally { await f.close(); }
});

test("完整服务器流程用真实 Hugo 构建 gh-pages，重复发布无上传/提交，移除便签删除旧页面，主分支不变", async () => {
  const f = await fixture({ build: undefined });
  try {
    await f.seed(); const main = f.fake.branchHead("main");
    const first = await f.request("/publish", { method: "POST", data: payload() }); assert.equal(first.status, 202);
    const published = await f.waitJob(); assert.equal(published.phase, "published", published.message);
    assert.match(published.siteUrl!, /^https:\/\/octo.github.io\/notes-site\/$/);
    assert.ok(f.fake.branchFile("gh-pages", "index.html"));
    assert.ok(f.fake.branchFile("gh-pages", ".nojekyll"));
    // Pages 首次配置由用户交集 Token 承担管理权限，不提升普通写入者的权限。
    const pagesCreation = f.fake.calls.find((call) => call.method === "POST" && call.path.endsWith("/pages"))!;
    assert.equal(pagesCreation.headers.get("authorization"), "Bearer fake-user-token");
    const contentUpload = f.fake.calls.find((call) => call.method === "POST" && call.path.endsWith("/git/blobs"))!;
    assert.equal(contentUpload.headers.get("authorization"), `Bearer ${f.fake.installationAccessToken}`);
    assert.equal(f.fake.branchFile("gh-pages", ".github/workflows/pages.yml"), undefined);
    const originalPages = Object.keys(f.fake.branchFiles("gh-pages")).filter((name) => /\/p-.*\/index.html$/.test(name));
    assert.equal(originalPages.length, 1);
    const before = f.fake.calls.length;
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const same = await f.waitJob(); assert.equal(same.phase, "published", same.message);
    assert.equal(same.commitSha, published.commitSha); assert.equal(same.counts?.uploaded, 0);
    assert.equal(f.fake.calls.slice(before).some((call) => call.method === "POST" && /\/git\/(blobs|trees|commits)$/.test(call.path)), false);
    assert.equal((await f.request("/publish", { method: "POST", data: payload("note-new", "# 新便签\n\n内容更新") })).status, 202);
    const updated = await f.waitJob(); assert.equal(updated.phase, "published", updated.message);
    assert.ok(updated.counts!.deleted > 0); assert.equal(f.fake.branchFile("gh-pages", originalPages[0]), undefined);
    assert.equal(f.fake.branchHead("main"), main);
    assert.equal(f.fake.calls.some((call) => ["POST", "PATCH", "PUT", "DELETE"].includes(call.method) && /refs\/heads\/main$/.test(call.path)), false);
    const privateAccount = await f.store.get("alice"); assert.ok(privateAccount.connection?.tokens); assert.equal(JSON.stringify(await (await f.request("/status")).json()).includes(privateAccount.connection.tokens), false);
  } finally { await f.close(); }
});

test("发布期间重复请求、换仓库和断开连接被拒绝；同仓库锁不会被其他账号的失败请求释放", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = await fixture({ build: async () => { await gate; return siteEntries({ "index.html": "Test" }); } });
  try {
    await f.seed("alice"); await f.seed("bob"); await f.seed("carol");
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 429);
    for (const actor of ["bob", "carol"]) assert.equal((await f.request("/publish", { actor, method: "POST", data: payload() })).status, 429);
    assert.equal((await f.request("/connection", { method: "DELETE" })).status, 409);
    assert.equal((await f.request("/repository", { method: "PUT", data: { repositoryId: f.repository.id, installationId: f.repository.installationId } })).status, 409);
    release(); assert.equal((await f.waitJob()).phase, "published");
  } finally { release(); await f.close(); }
});

test("仓库授权撤销后后台失败且不提交，错误状态可恢复，断开连接会取消未完成的授权回调", async () => {
  const f = await fixture();
  try {
    await f.seed(); f.fake.installations = [];
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const failed = await f.waitJob(); assert.equal(failed.phase, "failed"); assert.match(failed.message, /共同.*写入权限/);
    assert.equal(f.fake.branchHead("gh-pages"), undefined);
    const start = await f.request("/connect", { method: "POST" }); const url = new URL((await start.json()).url);
    assert.equal((await f.request("/connection", { method: "DELETE" })).status, 200);
    const callback = await f.request(`/callback?state=${url.searchParams.get("state")}&installation_id=77`, { cookie: cookie(start) });
    assert.match(callback.headers.get("location")!, /githubPublish=error/);
    assert.equal((await (await f.request("/status")).json()).connected, false);
  } finally { await f.close(); }
});

test("客户端必须确认当前仓库，其他设备换绑后旧面板不能发到新仓库", async () => {
  const f = await fixture();
  try {
    await f.seed();
    assert.equal((await f.request("/publish", { method: "POST", data: payload(), expectedRepositoryId: null })).status, 400);
    assert.equal((await f.request("/publish", { method: "POST", data: payload(), expectedRepositoryId: "999" })).status, 409);
    assert.equal(f.fake.branchHead("gh-pages"), undefined);
    assert.equal((await (await f.request("/status")).json()).job, null);
  } finally { await f.close(); }
});

test("断开连接后已进入 Token 交换的迟到回调不能重新连接账号", async () => {
  const f = await fixture();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  try {
    const start = await f.request("/connect", { method: "POST" }); const install = new URL((await start.json()).url);
    const setup = await f.request(`/callback?state=${install.searchParams.get("state")}`, { cookie: cookie(start) });
    const oauth = new URL(setup.headers.get("location")!);
    const exchange = f.api.exchangeToken.bind(f.api);
    f.api.exchangeToken = async (...args) => { entered(); await wait; return exchange(...args); };
    const finish = f.request(`/callback?state=${oauth.searchParams.get("state")}&code=late-code`, { cookie: cookie(setup) });
    await ready;
    assert.equal((await f.request("/connection", { method: "DELETE" })).status, 200);
    release(); const response = await finish;
    assert.match(response.headers.get("location")!, /githubPublish=error/);
    assert.equal((await (await f.request("/status")).json()).connected, false);
  } finally { release(); await f.close(); }
});

test("过期用户授权自动刷新并保存，刷新 Token 和安装 Token 不暴露给页面", async () => {
  const f = await fixture();
  try {
    await f.seed();
    await f.store.update("alice", (account) => ({ ...account, connection: { user: f.fake.user,
      tokens: f.store.seal("alice", { accessToken: "expired-access", refreshToken: "old-refresh", expiresAt: 1, refreshExpiresAt: Date.now() + 100000 }) } }));
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    assert.equal((await f.waitJob()).phase, "published");
    const call = f.fake.calls.find((item) => item.path === "/login/oauth/access_token")!;
    assert.equal((call.body as { grant_type: string }).grant_type, "refresh_token");
    assert.equal((call.body as { refresh_token: string }).refresh_token, "old-refresh");
    const account = await f.store.get("alice");
    assert.equal(f.store.unseal("alice", account.connection!.tokens).accessToken, f.fake.oauthTokens.access_token);
    const status = JSON.stringify(await (await f.request("/status")).json());
    for (const token of [f.fake.oauthTokens.access_token!, f.fake.oauthTokens.refresh_token!, f.fake.installationAccessToken]) assert.equal(status.includes(token), false);
  } finally { await f.close(); }
});

test("Pages 超时保留提交，重新发布复用原提交继续确认，不重复上传", async () => {
  const f = await fixture({ timeoutMs: 350 });
  try {
    await f.seed();
    f.fake.hooks.beforeRefUpdate = ({ sha }) => { f.fake.buildOnRequest = { commit: sha, status: "building" }; };
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const timeout = await f.waitJob(); assert.equal(timeout.phase, "failed"); assert.ok(timeout.commitSha); assert.match(timeout.message, /超时.*提交已保留/);
    f.fake.latestBuild = { commit: timeout.commitSha, status: "built" };
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const retry = await f.waitJob(); assert.equal(retry.phase, "published", retry.message); assert.equal(retry.commitSha, timeout.commitSha); assert.equal(retry.counts?.uploaded, 0);
  } finally { await f.close(); }
});

test("首次 Pages 配置被用户权限拒绝时不使用安装权限绕过，保留提交供管理员重试", async () => {
  const f = await fixture();
  try {
    await f.seed();
    const request = f.api.request.bind(f.api);
    let configurationDenied = false;
    f.api.request = async <T>(token: string, method: string, pathname: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
      if (method === "POST" && pathname.endsWith("/pages")) {
        assert.equal(token, "fake-user-token"); configurationDenied = true;
        throw new GitHubApiError(403, "insufficient user permission");
      }
      return request<T>(token, method, pathname, body, signal);
    };
    assert.equal((await f.request("/publish", { method: "POST", data: payload() })).status, 202);
    const job = await f.waitJob(); assert.equal(job.phase, "failed"); assert.ok(job.commitSha);
    assert.equal(configurationDenied, true); assert.equal(f.fake.pages, null);
    assert.match(job.message, /Administration.*提交已保留/);
  } finally { await f.close(); }
});
