import { siteBuildGate } from "./build-gate.js";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { activeGitHubPublishPhases, type GitHubPublishJob, type GitHubPublishingStatus, type GitHubSiteRepository } from "../../src/features/site-publishing/github-model.js";
import type { SiteExportRequest } from "../../src/features/site-publishing/model.js";
import { createSiteImageReader } from "./assets.js";
import { buildSiteEntries, validateSiteExportRequest, type SiteBuildOptions, type SiteZipEntry } from "./build.js";
import { GitHubApi, GitHubPublishingError, type GitHubAppConfig } from "./github-api.js";
import { GitHubPublishingStore } from "./github-store.js";
import { commitStaticSite, configurePages, githubSiteLocation, readPages, repositoryApiPath, waitForPages } from "./github-publisher.js";

export interface GitHubPublishingOptions {
  dataDirectory: string; rootDirectory: string; imagesDirectory: string; publicDirectory: string;
  getUser: (request: Request, response: Response) => Promise<{ id: string } | null>;
  isSameOrigin: (request: Request) => boolean;
  publicOrigin: (request: Request) => string;
  config: GitHubAppConfig | null;
  api?: GitHubApi;
  build?: (request: SiteExportRequest, options: SiteBuildOptions) => Promise<SiteZipEntry[]>;
  timeoutMs?: number; pollMs?: number;
}

export async function createGitHubPublishingRouter(options: GitHubPublishingOptions) {
  const router = Router();
  const api = options.api ?? (options.config ? new GitHubApi(options.config) : null);
  const store = new GitHubPublishingStore(options.dataDirectory, options.config?.tokenKey);
  await store.recoverInterruptedJobs();
  const activeOwners = new Set<string>();
  const activeRepositories = new Set<number>();
  const jobs = new Map<string, GitHubPublishJob>();
  const refreshing = new Map<string, Promise<string>>();
  const authorizationVersions = new Map<string, number>();
  const states = new Map<string, { owner: string; version: number; expiresAt: number; verifier: string; kind: "installation" | "oauth" }>();
  const COOKIE = "notes_github_publish_state";
  const configured = () => { if (!api || !options.config) throw new GitHubPublishingError("管理员尚未配置 GitHub App 发布功能。", 503); return api; };
  const inProgress = (job?: GitHubPublishJob) => !!job && activeGitHubPublishPhases.includes(job.phase);
  const assertIdle = (owner: string, job?: GitHubPublishJob) => { if (activeOwners.has(owner) || inProgress(job)) throw new GitHubPublishingError("网站正在发布，请完成后再更换授权或仓库。", 409); };
  async function status(owner: string): Promise<GitHubPublishingStatus> {
    const account = await store.get(owner);
    return { enabled: !!api, connected: !!account.connection, githubLogin: account.connection?.user.login,
      repository: account.repository ?? null, job: jobs.get(owner) ?? account.job ?? null };
  }
  async function userToken(owner: string): Promise<string> {
    const existing = refreshing.get(owner); if (existing) return existing;
    const operation = (async () => {
      const account = await store.get(owner);
      if (!account.connection) throw new GitHubPublishingError("请先授权 GitHub 仓库。", 401);
      let tokens;
      try { tokens = store.unseal(owner, account.connection.tokens); }
      catch { throw new GitHubPublishingError("GitHub 授权无法读取，请重新授权。", 401); }
      if (!tokens.expiresAt || tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;
      if (!tokens.refreshToken || (tokens.refreshExpiresAt && tokens.refreshExpiresAt <= Date.now())) throw new GitHubPublishingError("GitHub 授权已过期，请重新授权。", 401);
      const refreshed = await configured().exchangeToken({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
      const user = await configured().user(refreshed.accessToken);
      if (user.id !== account.connection.user.id) throw new GitHubPublishingError("GitHub 授权身份发生变化，请重新授权。", 401);
      await store.update(owner, (current) => {
        if (current.connection?.tokens !== account.connection!.tokens) throw new GitHubPublishingError("GitHub 授权已在其他设备更新，请重试。", 409);
        return { ...current, connection: { user, tokens: store.seal(owner, refreshed) } };
      });
      return refreshed.accessToken;
    })();
    refreshing.set(owner, operation);
    try { return await operation; } finally { refreshing.delete(owner); }
  }
  async function authorizedRepository(owner: string, installationId: number, repositoryId: number, signal?: AbortSignal): Promise<GitHubSiteRepository> {
    const list = await configured().repositories(await userToken(owner), signal);
    const repository = list.find((entry) => entry.id === repositoryId && entry.installationId === installationId);
    if (!repository) throw new GitHubPublishingError("当前 GitHub 用户和 App 未共同获得该仓库的写入权限，请重新授权。", 403);
    if (repository.defaultBranch === "gh-pages") throw new GitHubPublishingError("目标仓库的默认分支不能是 gh-pages，请选择主分支独立的仓库。");
    return repository;
  }
  function setStateCookie(response: Response, state: string) {
    response.cookie(COOKIE, state, { httpOnly: true, sameSite: "lax", secure: new URL(options.config!.callbackUrl).protocol === "https:", path: new URL(options.config!.callbackUrl).pathname, maxAge: 10 * 60_000 });
  }
  function issueState(owner: string, response: Response, kind: "installation" | "oauth") {
    for (const [key, value] of states) if (value.expiresAt < Date.now()) states.delete(key);
    if (states.size >= 10000 || [...states.values()].filter((entry) => entry.owner === owner).length >= 10) throw new GitHubPublishingError("授权尝试过于频繁，请稍后重试。", 429);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    states.set(state, { owner, version: authorizationVersions.get(owner) ?? 0, verifier, kind, expiresAt: Date.now() + 10 * 60_000 });
    setStateCookie(response, state);
    return { state, verifier };
  }
  function callbackState(request: Request, response: Response, owner: string) {
    const state = typeof request.query.state === "string" ? request.query.state : "";
    const cookie = (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
    const entry = states.get(state);
    const equal = state.length === cookie.length && state.length > 0 && timingSafeEqual(Buffer.from(state), Buffer.from(cookie));
    if (!equal || !entry || entry.owner !== owner || entry.expiresAt < Date.now()) throw new GitHubPublishingError("GitHub 授权请求已失效，请回到发布面板重新授权。", 403);
    states.delete(state);
    response.clearCookie(COOKIE, { path: new URL(options.config!.callbackUrl).pathname, httpOnly: true, sameSite: "lax", secure: new URL(options.config!.callbackUrl).protocol === "https:" });
    return entry;
  }
  function returnToPanel(response: Response, result: "connected" | "error") {
    const url = new URL("/", options.config!.callbackUrl); url.searchParams.set("githubPublish", result);
    response.redirect(303, url.href);
  }

  router.use(async (request, response, next) => {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (request.path !== "/callback" && (!options.isSameOrigin(request) || request.get("sec-fetch-site") === "cross-site")) { response.status(403).json({ error: "请从当前便签页面操作 GitHub 发布。" }); return; }
    const user = await options.getUser(request, response);
    if (!user) return;
    response.locals.ownerId = user.id;
    next();
  });
  router.get("/status", async (_request, response) => { response.json(await status(response.locals.ownerId)); });
  router.post("/connect", async (_request, response) => {
    configured(); const owner = response.locals.ownerId as string;
    assertIdle(owner, (await store.get(owner)).job);
    const { state } = issueState(owner, response, "installation");
    const url = new URL(`https://github.com/apps/${options.config!.slug}/installations/new`);
    url.searchParams.set("state", state); response.json({ url: url.href });
  });
  router.get("/callback", async (request, response) => {
    configured(); const owner = response.locals.ownerId as string;
    try {
      const state = callbackState(request, response, owner);
      assertIdle(owner, (await store.get(owner)).job);
      if (request.query.error) throw new GitHubPublishingError("GitHub 授权已取消。");
      if (state.kind === "installation") {
        // 安装回调里的 installation_id 不是授权依据；随后用 OAuth 用户交集重新查询。
        const next = issueState(owner, response, "oauth");
        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", options.config!.clientId); url.searchParams.set("redirect_uri", options.config!.callbackUrl);
        url.searchParams.set("state", next.state); url.searchParams.set("code_challenge", createHash("sha256").update(next.verifier).digest("base64url")); url.searchParams.set("code_challenge_method", "S256");
        response.redirect(303, url.href); return;
      }
      if (typeof request.query.code !== "string" || !request.query.code || request.query.code.length > 1024) throw new GitHubPublishingError("GitHub 未返回有效授权码。");
      const tokens = await api!.exchangeToken({ code: request.query.code, redirect_uri: options.config!.callbackUrl, code_verifier: state.verifier });
      const user = await api!.user(tokens.accessToken);
      if (!Number.isSafeInteger(user.id) || !user.login) throw new GitHubPublishingError("GitHub 用户身份不正确。");
      await store.update(owner, (current) => {
        assertIdle(owner, current.job);
        if (state.version !== (authorizationVersions.get(owner) ?? 0)) throw new GitHubPublishingError("授权已取消，请重新授权。", 409);
        const sameUser = current.connection?.user.id === user.id;
        return { ...current, connection: { user, tokens: store.seal(owner, tokens) }, repository: sameUser ? current.repository : undefined, job: sameUser ? current.job : undefined };
      });
      jobs.delete(owner);
      returnToPanel(response, "connected");
    } catch { returnToPanel(response, "error"); }
  });
  router.get("/repositories", async (_request, response) => {
    const owner = response.locals.ownerId as string;
    response.json({ repositories: await configured().repositories(await userToken(owner)) });
  });
  router.put("/repository", async (request, response) => {
    const owner = response.locals.ownerId as string;
    assertIdle(owner, (await store.get(owner)).job);
    const { repositoryId, installationId } = request.body ?? {};
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0 || !Number.isSafeInteger(installationId) || installationId <= 0) throw new GitHubPublishingError("请选择已授权的 GitHub 仓库。", 400);
    const repository = await authorizedRepository(owner, installationId, repositoryId);
    await store.update(owner, (current) => { assertIdle(owner, current.job); return { ...current, repository, job: current.repository?.id === repository.id ? current.job : undefined }; });
    jobs.delete(owner);
    response.json(await status(owner));
  });
  router.delete("/connection", async (_request, response) => {
    const owner = response.locals.ownerId as string;
    await store.update(owner, (current) => { assertIdle(owner, current.job); return {}; });
    authorizationVersions.set(owner, (authorizationVersions.get(owner) ?? 0) + 1);
    for (const [key, state] of states) if (state.owner === owner) states.delete(key);
    jobs.delete(owner); response.json(await status(owner));
  });

  async function run(owner: string, request: SiteExportRequest, repository: GitHubSiteRepository, publicOrigin: string, initial: GitHubPublishJob) {
    let job = initial;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), options.timeoutMs ?? 10 * 60_000);
    const patch = async (change: Partial<GitHubPublishJob>) => {
      job = { ...job, ...change, updatedAt: Date.now() };
      await store.update(owner, (account) => ({ ...account, job }));
      jobs.set(owner, job);
    };
    try {
      const authorized = await authorizedRepository(owner, repository.installationId, repository.id, controller.signal);
      const token = await configured().installationToken(authorized, controller.signal);
      const pages = await readPages(api!, token, authorized, controller.signal);
      const location = githubSiteLocation(authorized, request.settings, pages);
      const releaseBuild = await siteBuildGate.acquire(owner, controller.signal);
      let committed: Awaited<ReturnType<typeof commitStaticSite>>;
      try {
        await patch({ phase: "building", message: "正在使用 Hugo 构建网站…", siteUrl: location.url });
        const entries = await (options.build ?? buildSiteEntries)({ ...request, settings: location.settings }, {
          rootDirectory: options.rootDirectory, signal: controller.signal,
          readImage: createSiteImageReader({ imagesDirectory: options.imagesDirectory, publicDirectory: options.publicDirectory, publicOrigin }),
        });
        committed = await commitStaticSite({ api: api!, token, repository: authorized, ownerId: owner, manifestKey: options.config!.tokenKey,
          entries, prefix: location.prefix, cname: pages?.cname, signal: controller.signal,
          onPhase: (phase, counts) => patch({ phase, counts, message: phase === "uploading" ? "正在上传变化的文件…" : "正在合并提交网站文件…" }),
        });
      } finally { releaseBuild(); }
      await patch({ phase: "deploying", message: committed.changed ? "网站已提交，正在等待 GitHub Pages 发布…" : "网站文件没有变化，正在确认 GitHub Pages 状态…",
        commitSha: committed.commitSha, commitUrl: `https://github.com/${authorized.owner}/${authorized.name}/commit/${committed.commitSha}`, counts: committed.counts });
      // 首次开启 Pages 需要 Administration:write；使用用户交集授权，由 GitHub 校验
      // 当前用户的管理权限，避免把 App 安装的管理权限提升给普通写入者。
      await configurePages(api!, await userToken(owner), authorized, controller.signal);
      await waitForPages({ api: api!, token, repository: authorized, commitSha: committed.commitSha, signal: controller.signal, pollMs: options.pollMs });
      await patch({ phase: "published", message: "网站已发布。" });
    } catch (error) {
      const message = controller.signal.aborted ? (job.commitSha ? "等待 Pages 发布超时，网站提交已保留。可重新发布以继续确认状态。" : "网站发布超时，请稍后重试。")
        : error instanceof GitHubPublishingError ? error.message : job.phase === "building" ? "Hugo 网站构建失败，请检查便签、图片和服务端 Hugo 环境后重试。" : "网站发布失败，请稍后重试。";
      try { await patch({ phase: "failed", message }); } catch { jobs.set(owner, { ...job, phase: "failed", message: "无法保存发布状态，请检查服务端存储；已提交的版本不会回滚。", updatedAt: Date.now() }); }
    } finally { clearTimeout(deadline); activeOwners.delete(owner); activeRepositories.delete(repository.id); }
  }
  router.post("/publish", async (request, response) => {
    configured(); const owner = response.locals.ownerId as string;
    if (activeOwners.has(owner) || activeOwners.size >= 2) throw new GitHubPublishingError("已有网站正在发布，请稍后再试。", 429);
    let parsed: SiteExportRequest;
    try { parsed = validateSiteExportRequest(request.body); }
    catch (error) { throw new GitHubPublishingError(error instanceof Error ? error.message : "网站内容不正确。", 400); }
    const origin = options.publicOrigin(request);
    activeOwners.add(owner);
    let started = false;
    let repository: GitHubSiteRepository | undefined;
    let repositoryReserved = false;
    try {
      const account = await store.get(owner); repository = account.repository;
      if (!account.connection || !repository) throw new GitHubPublishingError("请先授权 GitHub 并选择仓库。", 400);
      const expectedRepositoryId = request.get("X-Notes-GitHub-Repository-Id");
      if (!expectedRepositoryId || !/^[1-9][0-9]*$/.test(expectedRepositoryId)) throw new GitHubPublishingError("请刷新发布面板，确认目标仓库后重试。", 400);
      if (Number(expectedRepositoryId) !== repository.id) throw new GitHubPublishingError("发布仓库已在其他设备更改，请刷新后重新确认。", 409);
      if (activeRepositories.has(repository.id)) throw new GitHubPublishingError("该仓库正在发布，请稍后重试。", 429);
      activeRepositories.add(repository.id); repositoryReserved = true;
      const job: GitHubPublishJob = { id: randomUUID(), phase: "queued", message: "发布已排队…", startedAt: Date.now(), updatedAt: Date.now() };
      await store.update(owner, (current) => ({ ...current, job })); jobs.set(owner, job);
      started = true;
      void run(owner, parsed, repository, origin, job);
      response.status(202).json({ job });
    } catch (error) {
      if (!started) { activeOwners.delete(owner); if (repositoryReserved && repository) activeRepositories.delete(repository.id); }
      throw error;
    }
  });
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    response.status(error instanceof GitHubPublishingError ? error.status : 503).json({ error: error instanceof GitHubPublishingError ? error.message : "GitHub 发布暂时不可用，请检查服务端配置或存储后重试。" });
  });
  return router;
}
