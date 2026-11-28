import { createPrivateKey, createSign } from "node:crypto";
import fs from "node:fs/promises";
import type { GitHubSiteRepository } from "../../src/features/site-publishing/github-model.js";

export interface GitHubAppConfig {
  appId: number; slug: string; clientId: string; clientSecret: string;
  privateKey: string; tokenKey: Buffer; callbackUrl: string;
}
export class GitHubPublishingError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
export class GitHubApiError extends GitHubPublishingError {
  constructor(readonly githubStatus: number, message: string) { super(message, githubStatus === 401 ? 401 : githubStatus === 429 ? 429 : 422); }
}

export async function loadGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): Promise<GitHubAppConfig | null> {
  const { GITHUB_APP_ID: id, GITHUB_APP_SLUG: slug, GITHUB_APP_CLIENT_ID: clientId, GITHUB_APP_CLIENT_SECRET: clientSecret, GITHUB_PUBLISH_TOKEN_KEY: tokenKey } = env;
  if (!id || !slug || !clientId || !clientSecret || !tokenKey || (!env.GITHUB_APP_PRIVATE_KEY && !env.GITHUB_APP_PRIVATE_KEY_PATH)) return null;
  const callbackUrl = env.GITHUB_APP_CALLBACK_URL || `${(env.NOTES_PUBLIC_BASE_URL || "").replace(/\/$/, "")}/api/site-publishing/github/callback`;
  const callback = new URL(callbackUrl);
  if (callback.protocol !== "https:" && !(callback.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(callback.hostname))) throw new Error("GitHub App 回调必须使用 HTTPS（本机回环除外）。");
  if (callback.username || callback.password || callback.search || callback.hash) throw new Error("GitHub App 回调地址不正确。");
  const key = Buffer.from(tokenKey.trim(), "base64");
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !/^[a-z0-9-]+$/i.test(slug) || key.length !== 32 || key.toString("base64") !== tokenKey.trim()) throw new Error("GitHub App ID、Slug 或加密密钥配置不正确。");
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n") || await fs.readFile(env.GITHUB_APP_PRIVATE_KEY_PATH!, "utf8");
  if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") throw new Error("GitHub App 私钥必须为 RSA。");
  return { appId: Number(id), slug, clientId, clientSecret, privateKey, tokenKey: key, callbackUrl: callback.href };
}

export interface GitHubTokens { accessToken: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number }
export interface GitHubUser { id: number; login: string }
export interface GitTreeEntry { path: string; mode: string; type: "blob" | "tree" | "commit"; sha: string; size?: number }
export interface GitTree { sha: string; truncated: boolean; tree: GitTreeEntry[] }
export interface GitHubPages { html_url: string; cname?: string | null; build_type?: string; source?: { branch: string; path: string }; status?: string }

/** All credential-bearing calls are pinned to GitHub, never to user-supplied URLs. */
export class GitHubApi {
  constructor(readonly config: GitHubAppConfig, private fetchImpl: typeof fetch = fetch) {}
  async request<T>(token: string, method: string, pathname: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    if (!pathname.startsWith("/") || pathname.startsWith("//")) throw new Error("Invalid GitHub API path");
    return this.json<T>(`https://api.github.com${pathname}`, {
      method, headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "notes-hugo-publisher", Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal,
    });
  }
  private async json<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(30_000)]) });
    } catch {
      if (init.signal?.aborted) throw init.signal.reason;
      throw new GitHubPublishingError("无法连接 GitHub，请检查网络后重试。", 502);
    }
    if (!response.ok) {
      void response.body?.cancel();
      throw new GitHubApiError(response.status, response.status === 401 ? "GitHub 授权已失效，请重新授权。"
        : response.status === 403 || response.status === 429 ? "GitHub 权限不足或访问频率已达上限，请检查仓库授权后稍后重试。"
        : response.status === 404 ? "GitHub 仓库、分支或 Pages 尚不存在，或授权已被撤销。"
        : response.status === 409 || response.status === 422 ? "GitHub 拒绝更新，可能存在分支保护、空仓库或并发提交，请刷新后重试。"
        : "GitHub 服务暂时不可用，请稍后重试。");
    }
    if (response.status === 204) return undefined as T;
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (response.body) for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) throw new GitHubPublishingError("GitHub 返回的数据过大，请缩小发布仓库。");
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; }
    catch { throw new GitHubPublishingError("GitHub 返回了无效响应，请重试。", 502); }
  }
  async exchangeToken(fields: Record<string, string>, signal?: AbortSignal): Promise<GitHubTokens> {
    const value = await this.json<{ access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number }>("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...fields }),
    });
    if (!value.access_token) throw new GitHubPublishingError("GitHub 授权码或刷新授权已失效，请重新授权。", 401);
    return { accessToken: value.access_token, refreshToken: value.refresh_token,
      expiresAt: value.expires_in ? Date.now() + value.expires_in * 1000 : undefined,
      refreshExpiresAt: value.refresh_token_expires_in ? Date.now() + value.refresh_token_expires_in * 1000 : undefined };
  }
  user(token: string, signal?: AbortSignal): Promise<GitHubUser> { return this.request(token, "GET", "/user", undefined, signal); }
  async repositories(token: string, signal?: AbortSignal): Promise<GitHubSiteRepository[]> {
    const repositories: GitHubSiteRepository[] = [];
    for (let page = 1; ; page++) {
      const result = await this.request<{ installations: { id: number; app_id: number; suspended_at: string | null }[] }>(token, "GET", `/user/installations?per_page=100&page=${page}`, undefined, signal);
      for (const installation of result.installations) {
        if (installation.app_id !== this.config.appId || installation.suspended_at) continue;
        for (let repoPage = 1; ; repoPage++) {
          const list = await this.request<{ repositories: { id: number; name: string; full_name: string; owner: { login: string }; default_branch: string; archived: boolean; disabled: boolean; permissions?: { push?: boolean; admin?: boolean; maintain?: boolean } }[] }>(token, "GET", `/user/installations/${installation.id}/repositories?per_page=100&page=${repoPage}`, undefined, signal);
          for (const repo of list.repositories) if (!repo.archived && !repo.disabled && repo.permissions?.push && /^[a-z0-9_.-]+$/i.test(repo.name) && /^[a-z0-9-]+$/i.test(repo.owner.login)) {
            repositories.push({ id: repo.id, installationId: installation.id, owner: repo.owner.login, name: repo.name, fullName: repo.full_name, defaultBranch: repo.default_branch });
          }
          if (list.repositories.length < 100) break;
          if (repoPage > 100) throw new GitHubPublishingError("仓库列表过大，请仅授权需要发布的仓库。");
        }
      }
      if (result.installations.length < 100) break;
      if (page > 100) throw new GitHubPublishingError("安装列表过大，请缩小授权范围。");
    }
    return repositories;
  }
  async installationToken(repository: GitHubSiteRepository, signal?: AbortSignal): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({ iat: now - 60, exp: now + 540, iss: this.config.clientId })}`;
    const signature = createSign("RSA-SHA256").update(body).sign(this.config.privateKey, "base64url");
    const result = await this.request<{ token: string }>(`${body}.${signature}`, "POST", `/app/installations/${repository.installationId}/access_tokens`, { repository_ids: [repository.id], permissions: { contents: "write", pages: "write" } }, signal);
    if (!result.token) throw new GitHubPublishingError("GitHub 未返回仓库授权，请重新授权。");
    return result.token;
  }
}
