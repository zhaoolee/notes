import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { GitHubPublishCounts, GitHubSiteRepository } from "../../src/features/site-publishing/github-model.js";
import type { SiteSettings } from "../../src/features/site-publishing/model.js";
import { normalizeBasePath } from "../../src/features/site-publishing/model.js";
import { GitHubApi, GitHubApiError, GitHubPublishingError, type GitHubPages, type GitTree, type GitTreeEntry } from "./github-api.js";
import type { SiteZipEntry } from "./build.js";

export const SITE_PUBLISH_BRANCH = "gh-pages";
const MANIFEST = ".notes-site-publishing.json";
export function gitBlobSha(data: Buffer): string {
  return createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
}
function safePath(value: string): boolean {
  return !!value && value.length < 1024 && !value.includes("\\") && !value.includes("\0") && !value.startsWith("/") && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && segment !== ".git" && segment !== ".github");
}
export function repositoryApiPath(repository: GitHubSiteRepository): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
}
export function githubSiteLocation(repository: GitHubSiteRepository, settings: SiteSettings, pages: GitHubPages | null) {
  const url = new URL(pages?.html_url || `https://${repository.owner.toLowerCase()}.github.io/${repository.name.toLowerCase() === `${repository.owner.toLowerCase()}.github.io` ? "" : `${repository.name}/`}`);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new GitHubPublishingError("GitHub Pages 返回的网站地址不正确。");
  url.protocol = "https:";
  const root = url.pathname.replace(/\/$/, "");
  const requested = normalizeBasePath(settings.basePath);
  // 已包含项目站点前缀的旧设置不重复追加；其余路径作为仓库站点内的子目录。
  const basePath = root && (requested === `${root}/` || requested.startsWith(`${root}/`)) ? requested : `${root}${requested}`;
  const prefix = basePath.slice(root.length).replace(/^\/+|\/+$/g, "");
  url.pathname = basePath;
  return { url: url.href, prefix: prefix ? `${prefix}/` : "", settings: { ...settings, origin: url.origin, basePath } };
}

export async function readPages(api: GitHubApi, token: string, repository: GitHubSiteRepository, signal: AbortSignal): Promise<GitHubPages | null> {
  try {
    const pages = await api.request<GitHubPages>(token, "GET", `${repositoryApiPath(repository)}/pages`, undefined, signal);
    if (pages.build_type === "workflow" || pages.source?.branch !== SITE_PUBLISH_BRANCH || pages.source?.path !== "/") throw new GitHubPublishingError("该仓库已有其他 Pages 发布方式。请选择独立仓库，或先在 GitHub 将 Pages 来源设为 gh-pages 分支根目录。");
    return pages;
  } catch (error) { if (error instanceof GitHubApiError && error.githubStatus === 404) return null; throw error; }
}

async function readTree(api: GitHubApi, token: string, base: string, sha: string, signal: AbortSignal): Promise<GitTreeEntry[]> {
  const tree = await api.request<GitTree>(token, "GET", `${base}/git/trees/${sha}?recursive=1`, undefined, signal);
  if (!tree.truncated) return tree.tree;
  const result: GitTreeEntry[] = [];
  const pending = [{ sha, prefix: "" }];
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > 10000 || result.length > 20000) throw new GitHubPublishingError("gh-pages 分支文件过多，请使用独立的网站仓库。");
    const item = pending[index];
    const subtree = await api.request<GitTree>(token, "GET", `${base}/git/trees/${item.sha}`, undefined, signal);
    if (subtree.truncated) throw new GitHubPublishingError("无法完整读取远程文件树，已停止发布以避免误删文件。");
    for (const entry of subtree.tree) {
      const path = `${item.prefix}${entry.path}`;
      result.push({ ...entry, path });
      if (entry.type === "tree") pending.push({ sha: entry.sha, prefix: `${path}/` });
    }
  }
  return result;
}

interface Manifest { version: 1; owner: string; paths: string[]; signature: string }
function manifestSignature(key: Buffer, owner: string, paths: string[]) {
  return createHmac("sha256", key).update(JSON.stringify({ version: 1, owner, paths })).digest("hex");
}
async function previousPaths(api: GitHubApi, token: string, base: string, tree: Map<string, GitTreeEntry>, owner: string, key: Buffer, signal: AbortSignal): Promise<string[]> {
  const entry = tree.get(MANIFEST);
  if (!entry) return [];
  if (entry.type !== "blob" || (entry.size ?? 0) > 1024 * 1024) throw new GitHubPublishingError("发布清单无效，已停止发布。");
  const blob = await api.request<{ content: string; encoding: string }>(token, "GET", `${base}/git/blobs/${entry.sha}`, undefined, signal);
  let value: Manifest;
  try {
    if (blob.encoding !== "base64" || blob.content.length > 2 * 1024 * 1024) throw new Error();
    value = JSON.parse(Buffer.from(blob.content, "base64").toString("utf8")) as Manifest;
    if (value.version !== 1 || value.owner !== owner || !Array.isArray(value.paths) || value.paths.length > 10000 || !value.paths.every((item) => typeof item === "string" && safePath(item) && item !== MANIFEST)) throw new Error();
    const expected = Buffer.from(manifestSignature(key, owner, value.paths), "hex");
    const signature = Buffer.from(value.signature, "hex");
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error();
  } catch { throw new GitHubPublishingError("此分支的发布清单属于其他账号、已被修改或加密密钥已更换，已停止发布以保护现有文件。"); }
  return value.paths;
}

export interface IncrementalPublishResult { commitSha: string; counts: GitHubPublishCounts; changed: boolean }
export async function commitStaticSite(options: {
  api: GitHubApi; token: string; repository: GitHubSiteRepository; ownerId: string; manifestKey: Buffer;
  entries: SiteZipEntry[]; prefix: string; cname?: string | null; signal: AbortSignal;
  onPhase?: (phase: "uploading" | "committing", counts: GitHubPublishCounts) => Promise<void>;
}): Promise<IncrementalPublishResult> {
  const { api, token, repository, signal } = options;
  if (repository.defaultBranch === SITE_PUBLISH_BRANCH) throw new GitHubPublishingError("gh-pages 是该仓库的默认分支，请选择主分支独立的网站仓库。");
  if (options.prefix && !safePath(options.prefix.slice(0, -1))) throw new GitHubPublishingError("发布子路径不正确。");
  const base = repositoryApiPath(repository);
  // Git refs API 不支持无分支仓库；明确要求初始化，绝不偷偷写主分支。
  try { await api.request(token, "GET", `${base}/git/ref/heads/${encodeURIComponent(repository.defaultBranch)}`, undefined, signal); }
  catch (error) {
    if (error instanceof GitHubApiError && [404, 409].includes(error.githubStatus)) throw new GitHubPublishingError("仓库尚未初始化。请在 GitHub 创建 README 后重试；发布服务不会写入主分支。");
    throw error;
  }
  const owner = createHash("sha256").update(options.ownerId).digest("hex");
  const files = new Map<string, Buffer>();
  for (const entry of options.entries) if (entry.path.startsWith("notes-hugo-site/public/")) {
    const name = entry.path.slice("notes-hugo-site/public/".length);
    if (!safePath(name)) throw new GitHubPublishingError("构建输出包含不支持的文件路径。");
    files.set(`${options.prefix}${name}`, entry.data);
  }
  if (!files.has(`${options.prefix}index.html`)) throw new GitHubPublishingError("Hugo 没有生成网站首页，已停止发布。");
  files.set(".nojekyll", Buffer.alloc(0));
  if (options.cname) files.set("CNAME", Buffer.from(`${options.cname}\n`));
  const paths = [...files.keys()].sort();
  files.set(MANIFEST, Buffer.from(JSON.stringify({ version: 1, owner, paths, signature: manifestSignature(options.manifestKey, owner, paths) })));
  const desired = new Map([...files].map(([name, data]) => [name, { data, sha: gitBlobSha(data) }]));
  const uploaded = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    let head: string | undefined;
    try { head = (await api.request<{ object: { sha: string } }>(token, "GET", `${base}/git/ref/heads/${SITE_PUBLISH_BRANCH}`, undefined, signal)).object.sha; }
    catch (error) { if (!(error instanceof GitHubApiError && error.githubStatus === 404)) throw error; }
    const treeSha = head ? (await api.request<{ tree: { sha: string } }>(token, "GET", `${base}/git/commits/${head}`, undefined, signal)).tree.sha : undefined;
    const remote = new Map((treeSha ? await readTree(api, token, base, treeSha, signal) : []).map((entry) => [entry.path, entry]));
    const previous = new Set(await previousPaths(api, token, base, remote, owner, options.manifestKey, signal));
    const counts: GitHubPublishCounts = { added: 0, modified: 0, deleted: 0, unchanged: 0, uploaded: uploaded.size };
    const delta: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
    const known = new Set([...remote.values()].filter((entry) => entry.type === "blob").map((entry) => entry.sha));
    for (const [name, value] of desired) {
      const existing = remote.get(name);
      const matches = existing?.type === "blob" && existing.mode === "100644" && existing.sha === value.sha;
      // 相同内容不代表属于 Notes；否则本次写入清单后，下次可能误删原有文件。
      // Pages 已配置的 CNAME 与空 .nojekyll 是保留站点配置所需的例外。
      if (existing && !previous.has(name) && name !== MANIFEST && name !== ".nojekyll" && !(name === "CNAME" && matches)) throw new GitHubPublishingError(`目标目录已有非本应用管理的文件「${name.slice(0, 120)}」，请使用空目录或独立仓库。`);
      if (matches) { counts.unchanged++; continue; }
      for (const parent of name.split("/").slice(0, -1).map((_part, index, parts) => parts.slice(0, index + 1).join("/"))) {
        if (remote.has(parent) && remote.get(parent)?.type !== "tree") throw new GitHubPublishingError("目标目录与现有文件冲突，请更换部署子路径。");
      }
      if (existing?.type === "tree" || existing?.type === "commit") throw new GitHubPublishingError("网站文件与现有目录或子模块冲突，请更换部署子路径。");
      counts[existing ? "modified" : "added"]++;
      delta.push({ path: name, mode: "100644", type: "blob", sha: value.sha });
    }
    for (const name of previous) if (!desired.has(name) && remote.has(name)) {
      counts.deleted++; delta.push({ path: name, mode: "100644", type: "blob", sha: null });
    }
    if (!delta.length && head) return { commitSha: head, counts, changed: false };
    await options.onPhase?.("uploading", counts);
    const blobs = new Map(delta.filter((entry) => entry.sha && !known.has(entry.sha) && !uploaded.has(entry.sha)).map((entry) => [entry.sha!, desired.get(entry.path)!.data]));
    const pending = [...blobs]; let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length) {
        const [expected, data] = pending[next++]; signal.throwIfAborted();
        const result = await api.request<{ sha: string }>(token, "POST", `${base}/git/blobs`, { content: data.toString("base64"), encoding: "base64" }, signal);
        if (result.sha !== expected) throw new GitHubPublishingError("GitHub 文件 SHA 校验失败，已停止提交。");
        uploaded.add(expected);
      }
    }));
    counts.uploaded = uploaded.size;
    await options.onPhase?.("committing", counts);
    const tree = await api.request<{ sha: string }>(token, "POST", `${base}/git/trees`, { ...(treeSha ? { base_tree: treeSha } : {}), tree: delta }, signal);
    const commit = await api.request<{ sha: string }>(token, "POST", `${base}/git/commits`, { message: "Publish Notes Hugo website", tree: tree.sha, parents: head ? [head] : [] }, signal);
    try {
      await api.request(token, head ? "PATCH" : "POST", head ? `${base}/git/refs/heads/${SITE_PUBLISH_BRANCH}` : `${base}/git/refs`, head ? { sha: commit.sha, force: false } : { ref: `refs/heads/${SITE_PUBLISH_BRANCH}`, sha: commit.sha }, signal);
      return { commitSha: commit.sha, counts, changed: true };
    } catch (error) {
      // 请求响应丢失时先读回目标 ref，不能把一次成功提交再提交一遍。
      try {
        const latest = await api.request<{ object: { sha: string } }>(token, "GET", `${base}/git/ref/heads/${SITE_PUBLISH_BRANCH}`, undefined, signal);
        if (latest.object.sha === commit.sha) return { commitSha: commit.sha, counts, changed: true };
      } catch { /* Preserve the original error; never force a ref. */ }
      if (!(error instanceof GitHubApiError && [409, 422].includes(error.githubStatus)) || attempt === 2) throw error;
    }
  }
  throw new GitHubPublishingError("分支持续被其他发布修改，请稍后重试。", 409);
}

export async function configurePages(api: GitHubApi, token: string, repository: GitHubSiteRepository, signal: AbortSignal) {
  if (await readPages(api, token, repository, signal)) return;
  try { await api.request(token, "POST", `${repositoryApiPath(repository)}/pages`, { build_type: "legacy", source: { branch: SITE_PUBLISH_BRANCH, path: "/" } }, signal); }
  catch (error) {
    if (error instanceof GitHubApiError && error.githubStatus === 409 && await readPages(api, token, repository, signal)) return;
    if (error instanceof GitHubApiError && error.githubStatus === 403) throw new GitHubPublishingError("无法首次开启 GitHub Pages，请检查仓库管理权限、App 的 Pages/Administration 写权限及 GitHub 限流。网站提交已保留，可由管理员配置 Pages 后重试。", 403);
    throw error;
  }
}

export async function waitForPages(options: { api: GitHubApi; token: string; repository: GitHubSiteRepository; commitSha: string; signal: AbortSignal; pollMs?: number }) {
  const { api, token, repository, commitSha, signal } = options;
  const base = repositoryApiPath(repository);
  let requested = false;
  while (true) {
    signal.throwIfAborted();
    try {
      const build = await api.request<{ commit: string; status: string; error?: { message?: string } }>(token, "GET", `${base}/pages/builds/latest`, undefined, signal);
      if (build.commit === commitSha) {
        if (build.status === "built") return;
        if (build.status === "errored") throw new GitHubPublishingError("GitHub Pages 构建失败。网站提交已保留，请检查仓库 Pages 构建日志后重试。");
        // GitHub 已受理本次版本，等待它完成，避免重复排队。
        requested = true;
      }
    } catch (error) { if (!(error instanceof GitHubApiError && error.githubStatus === 404)) throw error; }
    if (!requested) {
      await api.request(token, "POST", `${base}/pages/builds`, {}, signal);
      requested = true;
    }
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
      const timer = setTimeout(done, options.pollMs ?? 5000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
