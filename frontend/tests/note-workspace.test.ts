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

test("便签侧栏呈现搜索、新建和切换入口且不重复提供删除按钮", () => {
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
  assert.doesNotMatch(html, /aria-label="删除便签：第二张便签"/);
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
  assert.match(html, /下载锤子便签 APP/);
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

test("移动端采用便签列表、编辑和预览三态工作区", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

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
    /@media \(max-width: 640px\)[\s\S]*\.app-layout\[data-theme="default"\] \.preview-stage\s*\{[^}]*note_background\.png/s,
  );
  assert.doesNotMatch(
    styles,
    /\.preview-stage \.sheet-frame,[\s\S]*\.preview-stage \.sheet-footer\s*\{[^}]*display:\s*none;/s,
  );
  assert.doesNotMatch(
    styles,
    /\.preview-stage \.note-sheet\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*100%;/s,
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
    /\.markdown-editor-frame\s*\{[^}]*--editor-gutter-width:\s*25px;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
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
    /\.preview-stage\s*\{[^}]*padding:\s*20px 30px 20px 50px;[^}]*border-radius:\s*0;[^}]*justify-content:\s*flex-start;[^}]*background:[^}]*var\(--editor-rule-line\)[^}]*var\(--note-list-surface\);/s,
  );
  assert.match(
    styles,
    /\.markdown-editor-frame::before\s*\{[^}]*width:\s*25px;[^}]*edge_004e88bdf2\.png/s,
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
    /\.category-download-banner,[\s\S]*\.note-sidebar-bottom-menu\s*\{[^}]*height:\s*50px;[^}]*border-top:\s*1px solid #e9dece;[^}]*background:\s*var\(--note-list-surface\);/s,
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
    /\.app-layout\[data-theme="default"\] \.note-list-item\s*\{[^}]*list-item-normal-right\.png[^}]*list-item-normal-left\.png[^}]*list-item-normal-center\.png/s,
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

  assert.match(sidebarSource, /const \[isDragging, setIsDragging\] = useState\(false\);/);
  assert.match(sidebarSource, /onDragStart=\{\(\) => setIsDragging\(true\)\}/);
  assert.match(sidebarSource, /onDragCancel=\{\(\) => setIsDragging\(false\)\}/);
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
    /\.note-list-clip\s*\{[^}]*width:\s*28\.6667px;[^}]*height:\s*75\.3333px;[^}]*flex:\s*0 0 75\.3333px;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="default"\] \.note-list-item\.is-dragging\s*\{[^}]*list-item-pressed-right\.png[^}]*box-shadow:\s*none;/s,
  );
  assert.match(
    styles,
    /\.note-list-pin\s*\{[^}]*right:\s*43px;[^}]*width:\s*39px;[^}]*height:\s*47px;/s,
  );
  assert.match(styles, /\.note-list-pin\s*\{[^}]*display:\s*grid;/s);
});
