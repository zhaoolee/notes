import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveWorkspaceActiveNote } from "../../src/lib/notes.js";
import {
  decideCloudWorkspaceRefresh,
  getCloudWorkspaceRefreshFailureMessage,
  getCloudWorkspaceRefreshNotice,
  NOTE_REFRESH_FAILURE_PREFIX,
  resolveAnonymousWorkspaceRefresh,
} from "../../src/lib/workspace-refresh.js";
import type { NoteDocument, NoteWorkspace } from "../../src/types/app.js";

const appSource = readFileSync("src/App.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

function createNote(
  id: string,
  markdown: string,
  overrides: Partial<NoteDocument> = {},
): NoteDocument {
  return {
    id,
    markdown,
    createdAt: 1,
    updatedAt: 1,
    normalOrder: 0,
    pinnedAt: null,
    folderId: null,
    isStarred: false,
    deletedAt: null,
    ...overrides,
  };
}

function createWorkspace(
  notes: NoteDocument[],
  overrides: Partial<NoteWorkspace> = {},
): NoteWorkspace {
  return {
    activeNoteId: notes[0]?.id ?? "",
    folders: [],
    notes,
    version: 1,
    ...overrides,
  };
}

/** 顶栏刷新只允许重读工作区，不能导航、不能整页重载、不能回写旧快照。 */
function getRefreshHandlerSource(): string {
  const start = appSource.indexOf("async function handleRefreshNotes()");
  assert.notEqual(start, -1, "App 应保留 async handleRefreshNotes");

  const end = appSource.indexOf("function handleSelectNote(", start);
  assert.ok(end > start, "刷新处理函数后应紧跟便签选择逻辑");

  return appSource.slice(start, end);
}

const refreshHandlerSource = getRefreshHandlerSource();

test("云端有更新版本时应用云端工作区并保留当前选中便签", () => {
  const decision = decideCloudWorkspaceRefresh({
    request: { userId: "user-1", revision: 100 },
    currentUserId: "user-1",
    currentRevision: 100,
    hasPendingLocalSave: false,
    isCancelled: false,
    fetchedUpdatedAt: 200,
  });

  assert.deepEqual(decision, { action: "apply" });

  const cloudWorkspace = createWorkspace([
    createNote("note-b", "另一台设备的新内容", {
      updatedAt: 200,
      normalOrder: -1,
    }),
    createNote("note-a", "本机选中的便签也存在于云端", { updatedAt: 150 }),
  ]);

  // 刷新后当前便签 ID 仍然有效就必须继续选中它，只跟随其新位置。
  assert.equal(
    resolveWorkspaceActiveNote(cloudWorkspace, "note-a")?.id,
    "note-a",
  );
  assert.equal(refreshHandlerSource.includes("preserveActiveNote: true"), true);
});

test("云端数据更新不会触发导航或整页重载", () => {
  assert.doesNotMatch(appSource, /window\.location\.reload\(\)/);
  assert.doesNotMatch(appSource, /window\.location\.href\s*=/);
  assert.doesNotMatch(refreshHandlerSource, /writeCurrentNoteRoute/);
  assert.doesNotMatch(refreshHandlerSource, /setSearchQuery/);
  assert.doesNotMatch(refreshHandlerSource, /setActiveCategoryId/);
  assert.doesNotMatch(refreshHandlerSource, /setDesktopWorkspaceView/);
  assert.doesNotMatch(refreshHandlerSource, /setMobileWorkspaceView/);
  // 刷新只读取云端，绝不能把本地旧快照 PUT 回去覆盖云端最新数据。
  assert.doesNotMatch(refreshHandlerSource, /saveCloudWorkspace/);
  assert.doesNotMatch(refreshHandlerSource, /cloudSaveQueueRef\.current\?\.enqueue/);
});

test("刷新按钮在读取期间防重入，完成或失败后恢复可用", () => {
  assert.match(
    refreshHandlerSource,
    /if \(isRefreshingNotesRef\.current\) \{\s*return;\s*\}/,
  );
  assert.match(refreshHandlerSource, /isRefreshingNotesRef\.current = true;/);
  assert.match(refreshHandlerSource, /setIsRefreshingNotes\(true\);/);
  assert.match(
    refreshHandlerSource,
    /finally \{[\s\S]*if \(refreshRequestRef\.current === requestId\) \{[\s\S]*isRefreshingNotesRef\.current = false;[\s\S]*setIsRefreshingNotes\(false\);/,
  );
  assert.match(appSource, /disabled=\{isRefreshingNotes\}/);
  // 旋转反馈保留：按钮处于 is-refreshing 时旋转，最短展示一个动画周期。
  assert.match(
    refreshHandlerSource,
    /const feedbackDeadline = Date\.now\(\) \+ NOTE_REFRESH_DELAY_MS;/,
  );
  assert.match(appSource, /const NOTE_REFRESH_DELAY_MS = 650;/);
  assert.match(
    styles,
    /\.desktop-refresh-note\.is-refreshing \.icon-refresh\s*\{[^}]*animation:\s*smartisan-refresh-spin 600ms cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\) both;[^}]*will-change:\s*transform;/s,
  );
});

test("读取期间仍有未保存的编辑时丢弃云端结果", () => {
  const decision = decideCloudWorkspaceRefresh({
    request: { userId: "user-1", revision: 100 },
    currentUserId: "user-1",
    currentRevision: 100,
    hasPendingLocalSave: true,
    isCancelled: false,
    fetchedUpdatedAt: 200,
  });

  assert.deepEqual(decision, {
    action: "discard",
    reason: "pending-local-save",
  });
  assert.equal(
    getCloudWorkspaceRefreshNotice("pending-local-save"),
    "有尚未保存的修改，已保留当前编辑。",
  );
});

test("读取期间完成的本地保存会让本次响应过期", () => {
  const decision = decideCloudWorkspaceRefresh({
    request: { userId: "user-1", revision: 100 },
    currentUserId: "user-1",
    currentRevision: 150,
    hasPendingLocalSave: false,
    isCancelled: false,
    fetchedUpdatedAt: 140,
  });

  assert.deepEqual(decision, {
    action: "discard",
    reason: "revision-advanced",
  });
  assert.equal(
    getCloudWorkspaceRefreshNotice("revision-advanced"),
    "读取期间完成了本地保存，已保留当前内容。",
  );
});

test("读取期间编辑后即使保存已经失败，也不能应用旧的云端响应", () => {
  assert.deepEqual(decideCloudWorkspaceRefresh({
    request: { userId: "user-1", revision: 100 },
    currentUserId: "user-1",
    currentRevision: 100,
    hasPendingLocalSave: false,
    hasLocalChanges: true,
    isCancelled: false,
    fetchedUpdatedAt: 200,
  }), { action: "discard", reason: "local-workspace-changed" });
  assert.match(refreshHandlerSource, /requestedWorkspace\.notes !== currentWorkspace\.notes/);
  assert.match(refreshHandlerSource, /requestedWorkspace\.folders !== currentWorkspace\.folders/);
  assert.match(refreshHandlerSource, /hadPendingLocalSave \|\| hasPendingLocalSave\(\)/);
  assert.match(appSource, /onError: \(error\) => \{\s*hasFailedLocalSaveRef\.current = true;/);
});

test("读取期间切换账号、退出登录或卸载时丢弃旧结果且不提示", () => {
  const base = {
    request: { userId: "user-1", revision: 100 },
    currentRevision: 100,
    hasPendingLocalSave: false,
    fetchedUpdatedAt: 200,
  };

  assert.deepEqual(
    decideCloudWorkspaceRefresh({
      ...base,
      currentUserId: "user-2",
      isCancelled: false,
    }),
    { action: "discard", reason: "session-changed" },
  );
  assert.deepEqual(
    decideCloudWorkspaceRefresh({
      ...base,
      currentUserId: null,
      isCancelled: false,
    }),
    { action: "discard", reason: "session-changed" },
  );
  assert.deepEqual(
    decideCloudWorkspaceRefresh({
      ...base,
      currentUserId: "user-1",
      isCancelled: true,
    }),
    { action: "discard", reason: "cancelled" },
  );

  assert.equal(getCloudWorkspaceRefreshNotice("session-changed"), null);
  assert.equal(getCloudWorkspaceRefreshNotice("cancelled"), null);

  // 账号切换、退出登录和组件卸载都必须推进请求号让在途读取作废。
  assert.match(
    appSource,
    /function cancelNoteRefresh\(\) \{\s*refreshRequestRef\.current \+= 1;/,
  );
  assert.match(
    appSource,
    /function resetAuthenticatedClientState\(\) \{\s*cancelNoteRefresh\(\);/,
  );
  assert.match(
    appSource,
    /async function handleUserAuthenticated\(user: AuthUser\) \{[\s\S]*?cancelNoteRefresh\(\);/,
  );
  assert.match(
    appSource,
    /return \(\) => \{[\s\S]*?refreshRequestRef\.current \+= 1;/,
  );
});

test("读取失败给出明确反馈，按钮恢复并可重试", () => {
  assert.equal(
    getCloudWorkspaceRefreshFailureMessage(new Error("无法读取登录状态。")),
    `${NOTE_REFRESH_FAILURE_PREFIX}无法读取登录状态。`,
  );
  assert.equal(
    getCloudWorkspaceRefreshFailureMessage(new Error("   ")),
    `${NOTE_REFRESH_FAILURE_PREFIX}无法读取云端便签。`,
  );
  assert.equal(
    getCloudWorkspaceRefreshFailureMessage(null),
    `${NOTE_REFRESH_FAILURE_PREFIX}无法读取云端便签。`,
  );

  assert.match(refreshHandlerSource, /catch \(error\) \{/);
  assert.match(
    refreshHandlerSource,
    /tone: "error",\s*message: getCloudWorkspaceRefreshFailureMessage\(error\),/,
  );
  assert.match(
    appSource,
    /className=\{`note-refresh-feedback is-\$\{noteRefreshFeedback\.tone\}`\}[\s\S]*role=\{noteRefreshFeedback\.tone === "error" \? "alert" : "status"\}[\s\S]*className="note-refresh-retry"[\s\S]*重试/s,
  );
});

test("云端没有更新版本或为空时保留当前内容", () => {
  const notNewer = decideCloudWorkspaceRefresh({
    request: { userId: "user-1", revision: 100 },
    currentUserId: "user-1",
    currentRevision: 100,
    hasPendingLocalSave: false,
    isCancelled: false,
    fetchedUpdatedAt: 100,
  });
  assert.deepEqual(notNewer, {
    action: "discard",
    reason: "cloud-workspace-not-newer",
  });

  const empty = decideCloudWorkspaceRefresh({
    request: { userId: "user-1", revision: 100 },
    currentUserId: "user-1",
    currentRevision: 100,
    hasPendingLocalSave: false,
    isCancelled: false,
    fetchedUpdatedAt: null,
  });
  assert.deepEqual(empty, {
    action: "discard",
    reason: "cloud-workspace-empty",
  });

  assert.equal(
    getCloudWorkspaceRefreshNotice("cloud-workspace-empty"),
    "云端暂无便签，已保留当前内容。",
  );
  assert.equal(
    getCloudWorkspaceRefreshNotice("cloud-workspace-not-newer"),
    "云端没有更新的版本，已保留当前内容。",
  );
});

test("匿名刷新只重读浏览器本地工作区，并保护最新未保存编辑", () => {
  assert.match(
    refreshHandlerSource,
    /if \(!canUseCloudWorkspace\(authUser\)\) \{[\s\S]*resolveAnonymousWorkspaceRefresh\(\{[\s\S]*getInitialNoteWorkspace\(\),/,
  );

  const current = createWorkspace([
    createNote("note-1", "刚输入但尚未落盘的内容", { updatedAt: 300 }),
  ]);
  const olderPersisted = createWorkspace([
    createNote("note-1", "旧的已落盘内容", { updatedAt: 100 }),
  ]);

  assert.deepEqual(
    resolveAnonymousWorkspaceRefresh({
      current,
      persisted: olderPersisted,
    }),
    { workspace: current, source: "in-memory" },
  );

  const newerPersisted = createWorkspace([
    createNote("note-1", "另一个标签页写入的内容", { updatedAt: 400 }),
    createNote("note-2", "另一个标签页新增的便签", { updatedAt: 400 }),
  ]);

  assert.deepEqual(
    resolveAnonymousWorkspaceRefresh({
      current,
      persisted: newerPersisted,
    }),
    { workspace: newerPersisted, source: "browser-storage" },
  );
});

test("匿名刷新在本地存储缺失、更旧或缺少文件夹时保持内存工作区", () => {
  const current = createWorkspace(
    [createNote("note-1", "内存内容", { updatedAt: 200, folderId: "folder-1" })],
    { folders: [{ id: "folder-1", name: "工作", createdAt: 1 }] },
  );

  assert.deepEqual(
    resolveAnonymousWorkspaceRefresh({ current, persisted: null }),
    { workspace: current, source: "in-memory" },
  );

  assert.deepEqual(
    resolveAnonymousWorkspaceRefresh({
      current,
      persisted: createWorkspace([]),
    }),
    { workspace: current, source: "in-memory" },
  );

  // 持久化快照缺少只在内存中存在的便签时不能覆盖。
  assert.deepEqual(
    resolveAnonymousWorkspaceRefresh({
      current: createWorkspace([
        createNote("note-1", "内存内容", { updatedAt: 200 }),
        createNote("note-2", "新建但尚未落盘", { updatedAt: 200 }),
      ]),
      persisted: createWorkspace([
        createNote("note-1", "内存内容", { updatedAt: 200 }),
      ]),
    }).source,
    "in-memory",
  );

  // 持久化快照缺少刚创建的文件夹时同样不能覆盖。
  assert.deepEqual(
    resolveAnonymousWorkspaceRefresh({
      current,
      persisted: createWorkspace([
        createNote("note-1", "内存内容", { updatedAt: 200, folderId: "folder-1" }),
      ]),
    }),
    { workspace: current, source: "in-memory" },
  );
});
