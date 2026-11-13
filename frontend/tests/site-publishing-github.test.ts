import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GITHUB_PUBLISH_POLL_INTERVAL_MS,
  GitHubLocalSiteHint,
  GitHubPublishControls,
  GitHubPublishJobResult,
  describeGitHubLocalSite,
  describeGitHubPublishJob,
  formatGitHubPublishCounts,
  getGitHubPublishAvailability,
  isGitHubPublishJobActive,
} from "../../src/features/site-publishing/GitHubPublishControls.js";
import {
  GITHUB_PUBLISHING_CONNECT_ENDPOINT,
  GITHUB_PUBLISHING_CONNECTION_ENDPOINT,
  GITHUB_PUBLISHING_PUBLISH_ENDPOINT,
  GITHUB_PUBLISHING_REPOSITORIES_ENDPOINT,
  GITHUB_PUBLISHING_REPOSITORY_ENDPOINT,
  GITHUB_PUBLISHING_STATUS_ENDPOINT,
  GitHubPublishError,
  createGitHubConnectUrl,
  disconnectGitHub,
  fetchGitHubPublishingStatus,
  fetchGitHubRepositories,
  getUrlAfterConsumingGitHubPublishRedirect,
  parseGitHubPublishingStatus,
  publishSiteToGitHub,
  readGitHubPublishRedirectFromUrl,
  sanitizeGitHubCommitUrl,
  sanitizeGitHubSiteUrl,
  sanitizeLocalSiteUrl,
  selectGitHubRepository,
} from "../../src/features/site-publishing/github-client.js";
import type {
  GitHubPublishJob,
  GitHubPublishingStatus,
  GitHubSiteRepository,
} from "../../src/features/site-publishing/github-model.js";
import {
  buildSiteExportRequest,
  createSitePublishDraft,
} from "../../src/features/site-publishing/model.js";
import { SitePublishPanel } from "../../src/features/site-publishing/SitePublishPanel.js";
import type { NoteDocument } from "../../src/types/app.js";

const noop = () => undefined;

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetchStub(
  respond: (call: FetchCall) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = {
      url: typeof input === "string" ? input : String(input),
      init: init ?? {},
    };
    calls.push(call);
    return respond(call);
  };

  return { fetchImpl, calls };
}

const REPOSITORY: GitHubSiteRepository = {
  id: 42,
  installationId: 7,
  owner: "octo",
  name: "notes-site",
  fullName: "octo/notes-site",
  defaultBranch: "main",
};

function makeNote(id: string, title: string): NoteDocument {
  return {
    id,
    markdown: `# ${title}\n\n${title}的正文。`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    normalOrder: 0,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
  };
}

function makeStatus(
  overrides: Partial<GitHubPublishingStatus> = {},
): GitHubPublishingStatus {
  return {
    enabled: true,
    connected: true,
    repository: REPOSITORY,
    job: null,
    ...overrides,
  };
}

function makeJob(overrides: Partial<GitHubPublishJob> = {}): GitHubPublishJob {
  return {
    id: "job-1",
    phase: "published",
    message: "网站已发布。",
    startedAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test("GitHub 状态请求使用同源 Cookie、no-store，并解析仓库与任务", async () => {
  const signal = new AbortController().signal;
  const job: GitHubPublishJob = {
    id: "job-1",
    phase: "uploading",
    message: "正在上传 3 个文件",
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    counts: { added: 1, modified: 2, deleted: 3, unchanged: 4, uploaded: 5 },
  };
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse({
      enabled: true,
      connected: true,
      githubLogin: "octo",
      repository: REPOSITORY,
      job,
    }),
  );

  const status = await fetchGitHubPublishingStatus({ fetchImpl, signal });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GITHUB_PUBLISHING_STATUS_ENDPOINT);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.method, "GET");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(calls[0].init.signal.aborted, false);
  assert.equal(
    new Headers(calls[0].init.headers).get("accept"),
    "application/json",
  );
  assert.equal(status.enabled, true);
  assert.equal(status.connected, true);
  assert.equal(status.githubLogin, "octo");
  assert.deepEqual(status.repository, REPOSITORY);
  assert.equal(status.job?.phase, "uploading");
  assert.deepEqual(status.job?.counts, {
    added: 1,
    modified: 2,
    deleted: 3,
    unchanged: 4,
    uploaded: 5,
  });
});

test("GitHub 状态接口把 JSON error 转成可读错误，非法响应不会误报成功", async () => {
  const { fetchImpl } = createFetchStub(() =>
    jsonResponse({ error: "请先登录账号。" }, 401),
  );

  await assert.rejects(
    fetchGitHubPublishingStatus({ fetchImpl }),
    (error: unknown) =>
      error instanceof GitHubPublishError &&
      error.status === 401 &&
      error.message === "请先登录账号。",
  );

  const invalid = createFetchStub(() => jsonResponse({ enabled: "yes" }));
  await assert.rejects(
    fetchGitHubPublishingStatus({ fetchImpl: invalid.fetchImpl }),
    /GitHub 发布状态响应格式不正确/,
  );
});

test("仓库列表按 {repositories} 解析，异常响应会被拒绝", async () => {
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse({ repositories: [REPOSITORY] }),
  );

  assert.deepEqual(await fetchGitHubRepositories({ fetchImpl }), [REPOSITORY]);
  assert.equal(calls[0].url, GITHUB_PUBLISHING_REPOSITORIES_ENDPOINT);

  const invalid = createFetchStub(() => jsonResponse({ items: [] }));
  await assert.rejects(
    fetchGitHubRepositories({ fetchImpl: invalid.fetchImpl }),
    /GitHub 仓库列表响应格式不正确/,
  );
});

test("授权只返回 GitHub 域名地址，拒绝非 GitHub 或非 HTTPS 地址", async () => {
  const trusted = createFetchStub(() =>
    jsonResponse({
      url: "https://github.com/apps/notes-publisher/installations/new?state=abc",
    }),
  );
  const url = await createGitHubConnectUrl({ fetchImpl: trusted.fetchImpl });

  assert.equal(
    url,
    "https://github.com/apps/notes-publisher/installations/new?state=abc",
  );
  assert.equal(trusted.calls[0].url, GITHUB_PUBLISHING_CONNECT_ENDPOINT);
  assert.equal(trusted.calls[0].init.method, "POST");

  for (const unsafe of [
    "https://evil.example.com/oauth",
    "http://github.com/apps/x/installations/new",
    "javascript:alert(1)",
    "https://user:pass@github.com/apps/x",
  ]) {
    const stub = createFetchStub(() => jsonResponse({ url: unsafe }));
    await assert.rejects(
      createGitHubConnectUrl({ fetchImpl: stub.fetchImpl }),
      /GitHub 授权地址不正确/,
    );
  }
});

test("选择仓库只提交 repositoryId 与 installationId，断开连接返回账号范围状态", async () => {
  const put = createFetchStub(() => jsonResponse(makeStatus()));
  const status = await selectGitHubRepository(REPOSITORY, {
    fetchImpl: put.fetchImpl,
  });

  assert.equal(put.calls[0].url, GITHUB_PUBLISHING_REPOSITORY_ENDPOINT);
  assert.equal(put.calls[0].init.method, "PUT");
  assert.equal(put.calls[0].init.credentials, "same-origin");
  assert.equal(put.calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(String(put.calls[0].init.body)), {
    repositoryId: 42,
    installationId: 7,
  });
  assert.equal(status.repository?.fullName, "octo/notes-site");

  const remove = createFetchStub(() =>
    jsonResponse(makeStatus({ connected: false, repository: null })),
  );
  const disconnected = await disconnectGitHub({ fetchImpl: remove.fetchImpl });

  assert.equal(remove.calls[0].url, GITHUB_PUBLISHING_CONNECTION_ENDPOINT);
  assert.equal(remove.calls[0].init.method, "DELETE");
  assert.equal(disconnected.connected, false);
});

test("可选本站状态兼容旧任务，并解析 pending、published 与 failed", () => {
  const oldStatus = parseGitHubPublishingStatus({
    enabled: true,
    connected: true,
    repository: REPOSITORY,
    job: makeJob(),
  });
  assert.equal("localSiteEnabled" in oldStatus, false);
  assert.equal(oldStatus.job?.localSite, undefined);
  assert.equal(describeGitHubLocalSite(oldStatus.job?.localSite), null);

  const disabledStatus = parseGitHubPublishingStatus({
    enabled: true,
    connected: true,
    localSiteEnabled: false,
    job: makeJob(),
  });
  assert.equal("localSiteEnabled" in disabledStatus, false);

  for (const phase of ["pending", "building", "published", "failed"] as const) {
    const url =
      phase === "published"
        ? "https://notes-ui.example.test/notes/"
        : "";
    const status = parseGitHubPublishingStatus({
      enabled: true,
      connected: true,
      localSiteEnabled: true,
      job: makeJob({
        localSite: { phase, url, message: `本站状态：${phase}` },
      }),
    });

    assert.equal(status.localSiteEnabled, true);
    assert.deepEqual(status.job?.localSite, {
      phase,
      url,
      message: `本站状态：${phase}`,
    });
  }
});

test("本站可选地址拒绝非法协议、凭据与缺失状态，不会破坏其他 GitHub 字段", () => {
  for (const unsafe of [
    "http://notes-ui.example.test/notes/",
    "javascript:alert(1)",
    "https://user:pass@notes-ui.example.test/notes/",
    "not a url",
  ]) {
    const status = parseGitHubPublishingStatus({
      enabled: true,
      connected: true,
      localSiteEnabled: true,
      job: makeJob({
        commitSha: "abc123",
        siteUrl: "https://octo.example.test/notes-site/",
        localSite: { phase: "published", url: unsafe, message: "不应展示" },
      }),
    });

    assert.equal(status.job?.localSite, undefined);
    assert.equal(status.job?.commitSha, "abc123");
    assert.equal(status.job?.siteUrl, "https://octo.example.test/notes-site/");
  }

  const malformed = parseGitHubPublishingStatus({
    enabled: true,
    connected: true,
    localSiteEnabled: true,
    job: {
      id: "job-1",
      phase: "published",
      message: "",
      startedAt: 1,
      updatedAt: 2,
      localSite: {
        phase: "publishing",
        url: "https://notes-ui.example.test/notes/",
      },
    },
  });
  assert.equal(malformed.job?.localSite, undefined);

  const missingPublishedUrl = parseGitHubPublishingStatus({
    enabled: true,
    connected: true,
    localSiteEnabled: true,
    job: makeJob({ localSite: { phase: "published", url: "", message: "" } }),
  });
  assert.equal(missingPublishedUrl.job?.localSite, undefined);

  const failedUnsafeUrl = parseGitHubPublishingStatus({
    enabled: true,
    connected: true,
    localSiteEnabled: true,
    job: makeJob({
      localSite: {
        phase: "failed",
        url: "http://notes-ui.example.test/notes/",
        message: "本站更新失败，已有站点不会被替换。",
      },
    }),
  });
  assert.deepEqual(failedUnsafeUrl.job?.localSite, {
    phase: "failed",
    url: "",
    message: "本站更新失败，已有站点不会被替换。",
  });
  const failedHtml = renderToStaticMarkup(
    createElement(GitHubPublishJobResult, { job: failedUnsafeUrl.job! }),
  );
  assert.match(failedHtml, /data-local-site-phase="failed"/);
  assert.match(failedHtml, /已有站点不会被替换/);
  assert.doesNotMatch(failedHtml, /访问本站网站/);
});

test("本站地址允许 HTTP 回环，仍拒绝外部 HTTP 与不安全协议", () => {
  for (const url of [
    "http://localhost:3001/notes/",
    "http://127.0.0.1:3001/notes/",
    "http://[::1]:3001/notes/",
    "https://notes-ui.example.test/notes/",
  ]) {
    assert.equal(sanitizeLocalSiteUrl(url), new URL(url).href);
  }

  for (const unsafe of [
    "http://notes-ui.example.test/notes/",
    "http://localhost.evil.example/notes/",
    "http://127.0.0.1.evil.example/notes/",
    "http://user:pass@localhost:3001/notes/",
    "ftp://localhost/notes/",
    "javascript:alert(1)",
  ]) {
    assert.equal(sanitizeLocalSiteUrl(unsafe), null);
  }

  const status = parseGitHubPublishingStatus({
    enabled: true,
    connected: true,
    localSiteEnabled: true,
    job: makeJob({
      localSite: {
        phase: "published",
        url: "http://127.0.0.1:3001/notes/",
        message: "本地回环站点已更新。",
      },
    }),
  });
  assert.equal(
    status.job?.localSite?.url,
    "http://127.0.0.1:3001/notes/",
  );

  const html = renderToStaticMarkup(
    createElement(GitHubPublishJobResult, { job: status.job! }),
  );
  assert.match(
    html,
    /href="http:\/\/127\.0\.0\.1:3001\/notes\/"/,
  );
  assert.match(html, />访问本站网站</);
});

test("本站状态渲染为独立结果，只有 published 才显示“访问本站网站”", () => {
  const pendingHtml = renderToStaticMarkup(
    createElement(GitHubPublishJobResult, {
      job: makeJob({
        localSite: {
          phase: "pending",
          url: "https://notes-ui.example.test/notes/",
          message: "本站镜像已排队。",
        },
      }),
    }),
  );
  assert.match(pendingHtml, /data-local-site-phase="pending"/);
  assert.match(pendingHtml, /本站镜像：等待更新本站镜像/);
  assert.match(pendingHtml, /本站镜像已排队/);
  assert.doesNotMatch(pendingHtml, /访问本站网站/);

  const publishedHtml = renderToStaticMarkup(
    createElement(GitHubPublishJobResult, {
      job: makeJob({
        commitSha: "abc123",
        commitUrl: "https://github.com/octo/notes-site/commit/abc123",
        siteUrl: "https://octo.example.test/notes-site/",
        localSite: {
          phase: "published",
          url: "https://notes-ui.example.test/notes/",
          message: "本站 /notes/ 已更新。",
        },
      }),
    }),
  );
  assert.match(publishedHtml, /data-local-site-phase="published"/);
  assert.match(publishedHtml, /data-local-site-live="true"/);
  assert.match(publishedHtml, /本站镜像：已更新/);
  assert.doesNotMatch(publishedHtml, /本站镜像：本站镜像/);
  assert.match(publishedHtml, /href="https:\/\/notes-ui\.example\.test\/notes\/"/);
  assert.match(publishedHtml, />访问本站网站</);
  assert.match(publishedHtml, />访问站点</);

  const failedHtml = renderToStaticMarkup(
    createElement(GitHubPublishJobResult, {
      job: makeJob({
        commitSha: "abc123",
        commitUrl: "https://github.com/octo/notes-site/commit/abc123",
        siteUrl: "https://octo.example.test/notes-site/",
        localSite: {
          phase: "failed",
          url: "https://notes-ui.example.test/notes/",
          message: "本站构建失败。",
        },
      }),
    }),
  );
  assert.match(failedHtml, /data-github-publish-live="true"/);
  assert.match(failedHtml, /data-local-site-phase="failed"/);
  assert.match(failedHtml, /data-local-site-live="false"/);
  assert.match(failedHtml, /本站镜像：本站更新失败，已有站点不会被替换/);
  assert.match(failedHtml, /本站构建失败/);
  assert.match(failedHtml, /如已发布过，上一版本仍可访问/);
  assert.match(failedHtml, />访问站点</);
  assert.doesNotMatch(failedHtml, /访问本站网站/);

  const legacyHtml = renderToStaticMarkup(
    createElement(GitHubPublishJobResult, { job: makeJob() }),
  );
  assert.doesNotMatch(legacyHtml, /data-local-site-phase/);
  assert.doesNotMatch(legacyHtml, /访问本站网站/);
  assert.match(
    renderToStaticMarkup(createElement(GitHubLocalSiteHint)),
    /同步更新到本站的\s*\/notes\/\s*页面/,
  );
});

test("轮询间隔在 3–5 秒内，终态任务停止轮询", () => {
  assert.ok(GITHUB_PUBLISH_POLL_INTERVAL_MS >= 3_000);
  assert.ok(GITHUB_PUBLISH_POLL_INTERVAL_MS <= 5_000);

  for (const phase of ["queued", "building", "uploading", "committing", "deploying"] as const) {
    assert.equal(
      isGitHubPublishJobActive({
        id: "job-1",
        phase,
        message: "",
        startedAt: 1,
        updatedAt: 2,
      }),
      true,
    );
  }

  for (const phase of ["published", "failed", "interrupted"] as const) {
    assert.equal(
      isGitHubPublishJobActive({
        id: "job-1",
        phase,
        message: "",
        startedAt: 1,
        updatedAt: 2,
      }),
      false,
    );
  }
});

test("发布前复用 ZIP 导出的请求校验，空选择不会发出网络请求", async () => {
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse({ job: { id: "job-1", phase: "queued", startedAt: 1, updatedAt: 1 } }, 202),
  );

  await assert.rejects(
    publishSiteToGitHub(createSitePublishDraft(), [], { fetchImpl }),
    /请选择至少一张便签/,
  );
  assert.equal(calls.length, 0);
});

test("发布请求使用与 ZIP 导出相同的 payload，并解析 202 任务", async () => {
  const note = makeNote("note-a", "甲便签");
  const draft = createSitePublishDraft();
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  const expected = buildSiteExportRequest(draft, [note]);
  const { fetchImpl, calls } = createFetchStub(() =>
    jsonResponse(
      {
        job: {
          id: "job-9",
          phase: "queued",
          message: "",
          startedAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        },
      },
      202,
    ),
  );

  const job = await publishSiteToGitHub(draft, [note], { fetchImpl, repositoryId: REPOSITORY.id });
  assert.equal(new Headers(calls[0].init.headers).get("X-Notes-GitHub-Repository-Id"), String(REPOSITORY.id));

  assert.equal(job.id, "job-9");
  assert.equal(job.phase, "queued");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, GITHUB_PUBLISHING_PUBLISH_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), expected);
  // 发布请求只包含与 ZIP 导出一致的便签快照，不含账号或凭据字段。
  assert.doesNotMatch(String(calls[0].init.body), /token|password|secret/i);
});

test("发布按钮只在已授权、有仓库、有便签且无活动任务时可用", () => {
  const base = {
    selectedCount: 1,
    disabled: false,
    status: makeStatus(),
    savingRepository: false,
    publishing: false,
    connecting: false,
    disconnecting: false,
  };

  assert.equal(getGitHubPublishAvailability(base).canPublish, true);

  const empty = getGitHubPublishAvailability({ ...base, selectedCount: 0 });
  assert.equal(empty.canPublish, false);
  assert.match(empty.reason, /至少选择一张便签/);

  const noRepository = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({ repository: null }),
  });
  assert.equal(noRepository.canPublish, false);
  assert.match(noRepository.reason, /选择要发布到的 GitHub 仓库/);

  const active = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({
      job: {
        id: "job-1",
        phase: "uploading",
        message: "",
        startedAt: 1,
        updatedAt: 2,
      },
    }),
  });
  assert.equal(active.canPublish, false);
  assert.match(active.reason, /已有发布任务进行中/);

  const busy = getGitHubPublishAvailability({ ...base, disabled: true });
  assert.equal(busy.canPublish, false);

  const unconfigured = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({ enabled: false }),
  });
  assert.equal(unconfigured.canPublish, false);

  const disconnected = getGitHubPublishAvailability({
    ...base,
    status: makeStatus({ connected: false, repository: null }),
  });
  assert.equal(disconnected.canPublish, false);
  assert.match(disconnected.reason, /授权 GitHub 仓库/);
});

test("提交成功与已发布分开：只有 published 才算站点上线", () => {
  const deploying = describeGitHubPublishJob({
    id: "job-1",
    phase: "deploying",
    message: "",
    startedAt: 1,
    updatedAt: 2,
    commitSha: "abc123",
    commitUrl: "https://github.com/octo/notes-site/commit/abc123",
  });
  assert.equal(deploying.active, true);
  assert.equal(deploying.terminal, false);
  assert.equal(deploying.live, false);
  assert.equal(deploying.committed, true);
  assert.match(deploying.label, /已提交成功/);
  assert.doesNotMatch(deploying.label, /已发布/);

  const deployingLocal = describeGitHubPublishJob({
    id: "job-1",
    phase: "deploying",
    message: "",
    startedAt: 1,
    updatedAt: 2,
    commitSha: "abc123",
    commitUrl: "https://github.com/octo/notes-site/commit/abc123",
    localSite: {
      phase: "building",
      url: "https://notes-ui.example.test/notes/",
      message: "正在更新本站网站…",
    },
  });
  assert.equal(deployingLocal.active, true);
  assert.equal(deployingLocal.terminal, false);
  assert.equal(deployingLocal.live, false);
  assert.equal(deployingLocal.committed, true);
  assert.equal(deployingLocal.label, "GitHub Pages 已上线，正在更新本站");
  assert.doesNotMatch(deployingLocal.label, /等待 GitHub Pages 部署/);

  const published = describeGitHubPublishJob({
    id: "job-1",
    phase: "published",
    message: "",
    startedAt: 1,
    updatedAt: 3,
    siteUrl: "https://octo.example.com/",
  });
  assert.equal(published.active, false);
  assert.equal(published.terminal, true);
  assert.equal(published.live, true);
  assert.match(published.label, /已发布/);

  const failed = describeGitHubPublishJob({
    id: "job-2",
    phase: "failed",
    message: "GitHub 拒绝了这次提交。",
    startedAt: 1,
    updatedAt: 3,
  });
  assert.equal(failed.active, false);
  assert.equal(failed.terminal, true);
  assert.equal(failed.live, false);
});

test("发布数量与链接只展示后端给出的有效值", () => {
  assert.equal(
    formatGitHubPublishCounts({
      added: 1,
      modified: 2,
      deleted: 3,
      unchanged: 4,
      uploaded: 5,
    }),
    "新增 1 · 修改 2 · 删除 3 · 未变 4 · 上传文件 5",
  );
  assert.equal(formatGitHubPublishCounts(undefined), "");

  assert.equal(
    sanitizeGitHubSiteUrl("https://blog.example.com/posts/"),
    "https://blog.example.com/posts/",
  );
  assert.equal(sanitizeGitHubSiteUrl("http://blog.example.com/"), null);
  assert.equal(sanitizeGitHubSiteUrl("javascript:alert(1)"), null);
  assert.equal(
    sanitizeGitHubSiteUrl("https://user:pass@blog.example.com/"),
    null,
  );
  assert.equal(
    sanitizeGitHubCommitUrl(
      "https://github.com/octo/notes-site/commit/abc123",
    ),
    "https://github.com/octo/notes-site/commit/abc123",
  );
  assert.equal(
    sanitizeGitHubCommitUrl("https://blog.example.com/commit/abc123"),
    null,
  );
});

test("OAuth 回调只消费 githubPublish，保留其他查询参数与编辑器 hash", () => {
  const href =
    "https://notes.example.com/path?theme=dark&githubPublish=connected#note=abc&view=editor";

  assert.equal(readGitHubPublishRedirectFromUrl(href), "connected");
  assert.equal(
    readGitHubPublishRedirectFromUrl(
      "https://notes.example.com/path?githubPublish=error",
    ),
    "error",
  );
  assert.equal(
    readGitHubPublishRedirectFromUrl(
      "https://notes.example.com/path?githubPublish=other",
    ),
    null,
  );
  assert.equal(readGitHubPublishRedirectFromUrl("not a url"), null);
  assert.equal(
    getUrlAfterConsumingGitHubPublishRedirect(href),
    "/path?theme=dark#note=abc&view=editor",
  );
});

test("SSR 首屏不触碰 window，GitHub 卡片只显示初始加载状态", () => {
  assert.equal(typeof window, "undefined");

  const draft = createSitePublishDraft();
  draft.selections = [{ noteId: "note-a", categoryId: "guides" }];
  const notes = [makeNote("note-a", "甲便签")];

  const controlsHtml = renderToStaticMarkup(
    createElement(GitHubPublishControls, {
      draft,
      notes,
      disabled: false,
      storageScope: "user-a",
    }),
  );

  assert.match(controlsHtml, /data-site-publish-github="loading"/);
  assert.match(controlsHtml, /正在读取 GitHub 发布状态/);
  assert.match(controlsHtml, /GitHub Pages/);
  assert.doesNotMatch(controlsHtml, /发布到 GitHub Pages/);
  assert.doesNotMatch(controlsHtml, /type="password"/);
  assert.doesNotMatch(controlsHtml, /token/i);

  const panelHtml = renderToStaticMarkup(
    createElement(SitePublishPanel, {
      notes,
      storageScope: "user-a",
      onClose: noop,
    }),
  );

  assert.match(panelHtml, /data-site-publish-github="loading"/);
  assert.match(panelHtml, /生成网站 ZIP/);
  assert.doesNotMatch(panelHtml, /type="password"/);
  // GitHub 状态未就绪时 ZIP 仍是主要动作。
  assert.match(
    panelHtml,
    /class="site-publish-primary"[^>]*>生成网站 ZIP/,
  );
});
