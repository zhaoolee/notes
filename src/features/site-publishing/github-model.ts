export interface GitHubSiteRepository {
  id: number;
  installationId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
}
export interface GitHubPublishCounts { added: number; modified: number; deleted: number; unchanged: number; uploaded: number }
export type GitHubPublishPhase = "queued" | "building" | "uploading" | "committing" | "deploying" | "published" | "failed" | "interrupted";
export type GitHubLocalSitePhase = "pending" | "building" | "published" | "failed";
export interface GitHubLocalSiteStatus {
  phase: GitHubLocalSitePhase;
  url: string;
  message: string;
}
export interface GitHubPublishJob {
  id: string;
  phase: GitHubPublishPhase;
  message: string;
  startedAt: number;
  updatedAt: number;
  commitSha?: string;
  commitUrl?: string;
  siteUrl?: string;
  counts?: GitHubPublishCounts;
  /** 管理员配置的本站镜像；旧任务没有该字段时保持 GitHub-only 行为。 */
  localSite?: GitHubLocalSiteStatus;
}
export interface GitHubPublishingStatus {
  enabled: boolean;
  connected: boolean;
  githubLogin?: string;
  /** 只有管理员配置且允许的本站账号才为 true，其他账号缺省。 */
  localSiteEnabled?: boolean;
  repository: GitHubSiteRepository | null;
  job: GitHubPublishJob | null;
}
export const activeGitHubPublishPhases: readonly GitHubPublishPhase[] = ["queued", "building", "uploading", "committing", "deploying"];
