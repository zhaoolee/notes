import type { NoteDocument } from "../../types/app.js";
import {
  activeGitHubPublishPhases,
  type GitHubPublishCounts,
  type GitHubPublishJob,
  type GitHubPublishPhase,
  type GitHubPublishingStatus,
  type GitHubSiteRepository,
} from "./github-model.js";
import { buildSiteExportRequest, type SitePublishDraft } from "./model.js";

export const GITHUB_PUBLISHING_STATUS_ENDPOINT =
  "/api/site-publishing/github/status";
export const GITHUB_PUBLISHING_REPOSITORIES_ENDPOINT =
  "/api/site-publishing/github/repositories";
export const GITHUB_PUBLISHING_CONNECT_ENDPOINT =
  "/api/site-publishing/github/connect";
export const GITHUB_PUBLISHING_REPOSITORY_ENDPOINT =
  "/api/site-publishing/github/repository";
export const GITHUB_PUBLISHING_PUBLISH_ENDPOINT =
  "/api/site-publishing/github/publish";
export const GITHUB_PUBLISHING_CONNECTION_ENDPOINT =
  "/api/site-publishing/github/connection";

/** OAuth 回调只消费这一个查询参数，其余查询参数和编辑器 hash 保持不变。 */
export const GITHUB_PUBLISH_REDIRECT_PARAM = "githubPublish";
export type GitHubPublishRedirect = "connected" | "error";

const PUBLISH_PHASES = new Set<GitHubPublishPhase>(
  activeGitHubPublishPhases,
);
const TERMINAL_PUBLISH_PHASES = new Set<GitHubPublishPhase>([
  "published",
  "failed",
  "interrupted",
]);

export class GitHubPublishError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GitHubPublishError";
    this.status = status;
  }
}

export interface GitHubRequestOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** 当前面板确认的目标，防止另一设备切换绑定后误发到新仓库。 */
  repositoryId?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function parseRepository(value: unknown): GitHubSiteRepository {
  if (!isRecord(value)) {
    throw new GitHubPublishError("GitHub 仓库信息格式不正确。");
  }

  const id = readNonNegativeInteger(value.id);
  const installationId = readNonNegativeInteger(value.installationId);
  const owner = readString(value.owner);
  const name = readString(value.name);
  const fullName = readString(value.fullName);
  const defaultBranch = readString(value.defaultBranch);

  if (id === null || installationId === null || !owner || !name || !fullName) {
    throw new GitHubPublishError("GitHub 仓库信息格式不正确。");
  }

  return { id, installationId, owner, name, fullName, defaultBranch };
}

/** repository 只信任后端返回的结构；缺失或非法时按未绑定处理，避免误发布。 */
function parseRepositoryOrNull(value: unknown): GitHubSiteRepository | null {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    return parseRepository(value);
  } catch {
    return null;
  }
}

function parseCounts(value: unknown): GitHubPublishCounts | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const added = readNonNegativeInteger(value.added);
  const modified = readNonNegativeInteger(value.modified);
  const deleted = readNonNegativeInteger(value.deleted);
  const unchanged = readNonNegativeInteger(value.unchanged);
  const uploaded = readNonNegativeInteger(value.uploaded);

  if (
    added === null ||
    modified === null ||
    deleted === null ||
    unchanged === null ||
    uploaded === null
  ) {
    return undefined;
  }

  return { added, modified, deleted, unchanged, uploaded };
}

function parseJob(value: unknown): GitHubPublishJob | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new GitHubPublishError("GitHub 发布任务格式不正确。");
  }

  const id = readString(value.id);
  const phase = readString(value.phase) as GitHubPublishPhase;

  if (
    !id ||
    (!PUBLISH_PHASES.has(phase) && !TERMINAL_PUBLISH_PHASES.has(phase))
  ) {
    throw new GitHubPublishError("GitHub 发布任务格式不正确。");
  }

  const startedAt = readNonNegativeInteger(value.startedAt) ?? 0;
  const updatedAt = readNonNegativeInteger(value.updatedAt) ?? startedAt;
  const job: GitHubPublishJob = {
    id,
    phase,
    message: typeof value.message === "string" ? value.message : "",
    startedAt,
    updatedAt,
  };

  const commitSha = readString(value.commitSha);
  const commitUrl = readString(value.commitUrl);
  const siteUrl = readString(value.siteUrl);
  const counts = parseCounts(value.counts);

  if (commitSha) job.commitSha = commitSha;
  if (commitUrl) job.commitUrl = commitUrl;
  if (siteUrl) job.siteUrl = siteUrl;
  if (counts) job.counts = counts;

  return job;
}

export function parseGitHubPublishingStatus(
  payload: unknown,
): GitHubPublishingStatus {
  if (!isRecord(payload)) {
    throw new GitHubPublishError("GitHub 发布状态响应格式不正确。");
  }

  if (typeof payload.enabled !== "boolean" || typeof payload.connected !== "boolean") {
    throw new GitHubPublishError("GitHub 发布状态响应格式不正确。");
  }

  const githubLogin = readString(payload.githubLogin);
  const status: GitHubPublishingStatus = {
    enabled: payload.enabled,
    connected: payload.connected,
    repository: parseRepositoryOrNull(payload.repository),
    job: parseJob(payload.job),
  };

  if (githubLogin) {
    status.githubLogin = githubLogin;
  }

  return status;
}

export function parseGitHubRepositories(
  payload: unknown,
): GitHubSiteRepository[] {
  if (!isRecord(payload) || !Array.isArray(payload.repositories)) {
    throw new GitHubPublishError("GitHub 仓库列表响应格式不正确。");
  }

  return payload.repositories.map((repository) => parseRepository(repository));
}

/**
 * 只接受后端生成、可安全跳转的 HTTPS 地址。
 * 站点地址允许自定义域名；GitHub 跳转和提交链接必须落在 GitHub 域名下。
 */
export function sanitizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > 2048) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function isGitHubHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "github.com" || host.endsWith(".github.com");
}

export function sanitizeGitHubHostUrl(value: unknown): string | null {
  const url = sanitizeHttpsUrl(value);

  if (!url) {
    return null;
  }

  return isGitHubHostname(new URL(url).hostname) ? url : null;
}

export function sanitizeGitHubSiteUrl(value: unknown): string | null {
  return sanitizeHttpsUrl(value);
}

export function sanitizeGitHubCommitUrl(value: unknown): string | null {
  return sanitizeGitHubHostUrl(value);
}

async function readErrorPayload(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      if (isRecord(payload)) {
        const message = readString(payload.error);
        if (message) return message;
      }
    }

    const text = (await response.text()).trim();
    return text.length > 0 && text.length <= 300 ? text : "";
  } catch {
    return "";
  }
}

interface GitHubRequestInit extends GitHubRequestOptions {
  method?: string;
  body?: unknown;
}

async function requestGitHubJson(
  endpoint: string,
  init: GitHubRequestInit = {},
): Promise<unknown> {
  const fetchImpl =
    init.fetchImpl ?? (typeof fetch === "function" ? fetch : null);

  if (!fetchImpl) {
    throw new GitHubPublishError("当前环境不支持 GitHub 发布。");
  }

  let response: Response;

  try {
    response = await fetchImpl(endpoint, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.repositoryId ? { "X-Notes-GitHub-Repository-Id": String(init.repositoryId) } : {}),
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(10_000)]),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    if (error instanceof Error && error.name === "TimeoutError") {
      throw new GitHubPublishError("GitHub 发布服务响应超时，请刷新状态后重试。", 504);
    }
    throw new GitHubPublishError(
      "无法连接 GitHub 发布服务，请确认后端已启动后重试。",
    );
  }

  if (!response.ok) {
    const message = await readErrorPayload(response);
    throw new GitHubPublishError(
      message || `GitHub 发布请求失败（${response.status}）。`,
      response.status,
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GitHubPublishError("GitHub 发布服务返回了无法解析的响应。");
  }
}

export async function fetchGitHubPublishingStatus(
  options: GitHubRequestOptions = {},
): Promise<GitHubPublishingStatus> {
  const payload = await requestGitHubJson(GITHUB_PUBLISHING_STATUS_ENDPOINT, options);
  return parseGitHubPublishingStatus(payload);
}

export async function fetchGitHubRepositories(
  options: GitHubRequestOptions = {},
): Promise<GitHubSiteRepository[]> {
  const payload = await requestGitHubJson(
    GITHUB_PUBLISHING_REPOSITORIES_ENDPOINT,
    options,
  );
  return parseGitHubRepositories(payload);
}

/** 返回后端生成的 GitHub App 安装地址；调用方只允许跳转到该地址。 */
export async function createGitHubConnectUrl(
  options: GitHubRequestOptions = {},
): Promise<string> {
  const payload = await requestGitHubJson(
    GITHUB_PUBLISHING_CONNECT_ENDPOINT,
    { ...options, method: "POST" },
  );

  const url =
    isRecord(payload) && typeof payload.url === "string"
      ? sanitizeGitHubHostUrl(payload.url)
      : null;

  if (!url) {
    throw new GitHubPublishError(
      "GitHub 授权地址不正确，请稍后重试。",
    );
  }

  return url;
}

export async function selectGitHubRepository(
  repository: Pick<GitHubSiteRepository, "id" | "installationId">,
  options: GitHubRequestOptions = {},
): Promise<GitHubPublishingStatus> {
  const payload = await requestGitHubJson(
    GITHUB_PUBLISHING_REPOSITORY_ENDPOINT,
    {
      ...options,
      method: "PUT",
      body: {
        repositoryId: repository.id,
        installationId: repository.installationId,
      },
    },
  );
  return parseGitHubPublishingStatus(payload);
}

export async function disconnectGitHub(
  options: GitHubRequestOptions = {},
): Promise<GitHubPublishingStatus> {
  const payload = await requestGitHubJson(
    GITHUB_PUBLISHING_CONNECTION_ENDPOINT,
    { ...options, method: "DELETE" },
  );
  return parseGitHubPublishingStatus(payload);
}

export interface GitHubPublishJobResponse {
  job: GitHubPublishJob;
}

export function parseGitHubPublishJobResponse(
  payload: unknown,
): GitHubPublishJobResponse {
  if (!isRecord(payload)) {
    throw new GitHubPublishError("GitHub 发布任务响应格式不正确。");
  }

  const job = parseJob(payload.job);

  if (!job) {
    throw new GitHubPublishError("GitHub 发布任务响应格式不正确。");
  }

  return { job };
}

/**
 * 先按与 ZIP 导出完全相同的契约校验草稿，再提交给后端。
 * 校验失败时不会发出网络请求，也不会把便签正文写到发布面板之外。
 */
export async function publishSiteToGitHub(
  draft: SitePublishDraft,
  notes: NoteDocument[],
  options: GitHubRequestOptions = {},
): Promise<GitHubPublishJob> {
  const request = buildSiteExportRequest(draft, notes);
  const payload = await requestGitHubJson(
    GITHUB_PUBLISHING_PUBLISH_ENDPOINT,
    { ...options, method: "POST", body: request },
  );
  return parseGitHubPublishJobResponse(payload).job;
}

export function readGitHubPublishRedirectFromUrl(
  href: string,
): GitHubPublishRedirect | null {
  try {
    const value = new URL(href).searchParams.get(GITHUB_PUBLISH_REDIRECT_PARAM);
    return value === "connected" || value === "error" ? value : null;
  } catch {
    return null;
  }
}

/** 只移除 OAuth 标记，保留其他查询参数与编辑器 hash。 */
export function getUrlAfterConsumingGitHubPublishRedirect(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(GITHUB_PUBLISH_REDIRECT_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
