import type { NoteWorkspace } from "../types/app.js";
import { shouldApplyPolledWorkspace } from "./workspace-save.js";

/**
 * 顶栏“刷新便签”不再重载整个页面。已登录账号只重新读取云端工作区，
 * 匿名账号只重新读取浏览器本地工作区。这里集中放置两类刷新共用的纯判断，
 * 避免把“读取期间继续编辑 / 切换账号”的竞态散落在组件里。
 */
export interface CloudWorkspaceRefreshRequest {
  /** 发起读取时的登录账号 ID；身份变化后旧结果一律丢弃。 */
  userId: string;
  /** 发起读取时的云端版本，用于识别读取期间完成的本地保存。 */
  revision: number;
}

export interface CloudWorkspaceRefreshDecisionInput {
  request: CloudWorkspaceRefreshRequest;
  /** 判定时刻的真实登录账号 ID，匿名或会话失效时为 null。 */
  currentUserId: string | null;
  /** 判定时刻的云端版本，本地保存落地后会推进。 */
  currentRevision: number;
  /** 判定时刻是否仍有防抖定时器或 PUT 在途。 */
  hasPendingLocalSave: boolean;
  /** 读取期间便签或文件夹被修改；即使保存已失败也不能覆盖这些编辑。 */
  hasLocalChanges?: boolean;
  /** 组件卸载、退出登录或发起新一轮刷新后，旧请求必须作废。 */
  isCancelled: boolean;
  /** GET /api/workspace 返回的云端版本。 */
  fetchedUpdatedAt: number | null | undefined;
}

export type CloudWorkspaceRefreshDiscardReason =
  | "cancelled"
  | "session-changed"
  | "pending-local-save"
  | "local-workspace-changed"
  | "revision-advanced"
  | "cloud-workspace-empty"
  | "cloud-workspace-not-newer";

export type CloudWorkspaceRefreshDecision =
  | { action: "apply" }
  | { action: "discard"; reason: CloudWorkspaceRefreshDiscardReason };

/**
 * 云端读取结果是否可以覆盖当前工作区。判断顺序按危险程度排列：
 * 1. 请求已作废或账号已切换：绝不覆盖。
 * 2. 仍有本地保存待处理：保留本机最新编辑，让既有的保存队列先落地。
 * 3. 读取期间有保存完成：本次响应可能比服务端现状更旧，丢弃。
 * 4. 云端没有更新版本（含云端为空）：保留当前内容，且绝不回写本地旧快照。
 */
export function decideCloudWorkspaceRefresh(
  input: CloudWorkspaceRefreshDecisionInput,
): CloudWorkspaceRefreshDecision {
  if (input.isCancelled) {
    return { action: "discard", reason: "cancelled" };
  }

  if (
    input.currentUserId === null ||
    input.currentUserId !== input.request.userId
  ) {
    return { action: "discard", reason: "session-changed" };
  }

  if (input.hasPendingLocalSave) {
    return { action: "discard", reason: "pending-local-save" };
  }

  if (input.hasLocalChanges) {
    return { action: "discard", reason: "local-workspace-changed" };
  }

  if (input.currentRevision !== input.request.revision) {
    return { action: "discard", reason: "revision-advanced" };
  }

  if (
    input.fetchedUpdatedAt === null ||
    input.fetchedUpdatedAt === undefined
  ) {
    return { action: "discard", reason: "cloud-workspace-empty" };
  }

  const shouldApply = shouldApplyPolledWorkspace({
    polledUpdatedAt: input.fetchedUpdatedAt,
    knownRevision: input.currentRevision,
    hasPendingLocalSave: input.hasPendingLocalSave,
  });

  return shouldApply
    ? { action: "apply" }
    : { action: "discard", reason: "cloud-workspace-not-newer" };
}

export interface AnonymousWorkspaceRefreshInput {
  /** 当前内存中的工作区，包含可能尚未落盘的最新编辑。 */
  current: NoteWorkspace;
  /** 从浏览器 localStorage 重新读到的工作区。 */
  persisted: NoteWorkspace | null;
}

export interface AnonymousWorkspaceRefreshResult {
  workspace: NoteWorkspace;
  source: "browser-storage" | "in-memory";
}

/**
 * 匿名刷新只重新读取本地持久化工作区，绝不访问云端。
 * storage 比内存更旧（例如便签只存在于内存、或内存中的正文更新时间更晚）时
 * 继续使用内存快照，保证最新未保存编辑不会被一次刷新回退。
 */
export function resolveAnonymousWorkspaceRefresh(
  input: AnonymousWorkspaceRefreshInput,
): AnonymousWorkspaceRefreshResult {
  const { current, persisted } = input;

  if (!persisted || persisted.notes.length === 0) {
    return { workspace: current, source: "in-memory" };
  }

  const persistedNotes = new Map(
    persisted.notes.map((note) => [note.id, note] as const),
  );
  const persistedFolders = new Set(persisted.folders.map((folder) => folder.id));

  for (const note of current.notes) {
    const stored = persistedNotes.get(note.id);

    if (!stored || stored.updatedAt < note.updatedAt) {
      return { workspace: current, source: "in-memory" };
    }
  }

  for (const folder of current.folders) {
    if (!persistedFolders.has(folder.id)) {
      return { workspace: current, source: "in-memory" };
    }
  }

  return { workspace: persisted, source: "browser-storage" };
}

/**
 * 云端结果被丢弃时的非错误提示。账号切换与请求作废不再提示，
 * 因为界面已经切换到新的身份。
 */
export function getCloudWorkspaceRefreshNotice(
  reason: CloudWorkspaceRefreshDiscardReason,
): string | null {
  switch (reason) {
    case "pending-local-save":
      return "有尚未保存的修改，已保留当前编辑。";
    case "local-workspace-changed":
      return "读取期间便签有修改，已保留当前编辑。";
    case "revision-advanced":
      return "读取期间完成了本地保存，已保留当前内容。";
    case "cloud-workspace-empty":
      return "云端暂无便签，已保留当前内容。";
    case "cloud-workspace-not-newer":
      return "云端没有更新的版本，已保留当前内容。";
    default:
      return null;
  }
}

export const NOTE_REFRESH_FAILURE_PREFIX = "刷新便签失败：";

/** 刷新失败时的用户可见文案；接口错误正文原样带上，空值使用稳定兑底。 */
export function getCloudWorkspaceRefreshFailureMessage(error: unknown): string {
  const detail =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "无法读取云端便签。";

  return `${NOTE_REFRESH_FAILURE_PREFIX}${detail}`;
}
