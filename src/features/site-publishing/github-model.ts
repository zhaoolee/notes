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
}
export interface GitHubPublishingStatus {
  enabled: boolean;
  connected: boolean;
  githubLogin?: string;
  repository: GitHubSiteRepository | null;
  job: GitHubPublishJob | null;
}
export const activeGitHubPublishPhases: readonly GitHubPublishPhase[] = ["queued", "building", "uploading", "committing", "deploying"];
