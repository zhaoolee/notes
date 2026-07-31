import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CategorySidebar } from "../../src/components/CategorySidebar.js";
import { NoteSidebar } from "../../src/components/NoteSidebar.js";
import {
  createSmartisanWebTestWorkspace,
  SMARTISAN_WEB_TEST_DATA_ID,
  SMARTISAN_WEB_TEST_WORKSPACE_STORAGE_KEY,
} from "../../src/fixtures/smartisan-web-test-workspace.js";
import {
  createNoteFolder,
  createNoteDocument,
  discardEmptyNoteDraft,
  getCategoryNoteDocuments,
  getFolderCategoryId,
  getNoteListTitle,
  getNotePreview,
  getNoteTitle,
  moveNoteToFolder,
  moveNoteToTrash,
  orderNoteDocuments,
  parseNoteWorkspace,
  reorderNormalNoteDocuments,
  restoreNoteFromTrash,
  toggleNotePinned,
  toggleNoteStarred,
} from "../../src/lib/notes.js";
import {
  getUrlAfterConsumingTestDataReset,
  RESET_TEST_DATA_SEARCH_PARAM,
} from "../../src/lib/test-data-url.js";
import {
  getMobileNoteSwipeAxis,
  getMobileNoteSwipeOffset,
  MOBILE_NOTE_SWIPE_OPEN_OFFSET,
  shouldOpenMobileNoteSwipe,
} from "../../src/lib/mobile-note-swipe.js";

test("便签标题与摘要从 Markdown 内容自动提取", () => {
  const markdown = [
    "# **旅行清单**",
    "",
    "- [x] 预订车票",
    "- [ ] 准备相机",
  ].join("\n");

  assert.equal(getNoteTitle(markdown), "旅行清单");
  assert.equal(getNoteListTitle(markdown), "# **旅行清单**");
  assert.equal(
    getNoteListTitle("![](https://example.com/cover.jpg)\n\n[**图片便签**]"),
    "[**图片便签**]",
  );
  assert.equal(getNotePreview(markdown), "[x] 预订车票 [ ] 准备相机");
  assert.equal(getNoteTitle(""), "新便签");
  assert.equal(getNotePreview(""), "点击开始记录");
});

test("持久化工作区校验便签集合并修复失效的当前 ID", () => {
  const firstNote = createNoteDocument("第一张", 1_000);
  const secondNote = createNoteDocument("第二张", 2_000);
  const workspace = parseNoteWorkspace(
    JSON.stringify({
      version: 1,
      activeNoteId: "missing-note",
      notes: [firstNote, secondNote],
    }),
  );

  assert.ok(workspace);
  assert.equal(workspace.activeNoteId, firstNote.id);
  assert.deepEqual(workspace.folders, []);
  assert.deepEqual(workspace.notes, [firstNote, secondNote]);
  assert.equal(parseNoteWorkspace('{"version":1,"notes":[]}'), null);
  assert.equal(
    parseNoteWorkspace(
      JSON.stringify({
        version: 1,
        activeNoteId: firstNote.id,
        notes: [firstNote, firstNote],
      }),
    ),
    null,
  );
  assert.equal(parseNoteWorkspace("not-json"), null);
});

test("空白新建便签返回列表时丢弃草稿并选中真实下一条", () => {
  const firstNote = createNoteDocument("# 第一条", 1_000, 0);
  const secondNote = createNoteDocument("# 第二条", 2_000, 1);
  const emptyDraft = createNoteDocument(" \n\t", 3_000, -1);

  assert.deepEqual(
    discardEmptyNoteDraft(
      [emptyDraft, firstNote, secondNote],
      emptyDraft.id,
      secondNote.id,
    ),
    {
      activeNote: secondNote,
      notes: [firstNote, secondNote],
    },
  );
  assert.equal(
    discardEmptyNoteDraft([firstNote, secondNote], firstNote.id),
    null,
  );
  assert.equal(discardEmptyNoteDraft([emptyDraft], emptyDraft.id), null);

  const appSource = readFileSync("src/App.tsx", "utf8");
  const storeSource = readFileSync("src/store/useAppStore.ts", "utf8");

  assert.match(
    appSource,
    /mobileDraftNoteIdRef\.current = createNote\("", folderId, shouldStar\);/,
  );
  assert.match(
    appSource,
    /function handleReturnToNoteList\(\)[\s\S]*discardEmptyDraft\(draftNoteId, preferredNextNoteId\);[\s\S]*setMobileWorkspaceView\("notes"\);/,
  );
  assert.match(
    appSource,
    /aria-label="返回便签列表"[\s\S]*onClick=\{handleReturnToNoteList\}/,
  );
  assert.match(
    storeSource,
    /discardEmptyDraft:[\s\S]*discardEmptyNoteDraft\([\s\S]*activeNoteId:\s*discarded\.activeNote\.id,[\s\S]*markdown:\s*discarded\.activeNote\.markdown,/,
  );
});

test("官方网页版前 20 条便签可作为隔离且可重复的测试工作区", () => {
  const firstWorkspace = createSmartisanWebTestWorkspace();
  const secondWorkspace = createSmartisanWebTestWorkspace();

  assert.equal(SMARTISAN_WEB_TEST_DATA_ID, "smartisan-web-20");
  assert.equal(
    SMARTISAN_WEB_TEST_WORKSPACE_STORAGE_KEY,
    "notes.workspace.smartisan-web-20.v1",
  );
  assert.equal(firstWorkspace.notes.length, 20);
  assert.equal(firstWorkspace.activeNoteId, "smartisan-web-01");
  assert.match(firstWorkspace.notes[0].markdown, /班味儿/);
  assert.equal(firstWorkspace.notes[1].markdown, "test");
  assert.match(firstWorkspace.notes[2].markdown, /运维神器爱马仕/);
  assert.match(firstWorkspace.notes[19].markdown, /OpenClaw很火/);
  assert.deepEqual(
    firstWorkspace.notes.map((note) => note.normalOrder),
    Array.from({ length: 20 }, (_, index) => index),
  );
  assert.notEqual(firstWorkspace.notes, secondWorkspace.notes);
  assert.notEqual(firstWorkspace.notes[0], secondWorkspace.notes[0]);
});

test("测试数据重置参数只消费一次并保留隔离工作区地址", () => {
  assert.equal(RESET_TEST_DATA_SEARCH_PARAM, "resetTestData");
  assert.equal(
    getUrlAfterConsumingTestDataReset(
      "http://127.0.0.1:15173/?testData=smartisan-web-20&resetTestData=1",
    ),
    "/?testData=smartisan-web-20",
  );
  assert.equal(
    getUrlAfterConsumingTestDataReset(
      "http://127.0.0.1:15173/notes?resetTestData=1&theme=default#active",
    ),
    "/notes?theme=default#active",
  );
});

test("旧工作区自动补齐排序、加星、分类与回收站字段", () => {
  const workspace = parseNoteWorkspace(
    JSON.stringify({
      version: 1,
      activeNoteId: "legacy-note",
      notes: [
        {
          id: "legacy-note",
          markdown: "旧便签",
          createdAt: 1_000,
          updatedAt: 2_000,
        },
      ],
    }),
  );

  assert.ok(workspace);
  assert.equal(workspace.notes[0].normalOrder, 0);
  assert.equal(workspace.notes[0].pinnedAt, null);
  assert.equal(workspace.notes[0].folderId, null);
  assert.equal(workspace.notes[0].isStarred, false);
  assert.equal(workspace.notes[0].deletedAt, null);
  assert.deepEqual(workspace.folders, []);
});

test("分类、加星、文件夹归属与回收站使用同一份便签数据", () => {
  const folder = createNoteFolder("工作", 1_000);
  const first = createNoteDocument("第一张", 2_000, 0);
  const second = createNoteDocument("第二张", 3_000, 1, folder.id, true);
  const notes = [first, second];

  assert.deepEqual(
    getCategoryNoteDocuments(notes, "all").map((note) => note.markdown),
    ["第一张", "第二张"],
  );
  assert.deepEqual(
    getCategoryNoteDocuments(notes, "starred").map((note) => note.markdown),
    ["第二张"],
  );
  assert.deepEqual(
    getCategoryNoteDocuments(notes, getFolderCategoryId(folder.id)).map(
      (note) => note.markdown,
    ),
    ["第二张"],
  );

  const starred = toggleNoteStarred(notes, first.id);
  assert.equal(getCategoryNoteDocuments(starred, "starred").length, 2);

  const filed = moveNoteToFolder(starred, first.id, folder.id);
  assert.equal(
    getCategoryNoteDocuments(filed, getFolderCategoryId(folder.id)).length,
    2,
  );

  const trashed = moveNoteToTrash(filed, second.id, 10_000);
  assert.equal(getCategoryNoteDocuments(trashed, "all").length, 1);
  assert.equal(getCategoryNoteDocuments(trashed, "starred").length, 1);
  assert.equal(getCategoryNoteDocuments(trashed, "trash")[0].id, second.id);
  assert.equal(
    getCategoryNoteDocuments(restoreNoteFromTrash(trashed, second.id), "trash")
      .length,
    0,
  );
});

test("置顶最近操作优先、置顶区不可拖拽且取消后恢复普通位置", () => {
  const first = createNoteDocument("第一张", 1_000, 0);
  const second = createNoteDocument("第二张", 2_000, 1);
  const third = createNoteDocument("第三张", 3_000, 2);
  const firstPinned = toggleNotePinned([first, second, third], first.id, 10_000);
  const twoPinned = toggleNotePinned(firstPinned, second.id, 20_000);

  assert.deepEqual(
    orderNoteDocuments(twoPinned).map((note) => note.markdown),
    ["第二张", "第一张", "第三张"],
  );
  assert.deepEqual(
    reorderNormalNoteDocuments(twoPinned, second.id, first.id),
    twoPinned,
  );

  const secondUnpinned = toggleNotePinned(twoPinned, second.id, 30_000);
  assert.deepEqual(
    orderNoteDocuments(secondUnpinned).map((note) => note.markdown),
    ["第一张", "第二张", "第三张"],
  );

  const secondRepinned = toggleNotePinned(secondUnpinned, second.id, 40_000);
  assert.deepEqual(
    orderNoteDocuments(secondRepinned).map((note) => note.markdown),
    ["第二张", "第一张", "第三张"],
  );
});

test("普通便签拖拽只交换普通排序槽位", () => {
  const pinned = {
    ...createNoteDocument("置顶", 1_000, 1),
    pinnedAt: 10_000,
  };
  const first = createNoteDocument("普通一", 2_000, 0);
  const second = createNoteDocument("普通二", 3_000, 2);
  const reordered = reorderNormalNoteDocuments(
    [pinned, first, second],
    second.id,
    first.id,
  );

  assert.deepEqual(
    orderNoteDocuments(reordered).map((note) => note.markdown),
    ["置顶", "普通二", "普通一"],
  );
  assert.equal(
    reordered.find((note) => note.id === pinned.id)?.normalOrder,
    pinned.normalOrder,
  );
});

test("便签侧栏呈现搜索、新建、切换入口和移动端横滑删除按钮", () => {
  const firstNote = createNoteDocument("# 第一张便签\n正文 A", 1_000);
  const secondNote = {
    ...createNoteDocument("# 第二张便签\n正文 B", 2_000),
    pinnedAt: 2_000,
  };
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(NoteSidebar, {
      activeNoteId: secondNote.id,
      categoryLabel: "全部便签",
      isTrashView: false,
      isOpen: true,
      isDesktopCategoryCollapsed: false,
      notes: [secondNote, firstNote],
      searchQuery: "",
      onClose: noop,
      onCreateNote: noop,
      onDeleteNote: noop,
      onPermanentlyDeleteNote: noop,
      onReorderNotes: noop,
      onRestoreNote: noop,
      onSearchQueryChange: noop,
      onSelectNote: noop,
      onTogglePinned: noop,
      onToggleStarred: noop,
      onToggleDesktopCategory: noop,
    }),
  );

  assert.match(html, /aria-label="便签导航"/);
  assert.match(html, /全部便签/);
  assert.doesNotMatch(html, /共 2 张便签|class="note-count"/);
  assert.match(html, /placeholder="搜索便签"/);
  assert.match(html, /1月1日/);
  assert.match(html, /第一张便签/);
  assert.match(html, /第二张便签/);
  assert.doesNotMatch(html, /正文 A|正文 B|正在编辑/);
  assert.match(html, /aria-label="新建便签"/);
  assert.match(html, /aria-label="删除便签：第二张便签"/);
  assert.match(
    html,
    /class="note-list-swipe-delete" aria-hidden="true" aria-label="删除便签：第二张便签" tabindex="-1"/,
  );
  assert.doesNotMatch(html, /class="note-list-delete"/);
  assert.match(html, /aria-label="取消置顶：第二张便签"/);
  assert.match(html, /aria-label="置顶便签：第一张便签"/);
  assert.match(html, /aria-label="加星便签：第一张便签"/);
  assert.match(html, /icon_top_checked\.png/);
  assert.match(html, /icon_top_normal\.png/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /aria-label="收起分类栏"/);
  assert.match(html, /class="note-sidebar-bottom-menu"/);
});

test("分类侧栏呈现官方四类入口、数量与自定义文件夹", () => {
  const folder = createNoteFolder("工作", 1_000);
  const note = createNoteDocument("项目记录", 2_000, 0, folder.id, true);
  const deleted = {
    ...createNoteDocument("已删除", 3_000),
    deletedAt: 4_000,
  };
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(CategorySidebar, {
      activeCategoryId: getFolderCategoryId(folder.id),
      desktopFooter: createElement(
        "button",
        { type: "button" },
        "登录锤子便签",
      ),
      folders: [folder],
      isOpen: true,
      notes: [note, deleted],
      searchQuery: "",
      onCategorySelect: noop,
      onClose: noop,
      onCreateFolder: () => null,
      onDeleteFolder: noop,
      onSearchQueryChange: noop,
    }),
  );

  assert.match(html, /全部便签/);
  assert.match(html, /加星便签/);
  assert.match(html, /回收站/);
  assert.match(html, /工作/);
  assert.match(html, /aria-label="新建文件夹"/);
  assert.match(html, /placeholder="快速搜索关键字"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /class="category-desktop-footer"/);
  assert.match(html, /登录锤子便签/);
  assert.doesNotMatch(html, /下载锤子便签 APP/);
  assert.ok(html.indexOf("全部便签") < html.indexOf("加星便签"));
  assert.ok(html.indexOf("加星便签") < html.indexOf("工作"));
  assert.ok(html.indexOf("工作") < html.indexOf("回收站"));
});

test("便签侧栏保持锤子网页版的紧凑视觉参数", () => {
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(styles, /--note-list-surface:\s*#fbf7ed;/);
  assert.match(styles, /--note-list-active:\s*#f1ece1;/);
  assert.match(styles, /--note-list-divider:\s*#e4dad1;/);
  assert.match(styles, /--note-list-time:\s*#b9a691;/);
  assert.match(styles, /--note-list-title:\s*#635753;/);
  assert.match(
    styles,
    /\.note-search\s*\{[^}]*width:\s*calc\(100% - 20px\);[^}]*height:\s*29px;[^}]*border-radius:\s*14px;/s,
  );
  assert.match(
    styles,
    /\.note-list-item\s*\{[^}]*height:\s*50px;[^}]*border-bottom:\s*1px solid var\(--note-list-divider\);/s,
  );
  assert.match(
    styles,
    /\.note-list-item\.active\s*\{[^}]*background:\s*var\(--note-list-active\);[^}]*box-shadow:\s*var\(--note-list-active-shadow\);/s,
  );
  assert.match(
    styles,
    /\.note-list-meta\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*20px;/s,
  );
  assert.match(
    styles,
    /\.note-list-select strong\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*400;[^}]*line-height:\s*20px;/s,
  );
});

test("移动端锁定一倍视口并禁止双指缩放与输入框自动放大", () => {
  const indexSource = readFileSync("index.html", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    indexSource,
    /width=device-width,\s*initial-scale=1\.0,\s*minimum-scale=1\.0,\s*maximum-scale=1\.0,\s*user-scalable=no,\s*viewport-fit=cover/,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*html,\s*body,\s*#root\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;[^}]*touch-action:\s*pan-x pan-y;/s,
  );
  assert.match(
    styles,
    /input:not\(\[type\]\),[\s\S]*input\[type="password"\],[\s\S]*textarea,\s*select\s*\{[^}]*font-size:\s*16px !important;/s,
  );
});

test("移动端采用便签列表、编辑和预览三态工作区", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    appSource,
    /useLayoutEffect\(\(\) => \{[\s\S]*window\.visualViewport;[\s\S]*--mobile-visual-viewport-top[\s\S]*--mobile-visual-viewport-height[\s\S]*viewport\?\.addEventListener\("resize", syncVisualViewport\);[\s\S]*viewport\?\.addEventListener\("scroll", syncVisualViewport\);[\s\S]*window\.addEventListener\("pageshow", syncVisualViewport\);/s,
  );
  assert.doesNotMatch(
    appSource,
    /--mobile-visual-viewport-left|--mobile-visual-viewport-width|viewport\?\.offsetLeft|viewport\?\.width/,
  );
  assert.match(appSource, /type MobileWorkspaceView = "notes" \| "editor" \| "preview";/);
  assert.match(appSource, /data-mobile-view=\{mobileWorkspaceView\}/);
  assert.match(appSource, /className="mobile-workspace-tabs"/);
  assert.match(appSource, /className="mobile-note-stats"/);
  assert.match(appSource, /className="mobile-view-toggle"/);
  assert.match(appSource, /aria-label="返回便签列表"/);
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*--topbar-height:\s*48px;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.app-layout\s*\{[^}]*position:\s*fixed;[^}]*top:\s*var\(--mobile-visual-viewport-top,\s*0px\);[^}]*right:\s*0;[^}]*left:\s*0;[^}]*width:\s*auto;[^}]*max-width:\s*none;[^}]*height:\s*var\(--mobile-visual-viewport-height,\s*100dvh\);[^}]*max-height:\s*var\(--mobile-visual-viewport-height,\s*100dvh\);[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.app-layout\s*\{[^}]*note_background\.png[^}]*background-repeat:\s*no-repeat;[^}]*background-position:\s*center;[^}]*background-size:\s*100% 100%;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="default"\] \.note-sidebar,\s*\.app-layout\[data-theme="default"\] \.note-list\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.note-sidebar,\s*\.app-layout\[data-theme="smartisan-dark"\] \.note-list\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-mobile-view="notes"\] \.note-sidebar\s*\{[^}]*display:\s*flex;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-mobile-view="editor"\] \.editor-panel,[^}]*\.app-layout\[data-mobile-view="preview"\] \.preview-panel\s*\{[^}]*display:\s*flex;/s,
  );
  assert.match(
    styles,
    /\.app-layout:not\(\[data-render-mode="playwright"\]\)\[data-mobile-view="editor"\] \.editor-panel,[^}]*\.app-layout:not\(\[data-render-mode="playwright"\]\)\[data-mobile-view="preview"\] \.preview-panel\s*\{[^}]*display:\s*flex;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.note-list-item\s*\{[^}]*height:\s*75\.3333px;[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.note-sidebar-header\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    styles,
    /\.mobile-workspace-tabs\s*\{[^}]*height:\s*50px;/s,
  );
  assert.match(
    editorSource,
    /className="markdown-editor-caret-mirror"[\s\S]*className="markdown-editor-caret"[\s\S]*className="markdown-editor-selection-handle is-start"[\s\S]*className="markdown-editor-selection-handle is-end"/,
  );
  assert.match(
    editorSource,
    /const anchorHeight = caretAnchor\.height \|\| caretHeight;[\s\S]*Math\.max\(0, \(anchorHeight - caretHeight\) \/ 2\)/,
  );
  assert.doesNotMatch(
    editorSource,
    /Math\.max\(0, \(lineHeight - caretHeight\) \/ 2\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.markdown-editor\s*\{[^}]*caret-color:\s*transparent;[^}]*\}[\s\S]*\.markdown-editor-caret\s*\{[^}]*width:\s*2px;[^}]*height:\s*22px;[^}]*background:\s*var\(--editor-selection-handle\);/s,
  );
  assert.match(
    styles,
    /\.markdown-editor-selection-handle\s*\{[^}]*width:\s*2px;[^}]*height:\s*var\(--editor-line-height\);[^}]*background:\s*var\(--editor-selection-handle\);[^}]*pointer-events:\s*none;/s,
  );
  assert.match(
    styles,
    /\.markdown-editor-selection-handle::before\s*\{[^}]*width:\s*10px;[^}]*height:\s*10px;[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--editor-selection-handle\);/s,
  );
  assert.match(
    editorSource,
    /textarea\.selectionStart !== textarea\.selectionEnd[\s\S]*positionSelectionHandle\(\s*selectionStartHandle,[\s\S]*positionSelectionHandle\(\s*selectionEndHandle,/s,
  );
  assert.match(
    editorSource,
    /document\.addEventListener\("selectionchange", syncNativeSelectionChange\);[\s\S]*document\.removeEventListener\("selectionchange", syncNativeSelectionChange\);/s,
  );
  assert.match(
    editorSource,
    /const syncNativeSelectionChange = \(\): void => \{[\s\S]*document\.activeElement !== textarea[\s\S]*selectionRef\.current = \{[\s\S]*start:\s*textarea\.selectionStart[\s\S]*end:\s*textarea\.selectionEnd[\s\S]*hideEditorIndicators\(\);[\s\S]*scheduleCustomCaretSync\(\);/s,
  );
  assert.match(
    styles,
    /--editor-selection-bg:\s*rgba\(166,\s*139,\s*117,\s*0\.2\);[\s\S]*--editor-selection-handle:\s*#a68b75;/s,
  );
  assert.match(
    styles,
    /:root\[data-theme="smartisan-dark"\]\s*\{[^}]*--note-list-surface:\s*#1e1c1e;[^}]*--note-list-time:\s*#676467;[^}]*--note-list-title:\s*#cecece;[^}]*--editor-paper-base:\s*#1c1a1c;[^}]*--editor-rule-line:\s*#282828;[^}]*--editor-margin-band:\s*#161416;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.note-list-card\s*\{[^}]*dark\/list-item-normal-right\.png[^}]*dark\/list-item-normal-left\.png[^}]*dark\/list-item-normal-center\.png/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.markdown-editor-frame::before\s*\{[^}]*border-right-color:\s*#282828;[^}]*#161416;[^}]*\}[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.markdown-editor\s*\{[^}]*#282828[^}]*#1c1a1c;[^}]*background-attachment:\s*local;[^}]*color:\s*#cecece;/s,
  );
  for (const darkAsset of [
    "public/smartisan/mobile/dark/action_bar_default.png",
    "public/smartisan/mobile/dark/note_background.webp",
    "public/smartisan/mobile/dark/list-item-normal-left.png",
    "public/smartisan/mobile/dark/list-item-normal-center.png",
    "public/smartisan/mobile/dark/list-item-normal-right.png",
    "public/smartisan/mobile/dark/search-field-center.png",
    "public/smartisan/mobile/dark/note_item_clip_normal.webp",
    "public/smartisan/mobile/dark/note_item_star_fav.webp",
  ]) {
    assert.ok(existsSync(darkAsset), `缺少官方暗黑移动素材：${darkAsset}`);
  }
  assert.match(
    styles,
    /\.markdown-editor::selection\s*\{[^}]*background-color:\s*var\(--editor-selection-bg\);[^}]*\}[\s\S]*\.markdown-editor::-moz-selection\s*\{[^}]*background-color:\s*var\(--editor-selection-bg\);/s,
  );
  assert.match(
    styles,
    /\.markdown-editor\s*\{[^}]*caret-color:\s*var\(--editor-selection-handle\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*--editor-rule-thickness:\s*0\.6667px;[\s\S]*--editor-rule-line:\s*#f4ebde;[\s\S]*\.markdown-editor\s*\{[^}]*transparent\s*calc\(var\(--editor-line-height\) - var\(--editor-rule-thickness\)\)[^}]*var\(--editor-rule-line\) var\(--editor-line-height\)[^}]*0 0 \/ 100% var\(--editor-line-height\) repeat-y,[^}]*var\(--editor-paper-base\);[^}]*background-attachment:\s*local;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*--mobile-editor-gutter-width:\s*25px;[\s\S]*\.mobile-workspace-tabs\s*\{[^}]*--editor-gutter-width:\s*var\(--mobile-editor-gutter-width\);[^}]*padding:\s*0 10px 0 calc\(var\(--editor-gutter-width\) \+ 10px\);[^}]*background:\s*var\(--editor-paper-base\);/s,
  );
  assert.match(
    styles,
    /\.mobile-workspace-tabs::before\s*\{[^}]*width:\s*var\(--editor-gutter-width\);[^}]*edge_004e88bdf2\.png[^}]*pointer-events:\s*none;/s,
  );
  assert.match(
    styles,
    /\.markdown-editor-frame::before\s*\{[^}]*width:\s*var\(--editor-gutter-width\);[^}]*edge_004e88bdf2\.png/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.markdown-editor-frame\s*\{[^}]*--editor-paper-scroll-y:\s*0px;[^}]*\}[\s\S]*\.markdown-editor-frame::before\s*\{[^}]*background-position:\s*0 var\(--editor-paper-scroll-y\);[^}]*background-size:\s*5px var\(--editor-line-height\);/s,
  );
  assert.match(
    editorSource,
    /style\.setProperty\(\s*"--editor-paper-scroll-y",\s*`\$\{-textarea\.scrollTop\}px`,\s*\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.preview-stage\s*\{[^}]*overflow:\s*auto;[^}]*padding:\s*16px 10px 28px;[^}]*background:\s*var\(--preview-stage-bg\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.desktop-workspace-toolbar,\s*\.desktop-create-note\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    styles,
    /\.preview-stage\s*\{[^}]*--note-sheet-width:\s*calc\(330px \* var\(--note-scale\)\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.app-layout\[data-theme="default"\] \.preview-stage\s*\{[^}]*note_background\.png[^}]*background-repeat:\s*no-repeat;[^}]*background-position:\s*center;[^}]*background-size:\s*100% 100%;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.preview-stage\s*\{[^}]*dark\/note_background\.webp[^}]*background-repeat:\s*no-repeat;[^}]*background-position:\s*center;[^}]*background-size:\s*100% 100%;/s,
  );
  assert.doesNotMatch(
    styles,
    /\.preview-stage \.sheet-frame,[\s\S]*\.preview-stage \.sheet-footer\s*\{[^}]*display:\s*none;/s,
  );
  assert.doesNotMatch(
    styles,
    /\.preview-stage \.note-sheet\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*100%;/s,
  );
  assert.match(
    styles,
    /\.sheet-corner-top-left\s*\{[^}]*left:\s*calc\(7\.6667px \* var\(--note-scale\)\);[^}]*top:\s*calc\(15px \* var\(--note-scale\)\);/s,
  );
  assert.match(
    styles,
    /\.sheet-corner-top-right\s*\{[^}]*right:\s*calc\(7\.6667px \* var\(--note-scale\)\);[^}]*top:\s*calc\(15px \* var\(--note-scale\)\);/s,
  );
  assert.match(
    styles,
    /\.sheet-corner-bottom-left\s*\{[^}]*left:\s*calc\(7\.6667px \* var\(--note-scale\)\);[^}]*bottom:\s*calc\(55\.1667px \* var\(--note-scale\)\);/s,
  );
  assert.match(
    styles,
    /\.sheet-corner-bottom-right\s*\{[^}]*right:\s*calc\(7\.6667px \* var\(--note-scale\)\);[^}]*bottom:\s*calc\(55\.1667px \* var\(--note-scale\)\);/s,
  );
  assert.doesNotMatch(styles, /:has\(\.markdown-editor:focus\)/);
});

test("移动分类使用顶栏锚定浮窗覆盖列表而不替换正文", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const categorySource = readFileSync(
    "src/components/CategorySidebar.tsx",
    "utf8",
  );
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    appSource,
    /className="mobile-list-title"[\s\S]*aria-controls="category-sidebar"[\s\S]*aria-expanded=\{isCategorySidebarOpen\}/,
  );
  assert.match(appSource, /className=\{`category-popover-backdrop/);
  assert.match(appSource, /aria-label="关闭分类浮窗"/);
  assert.match(
    appSource,
    /if \(!isCategorySidebarOpen\)[\s\S]*event\.key === "Escape"[\s\S]*setIsCategorySidebarOpen\(false\)/,
  );
  assert.match(categorySource, /className="category-popover-footer"/);
  assert.match(categorySource, /className="category-popover-edit"/);
  assert.match(categorySource, /className="category-popover-sort"/);
  assert.match(categorySource, /className="category-popover-create"/);
  assert.match(
    styles,
    /Smartisan Notes desktop web parity layer[\s\S]*\.category-popover-backdrop\.is-visible\s*\{[^}]*background:\s*transparent;/s,
  );
  assert.match(
    styles,
    /Smartisan Notes desktop web parity layer[\s\S]*\.category-sidebar,\s*\.category-sidebar\.is-open\s*\{[^}]*inset:\s*16px 31px auto;[^}]*border:\s*1px solid #cfcac5;[^}]*border-radius:\s*8px;[^}]*opacity:\s*0;/s,
  );
  assert.match(
    styles,
    /\.category-sidebar\.is-open\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;[^}]*pointer-events:\s*auto;/s,
  );
  assert.match(
    styles,
    /\.category-sidebar \.category-row\s*\{[^}]*height:\s*48px;[^}]*border-bottom:\s*1px solid #e6e4e2;/s,
  );
  assert.match(
    styles,
    /\.category-popover-footer\s*\{[^}]*height:\s*45px;[^}]*background:\s*#f7f7f7;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-category-open="true"\] \.note-sidebar\s*\{[^}]*display:\s*flex;/s,
  );
});

test("项目使用桌面官方三栏和手机布局，不提供平板堆叠版", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.doesNotMatch(styles, /@media \(max-width: 1360px\)/);
  assert.match(styles, /--category-sidebar-width:\s*clamp\(180px,\s*15\.72vw,\s*360px\);/);
  assert.match(styles, /--note-sidebar-width:\s*clamp\(280px,\s*25\.95vw,\s*590px\);/);
  assert.match(
    styles,
    /\.app-shell\s*\{[^}]*grid-template-columns:\s*var\(--category-sidebar-width\)\s*var\(--note-sidebar-width\)\s*minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*50px minmax\(0,\s*1fr\);/s,
  );
  assert.match(appSource, /type DesktopWorkspaceView = "editor" \| "preview";/);
  assert.match(
    appSource,
    /useState<DesktopWorkspaceView>\("editor"\)/,
  );
  assert.match(appSource, /data-desktop-view=\{desktopWorkspaceView\}/);
  assert.match(appSource, /aria-label="切换编辑与实时预览"/);
  assert.match(appSource, /className="desktop-view-menu" role="menu"/);
  assert.match(appSource, /\["editor", "Markdown 模式"\]/);
  assert.match(appSource, /\["preview", "实时预览"\]/);
  assert.match(
    styles,
    /\.app-layout:not\(\[data-render-mode="playwright"\]\)\[data-desktop-view="editor"\] \.preview-panel,[\s\S]*\[data-desktop-view="preview"\] \.editor-panel\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-render-mode="playwright"\] \.preview-panel\s*\{[^}]*display:\s*flex;/s,
  );
});

test("桌面工作区使用锤子便签网页版的纸面、细线和栏宽比例", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(styles, /--editor-font-size:\s*17px;/);
  assert.match(styles, /--editor-paper-base:\s*#fbf7ed;/);
  assert.match(
    styles,
    /\.markdown-editor-frame\s*\{[^}]*--editor-gutter-width:\s*25px;[^}]*--editor-paper-scroll-y:\s*0px;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
  );
  assert.match(
    styles,
    /\.markdown-editor-frame::before\s*\{[^}]*edge_004e88bdf2\.png[^}]*background-position:\s*0 var\(--editor-paper-scroll-y\);[^}]*background-size:\s*5px var\(--editor-line-height\);/s,
  );
  assert.match(
    styles,
    /\.desktop-workspace-toolbar\s*\{[^}]*height:\s*50px;[^}]*padding:\s*0 14px 0 45px;[^}]*border-bottom:\s*1px solid var\(--note-status-divider\);/s,
  );
  assert.match(
    styles,
    /\.markdown-editor\s*\{[^}]*font-weight:\s*400;[^}]*padding:\s*0 30px 100px 50px;[^}]*grid_6e4a41eefc\.png/s,
  );
  assert.match(
    styles,
    /\.desktop-view-switch-trigger\s*\{[^}]*height:\s*24px;[^}]*border:\s*1px solid var\(--note-list-divider\);[^}]*font-size:\s*13px;/s,
  );
  assert.match(
    styles,
    /\.desktop-view-menu\s*\{[^}]*top:\s*32px;[^}]*width:\s*202px;[^}]*min-height:\s*110px;[^}]*border:\s*1px solid #e2dcd6;[^}]*border-radius:\s*5px;[^}]*box-shadow:\s*0 8px 15px rgba\(58,\s*45,\s*35,\s*0\.15\);/s,
  );
  assert.match(
    styles,
    /\.desktop-view-menu button\s*\{[^}]*height:\s*52px;[^}]*min-height:\s*52px;/s,
  );
  assert.doesNotMatch(appSource, /className="note-list-delete"/);
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.app-layout:not\(\[data-render-mode="playwright"\]\) \.note-sidebar-header\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.app-layout:not\(\[data-render-mode="playwright"\]\)\s*\{[^}]*text-rendering:\s*auto;[^}]*-webkit-font-smoothing:\s*auto;[^}]*-moz-osx-font-smoothing:\s*auto;/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.category-sidebar,[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.desktop-workspace-toolbar,[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.editor-panel,[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.preview-panel\s*\{[^}]*background:\s*#1e1c1e;/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.desktop-toolbar-button,\s*\.app-layout\[data-theme="smartisan-dark"\] \.mobile-insert-image,\s*\.app-layout\[data-theme="smartisan-dark"\] \.desktop-move-note,\s*\.app-layout\[data-theme="smartisan-dark"\] \.ai-review-trigger,\s*\.app-layout\[data-theme="smartisan-dark"\] \.share-trigger,\s*\.app-layout\[data-theme="smartisan-dark"\] \.mobile-delete-note,\s*\.app-layout\[data-theme="smartisan-dark"\] \.desktop-share-preview-actions button\s*\{[^}]*border-color:\s*#4a464a;[^}]*background:\s*linear-gradient\(#3a363a,\s*#2b282b\);[^}]*color:\s*#dedcde;[^}]*0 1px 1px rgba\(0,\s*0,\s*0,\s*0\.3\);/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.share-trigger\[aria-expanded="true"\],[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.mobile-delete-note:hover,[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.desktop-share-preview-actions button:hover:not\(:disabled\),[\s\S]*\.app-layout\[data-theme="smartisan-dark"\] \.desktop-share-preview-actions button:focus-visible\s*\{[^}]*border-color:\s*#5c575c;[^}]*background:\s*linear-gradient\(#454045,\s*#343034\);/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.desktop-share-preview-actions button:focus-visible\s*\{[^}]*outline:\s*2px solid rgba\(201,\s*154,\s*30,\s*0\.35\);[^}]*outline-offset:\s*2px;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.desktop-share-preview-actions button:active:not\(:disabled\)\s*\{[^}]*transform:\s*translateY\(1px\);[^}]*inset 0 2px 3px rgba\(0,\s*0,\s*0,\s*0\.42\),/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.desktop-share-preview-actions button:disabled\s*\{[^}]*color:\s*#777477;[^}]*opacity:\s*0\.48;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.category-row-icon\s*\{[^}]*filter:\s*grayscale\(1\) brightness\(3\);[^}]*opacity:\s*0\.78;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.markdown-editor-frame::before\s*\{[^}]*border-right-color:\s*#282828;[^}]*#282828 var\(--editor-line-height\)[^}]*0 var\(--editor-paper-scroll-y\) \/ 100% var\(--editor-line-height\) repeat-y,[^}]*#161416;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.markdown-editor\s*\{[^}]*#282828 var\(--editor-line-height\)[^}]*#1c1a1c;[^}]*background-attachment:\s*local;[^}]*color:\s*#cecece;/s,
  );
  const darkEditorRuleBodies = Array.from(
    styles.matchAll(
      /\.app-layout\[data-theme="smartisan-dark"\] \.markdown-editor\s*\{([^}]*)\}/g,
    ),
    (match) => match[1],
  ).filter((ruleBody) => ruleBody.includes("#1c1a1c"));
  assert.ok(darkEditorRuleBodies.length >= 2);
  assert.ok(
    darkEditorRuleBodies.every((ruleBody) =>
      /background-attachment:\s*local;/.test(ruleBody),
    ),
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.desktop-view-menu\s*\{[^}]*border-color:\s*#3b383b;[^}]*background:\s*#1e1c1e;/s,
  );
  assert.match(
    styles,
    /\.preview-stage\s*\{[^}]*padding:\s*20px 30px 20px 50px;[^}]*border-radius:\s*0;[^}]*justify-content:\s*flex-start;[^}]*background:[^}]*var\(--editor-rule-line\)[^}]*var\(--note-list-surface\);/s,
  );
  assert.match(
    styles,
    /\.markdown-editor-frame::before\s*\{[^}]*width:\s*var\(--editor-gutter-width\);[^}]*edge_004e88bdf2\.png/s,
  );
  assert.match(
    styles,
    /\.app-topbar\s*\{[^}]*#827265[^}]*#716053[^}]*bar-bg_4cfb4d66ed\.png[^}]*border-bottom:\s*1px solid #564944;/s,
  );
  assert.match(appSource, /const NOTE_REFRESH_DELAY_MS = 650;/);
  assert.match(
    appSource,
    /className=\{`desktop-toolbar-button desktop-refresh-note\$\{[\s\S]*isRefreshingNotes \? " is-refreshing" : ""/,
  );
  assert.match(appSource, /aria-busy=\{isRefreshingNotes\}/);
  assert.match(
    appSource,
    /function handleRefreshNotes\(\)[\s\S]*setIsRefreshingNotes\(true\);[\s\S]*window\.location\.reload\(\);[\s\S]*NOTE_REFRESH_DELAY_MS/s,
  );
  assert.match(
    styles,
    /\.desktop-refresh-note\.is-refreshing \.icon-refresh\s*\{[^}]*animation:\s*smartisan-refresh-spin 600ms cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\) both;[^}]*will-change:\s*transform;/s,
  );
  assert.match(
    styles,
    /@keyframes smartisan-refresh-spin\s*\{[\s\S]*transform:\s*rotate\(0deg\);[\s\S]*transform:\s*rotate\(360deg\);/s,
  );
  assert.match(appSource, /className="mobile-detail-action desktop-move-note"/);
  assert.match(appSource, /className="smartisan-toolbar-icon icon-share"/);
  assert.match(appSource, /className="smartisan-toolbar-icon icon-delete"/);
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.desktop-left-actions\s*\{[^}]*top:\s*12px;[^}]*left:\s*calc\(var\(--category-sidebar-width\) \+ var\(--note-sidebar-width\) - 165px\);[^}]*gap:\s*14px;/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.mobile-insert-image,[\s\S]*\.share-trigger\s*\{[^}]*width:\s*68px;[^}]*height:\s*38px;[^}]*border-radius:\s*8px;/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.app-topbar-actions > \.preview-export,[\s\S]*\.app-topbar-actions > \.app-settings\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    styles,
    /\.category-desktop-footer,[\s\S]*\.note-sidebar-bottom-menu\s*\{[^}]*height:\s*50px;[^}]*border-top:\s*1px solid #e9dece;[^}]*background:\s*var\(--note-list-surface\);/s,
  );
  assert.match(
    styles,
    /\.note-column-toggle\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*-287px -220px no-repeat;/s,
  );
  assert.match(
    styles,
    /\.note-column-toggle\.is-collapsed\s*\{[^}]*background-position:\s*-247px -220px;/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.app-layout\[data-desktop-category-collapsed="true"\]\s*\{[^}]*--category-sidebar-width:\s*0px;/s,
  );
  assert.match(appSource, /data-desktop-share=\{isDesktopSharePreview \? "true" : "false"\}/);
  assert.match(appSource, /className="desktop-share-preview-actions"/);
  assert.match(
    styles,
    /\.app-layout\[data-desktop-share="true"\] \.preview-panel\s*\{[^}]*grid-row:\s*1 \/ -1 !important;[^}]*display:\s*flex !important;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-desktop-share="true"\] \.preview-stage\s*\{[^}]*padding:\s*20px 0;[^}]*justify-content:\s*center;[^}]*background:\s*var\(--app-background\);/s,
  );
});

test("移动端复用安卓版 48dp 顶栏素材且返回按钮不会被标题挤压", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    appSource,
    /className="mobile-notes-back"[\s\S]*className="mobile-back-icon"/,
  );
  assert.match(appSource, /src="\/smartisan\/mobile\/btn_settings\.png"/);
  assert.match(
    appSource,
    /className="mobile-list-create"[\s\S]*className="smartisan-toolbar-icon icon-create"/,
  );
  assert.match(appSource, /className="mobile-list-title"[\s\S]*aria-controls="category-sidebar"/);
  assert.match(styles, /--topbar-height:\s*48px;/);
  assert.match(
    styles,
    /\.app-layout\[data-theme="default"\] \.app-topbar\s*\{[^}]*action_bar_default\.png[^}]*background-size:\s*100% 48px;/s,
  );
  assert.match(
    styles,
    /\.app-layout:not\(\[data-mobile-view="notes"\]\) \.app-topbar-inner\s*\{[^}]*grid-template-columns:\s*36px minmax\(0,\s*1fr\) auto;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-mobile-view="notes"\] \.app-topbar-inner\s*\{[^}]*grid-template-columns:\s*48px minmax\(0,\s*1fr\) 48px;/s,
  );
  assert.match(
    styles,
    /\.mobile-notes-back\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    styles,
    /\.mobile-back-icon\s*\{[^}]*background-image:\s*url\("\/smartisan\/mobile\/btn_back\.png"\);/s,
  );
  assert.match(
    styles,
    /\.mobile-list-create \.smartisan-toolbar-icon\s*\{[^}]*btn_create\.png/s,
  );
  assert.match(styles, /color-scheme:\s*only light;/);
  assert.match(
    styles,
    /\.app-layout:not\(\[data-mobile-view="notes"\]\) \.app-topbar-actions\s*\{[^}]*grid-column:\s*3;/s,
  );
  assert.ok(existsSync("public/smartisan/web/bar-bg_4cfb4d66ed.png"));
  assert.ok(existsSync("public/smartisan/web/all_icons_ab3d0991b9.png"));
  assert.ok(existsSync("public/smartisan/mobile/btn_settings.png"));
  assert.ok(existsSync("public/smartisan/mobile/btn_back.png"));
  assert.ok(existsSync("public/smartisan/mobile/btn_create.png"));
  assert.ok(existsSync("public/smartisan/mobile/btn_slide_delete_normal.png"));
  assert.ok(existsSync("public/smartisan/mobile/btn_slide_delete_pressed.png"));
});

test("移动端横滑锁定方向并按真机距离吸附", () => {
  assert.equal(getMobileNoteSwipeAxis(4, 2), "pending");
  assert.equal(getMobileNoteSwipeAxis(18, 4), "horizontal");
  assert.equal(getMobileNoteSwipeAxis(8, 18), "vertical");
  assert.equal(getMobileNoteSwipeAxis(12, 12), "vertical");

  assert.equal(getMobileNoteSwipeOffset(0, -40), 0);
  assert.equal(getMobileNoteSwipeOffset(0, 32), 32);
  assert.equal(
    getMobileNoteSwipeOffset(40, 80),
    MOBILE_NOTE_SWIPE_OPEN_OFFSET,
  );
  assert.equal(
    getMobileNoteSwipeOffset(MOBILE_NOTE_SWIPE_OPEN_OFFSET, -20),
    46,
  );
  assert.equal(shouldOpenMobileNoteSwipe(27), false);
  assert.equal(shouldOpenMobileNoteSwipe(28), true);
});

test("移动端保留安卓版纸片、固定装订夹与木纹资源", () => {
  const sidebarSource = readFileSync("src/components/NoteSidebar.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(sidebarSource, /className="note-sidebar-create-glyph"/);
  assert.doesNotMatch(sidebarSource, /src="\/smartisan\/mobile\/btn_create\.png"/);
  assert.match(sidebarSource, /className="note-list-clip-rail"/);
  assert.match(
    sidebarSource,
    /src="\/smartisan\/mobile\/note_item_clip_normal\.png"/,
  );
  assert.match(sidebarSource, /className="note-list-swipe-delete"/);
  assert.match(sidebarSource, /className="note-list-image-indicator"/);
  assert.match(sidebarSource, /className="note-search-icon"/);
  assert.match(sidebarSource, /icon_top_checked\.png/);
  assert.match(sidebarSource, /icon_top_normal\.png/);
  assert.match(
    styles,
    /url\("\/smartisan\/web\/grid_6e4a41eefc\.png"\)/,
  );
  assert.match(
    styles,
    /url\("\/smartisan\/web\/edge_004e88bdf2\.png"\)/,
  );
  assert.match(
    styles,
    /url\("\/smartisan\/web\/cloud_note_bg_d2def91e10\.jpg"\)/,
  );
  assert.match(
    styles,
    /\.note-list-select\s*\{[^}]*height:\s*75\.3333px;[^}]*padding:\s*5px 85px 0 52px;/s,
  );
  assert.match(
    styles,
    /\.note-list-select strong\s*\{[^}]*position:\s*absolute;[^}]*top:\s*38\.5px;[^}]*left:\s*52px;[^}]*font-size:\s*16\.5px;[^}]*line-height:\s*30px;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="default"\] \.note-list-card\s*\{[^}]*list-item-normal-right\.png[^}]*list-item-normal-left\.png[^}]*list-item-normal-center\.png/s,
  );
  assert.match(
    styles,
    /\.note-list-swipe-delete\s*\{[^}]*left:\s*22px;[^}]*width:\s*73\.6667px;[^}]*height:\s*35\.6667px;[^}]*btn_slide_delete_normal\.png/s,
  );
  assert.match(
    styles,
    /\.note-list-swipe-delete:active\s*\{[^}]*btn_slide_delete_pressed\.png/s,
  );
  assert.match(
    styles,
    /\.note-list-card\s*\{[^}]*touch-action:\s*pan-y;[^}]*translate3d\(var\(--note-swipe-offset,\s*0\),\s*0,\s*0\)/s,
  );

  for (const file of [
    "all_icons_ab3d0991b9.png",
    "all_icons_ab3d0991b9@2x.png",
    "bar-bg_4cfb4d66ed.png",
    "cloud_note_bg_d2def91e10.jpg",
    "edge_004e88bdf2.png",
    "grid_6e4a41eefc.png",
    "filter-icon-all_50596a80bd.png",
    "create_folder_09cb2d75c6.png",
  ]) {
    assert.ok(existsSync(`public/smartisan/web/${file}`), `${file} 应存在`);
  }
});

test("移动端拖拽只移动便签本体且图钉保留安全间距", () => {
  const sidebarSource = readFileSync("src/components/NoteSidebar.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");
  const indexSource = readFileSync("index.html", "utf8");

  assert.match(sidebarSource, /const \[isDragging, setIsDragging\] = useState\(false\);/);
  assert.match(sidebarSource, /const MOBILE_NOTE_DRAG_DELAY_MS = 220;/);
  assert.match(sidebarSource, /const MOBILE_NOTE_DRAG_TOLERANCE_PX = 12;/);
  assert.match(
    sidebarSource,
    /const isSortable = !pinned && !isDragDisabled && !isTrashView;/,
  );
  assert.match(
    sidebarSource,
    /function suppressMobileDragPreview[\s\S]*event\.preventDefault\(\);[\s\S]*window\.getSelection\(\)\?\.removeAllRanges\(\);/,
  );
  assert.match(sidebarSource, /onContextMenu=\{suppressMobileDragPreview\}/);
  assert.match(
    sidebarSource,
    /const restrictNoteDragToVerticalAxis:[\s\S]*x:\s*0,/,
  );
  assert.match(sidebarSource, /<DragOverlay[\s\S]*dropAnimation=\{null\}/);
  assert.match(
    sidebarSource,
    /gesture\.axis === "horizontal"[\s\S]*setPointerCapture\(event\.pointerId\)/,
  );
  assert.match(indexSource, /viewport-fit=cover/);
  assert.match(
    sidebarSource,
    /onDragStart=\{\(\{ active \}\) => \{[^}]*setOpenSwipeNoteId\(null\);[^}]*setActiveDragNoteId\(String\(active\.id\)\);[^}]*setIsDragging\(true\);/s,
  );
  assert.match(
    sidebarSource,
    /onDragCancel=\{\(\) => \{[^}]*setActiveDragNoteId\(null\);[^}]*setIsDragging\(false\);/s,
  );
  assert.match(
    sidebarSource,
    /className="note-list-clip-rail"[\s\S]*filteredNotes\.map\(\(note\) => \([\s\S]*className="note-list-clip"/s,
  );
  assert.match(
    styles,
    /\.note-list-clip-rail\s*\{[^}]*position:\s*absolute;[^}]*display:\s*flex;[^}]*width:\s*28\.6667px;[^}]*pointer-events:\s*none;/s,
  );
  assert.match(
    styles,
    /\.note-list\.is-dragging \.note-list-clip-rail\s*\{[^}]*transform:\s*translateX\(-19px\);/s,
  );
  assert.match(
    styles,
    /\.note-list-drag-overlay \.note-list-card\s*\{[^}]*transform:\s*none;[^}]*drop-shadow/s,
  );
  assert.match(
    styles,
    /\.note-list-item\.is-dragging:not\(\.note-list-drag-overlay\) \.note-list-card\s*\{[^}]*opacity:\s*0;/s,
  );
  assert.match(
    styles,
    /\.note-list-item\.is-sortable,[\s\S]*\.note-list-item\.is-sortable \*\s*\{[^}]*-webkit-touch-callout:\s*none;[^}]*-webkit-user-select:\s*none;[^}]*user-select:\s*none;/s,
  );
  assert.match(
    styles,
    /--mobile-safe-area-top:\s*env\(safe-area-inset-top,\s*0px\);[\s\S]*\.app-shell\s*\{[^}]*flex:\s*1;[^}]*height:\s*auto;[^}]*max-height:\s*none;/s,
  );
  assert.match(
    styles,
    /\.note-list-clip\s*\{[^}]*width:\s*28\.6667px;[^}]*height:\s*75\.3333px;[^}]*flex:\s*0 0 75\.3333px;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="default"\] \.note-list-item\.is-dragging \.note-list-card\s*\{[^}]*list-item-pressed-right\.png[^}]*box-shadow:\s*none;/s,
  );
  assert.match(
    styles,
    /\.note-list-pin\s*\{[^}]*right:\s*43px;[^}]*width:\s*39px;[^}]*height:\s*47px;/s,
  );
  assert.match(styles, /\.note-list-pin\s*\{[^}]*display:\s*grid;/s);
});
