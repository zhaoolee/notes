import { useEffect, useMemo, useRef, useState } from "react";
import { CategorySidebar } from "./components/CategorySidebar";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorPanel, type EditorPanelHandle } from "./components/EditorPanel";
import { MoveNoteDialog } from "./components/MoveNoteDialog";
import { NoteSidebar } from "./components/NoteSidebar";
import { PreviewPanel } from "./components/PreviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SharePanel } from "./components/SharePanel";
import {
  getInitialFooterBrand,
  getInitialFooterVia,
  getRenderMode,
  persistNoteWorkspace,
  THEME_STORAGE_KEY,
} from "./lib/app-state";
import { copyTextToClipboard, normalizeClipboardMarkdown } from "./lib/clipboard";
import { exportMarkdownArchive, exportMarkdownAsPng, getExportErrorMessage } from "./lib/export";
import { splitSections } from "./lib/markdown";
import {
  getCategoryNoteDocuments,
  getFolderIdFromCategory,
} from "./lib/notes";
import { copyMarkdownForWechat } from "./lib/wechat";
import { useAppStore } from "./store/useAppStore";
import type { CopyState, NoteCategoryId, NoteFolder } from "./types/app";

type MobileWorkspaceView = "notes" | "editor" | "preview";
type DesktopWorkspaceView = "editor" | "preview";
type WechatCopyState = "idle" | "preparing" | "copied" | "failed";

const NOTE_REFRESH_DELAY_MS = 650;

function getCategoryLabel(
  categoryId: NoteCategoryId,
  folders: NoteFolder[],
): string {
  if (categoryId === "all") {
    return "全部便签";
  }

  if (categoryId === "starred") {
    return "加星便签";
  }

  if (categoryId === "trash") {
    return "回收站";
  }

  const folderId = getFolderIdFromCategory(categoryId);
  return folders.find((folder) => folder.id === folderId)?.name ?? "全部便签";
}

function getCopyButtonText(copyState: CopyState): string {
  if (copyState === "copied") {
    return "已复制文本";
  }

  if (copyState === "failed") {
    return "复制失败";
  }

  return "复制文本";
}

function getWechatCopyButtonText(copyState: WechatCopyState): string {
  if (copyState === "preparing") {
    return "正在处理图片...";
  }

  if (copyState === "copied") {
    return "已复制到公众号";
  }

  if (copyState === "failed") {
    return "公众号复制失败";
  }

  return "复制到公众号";
}

function formatMobileNoteUpdatedAt(timestamp: number | undefined): string {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export default function App() {
  const renderMode = getRenderMode();
  const isPlaywrightRender = renderMode === "playwright";
  const [footerBrand, setFooterBrand] = useState(getInitialFooterBrand);
  const [footerVia, setFooterVia] = useState(getInitialFooterVia);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [isRefreshingNotes, setIsRefreshingNotes] = useState(false);
  const [isNoteSidebarOpen, setIsNoteSidebarOpen] = useState(false);
  const [isCategorySidebarOpen, setIsCategorySidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isDesktopViewMenuOpen, setIsDesktopViewMenuOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [isDesktopCategoryCollapsed, setIsDesktopCategoryCollapsed] =
    useState(false);
  const [isDesktopSharePreview, setIsDesktopSharePreview] = useState(false);
  const [wechatCopyState, setWechatCopyState] =
    useState<WechatCopyState>("idle");
  const [activeCategoryId, setActiveCategoryId] =
    useState<NoteCategoryId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileWorkspaceView, setMobileWorkspaceView] =
    useState<MobileWorkspaceView>("notes");
  const [desktopWorkspaceView, setDesktopWorkspaceView] =
    useState<DesktopWorkspaceView>("editor");
  const editorPanelRef = useRef<EditorPanelHandle | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const shareContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopViewMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopViewBeforeShareRef = useRef<DesktopWorkspaceView>("editor");
  const activeNoteId = useAppStore((state) => state.activeNoteId);
  const folders = useAppStore((state) => state.folders);
  const noteDocuments = useAppStore((state) => state.notes);
  const markdown = useAppStore((state) => state.markdown);
  const selectedTheme = useAppStore((state) => state.selectedTheme);
  const isExporting = useAppStore((state) => state.isExporting);
  const exportError = useAppStore((state) => state.exportError);
  const copyState = useAppStore((state) => state.copyState);
  const pendingAction = useAppStore((state) => state.pendingAction);
  const createNote = useAppStore((state) => state.createNote);
  const createFolder = useAppStore((state) => state.createFolder);
  const deleteFolder = useAppStore((state) => state.deleteFolder);
  const reorderNotes = useAppStore((state) => state.reorderNotes);
  const moveNoteToFolder = useAppStore((state) => state.moveNoteToFolder);
  const selectNote = useAppStore((state) => state.selectNote);
  const requestDeleteNote = useAppStore((state) => state.requestDeleteNote);
  const requestPermanentlyDeleteNote = useAppStore(
    (state) => state.requestPermanentlyDeleteNote,
  );
  const restoreNote = useAppStore((state) => state.restoreNote);
  const setMarkdown = useAppStore((state) => state.setMarkdown);
  const setSelectedTheme = useAppStore((state) => state.setSelectedTheme);
  const setIsExporting = useAppStore((state) => state.setIsExporting);
  const setExportError = useAppStore((state) => state.setExportError);
  const setCopyState = useAppStore((state) => state.setCopyState);
  const togglePinned = useAppStore((state) => state.togglePinned);
  const toggleStarred = useAppStore((state) => state.toggleStarred);
  const clearPendingAction = useAppStore((state) => state.clearPendingAction);
  const confirmPendingAction = useAppStore((state) => state.confirmPendingAction);

  const categoryNoteDocuments = useMemo(
    () => getCategoryNoteDocuments(noteDocuments, activeCategoryId),
    [activeCategoryId, noteDocuments],
  );
  const categoryLabel = getCategoryLabel(activeCategoryId, folders);
  const activeCategoryNote = categoryNoteDocuments.find(
    (note) => note.id === activeNoteId,
  );
  const hasActiveCategoryNote = Boolean(activeCategoryNote);
  const notes = splitSections(markdown);
  const activeNote = noteDocuments.find((note) => note.id === activeNoteId);
  const mobileNoteCharacterCount = activeCategoryNote
    ? markdown.replace(/\s/g, "").length
    : 0;

  useEffect(() => {
    persistNoteWorkspace({
      activeNoteId,
      folders,
      notes: noteDocuments,
      version: 1,
    });
  }, [activeNoteId, folders, noteDocuments]);

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      categoryNoteDocuments.length > 0 &&
      !categoryNoteDocuments.some((note) => note.id === activeNoteId)
    ) {
      selectNote(categoryNoteDocuments[0].id);
    }
  }, [activeNoteId, categoryNoteDocuments, selectNote]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
    document.documentElement.dataset.theme = selectedTheme;
  }, [selectedTheme]);

  useEffect(() => {
    if (copyState === "idle") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCopyState("idle");
    }, 1800);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [copyState, setCopyState]);

  useEffect(() => {
    if (wechatCopyState === "idle" || wechatCopyState === "preparing") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setWechatCopyState("idle");
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [wechatCopyState]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && !settingsContainerRef.current?.contains(target)) {
        setIsSettingsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isShareOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (target instanceof Node && !shareContainerRef.current?.contains(target)) {
        setIsShareOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsShareOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShareOpen]);

  useEffect(() => {
    if (!isNoteSidebarOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsNoteSidebarOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isNoteSidebarOpen]);

  useEffect(() => {
    if (!isDesktopViewMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        !desktopViewMenuRef.current?.contains(target)
      ) {
        setIsDesktopViewMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDesktopViewMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDesktopViewMenuOpen]);

  useEffect(() => {
    if (!isMoveDialogOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMoveDialogOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMoveDialogOpen]);

  useEffect(() => {
    if (!isCategorySidebarOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsCategorySidebarOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCategorySidebarOpen]);

  async function handleExport() {
    if (isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");
      await exportMarkdownAsPng(markdown, selectedTheme, {
        footerBrand,
        footerVia,
      });
    } catch (error) {
      console.error("PNG export failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleArchiveDownload() {
    if (isArchiving) {
      return;
    }

    try {
      setIsArchiving(true);
      setExportError("");
      await exportMarkdownArchive(markdown, {
        footerBrand,
        footerVia,
      });
    } catch (error) {
      console.error("Archive download failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleCopyMarkdown() {
    try {
      await copyTextToClipboard(normalizeClipboardMarkdown(markdown));
      setCopyState("copied");
    } catch (error) {
      console.error("Markdown copy failed", error);
      setCopyState("failed");
    }
  }

  async function handleCopyWechat() {
    if (wechatCopyState === "preparing") {
      return;
    }

    try {
      setWechatCopyState("preparing");
      setExportError("");
      await copyMarkdownForWechat(markdown);
      setWechatCopyState("copied");
    } catch (error) {
      console.error("Wechat rich-text copy failed", error);
      setWechatCopyState("failed");
      setExportError(
        error instanceof Error
          ? `复制到公众号失败：${error.message}`
          : "复制到公众号失败",
      );
    }
  }

  function handleCreateNote() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);
    setIsNoteSidebarOpen(false);
    setIsCategorySidebarOpen(false);
    const folderId = getFolderIdFromCategory(activeCategoryId);
    const shouldStar = activeCategoryId === "starred";

    if (activeCategoryId === "trash") {
      setActiveCategoryId("all");
    }

    createNote("", folderId, shouldStar);
    setDesktopWorkspaceView("editor");
    setMobileWorkspaceView("editor");
    setIsDesktopViewMenuOpen(false);
    setIsDesktopSharePreview(false);
  }

  function handleRefreshNotes() {
    if (refreshTimeoutRef.current !== null) {
      return;
    }

    setIsRefreshingNotes(true);
    refreshTimeoutRef.current = window.setTimeout(() => {
      window.location.reload();
    }, NOTE_REFRESH_DELAY_MS);
  }

  function handleSelectNote(noteId: string) {
    selectNote(noteId);
    setIsShareOpen(false);
    setIsNoteSidebarOpen(false);
    setIsCategorySidebarOpen(false);
    setDesktopWorkspaceView(activeCategoryId === "trash" ? "preview" : "editor");
    setMobileWorkspaceView(activeCategoryId === "trash" ? "preview" : "editor");
    setIsDesktopViewMenuOpen(false);
    setIsDesktopSharePreview(false);
  }

  function handleSelectCategory(categoryId: NoteCategoryId) {
    setActiveCategoryId(categoryId);
    setIsCategorySidebarOpen(false);
    setIsNoteSidebarOpen(false);
    setMobileWorkspaceView("notes");

    const [firstNote] = getCategoryNoteDocuments(noteDocuments, categoryId);

    if (firstNote) {
      selectNote(firstNote.id);
    }
  }

  function handleDeleteFolder(folderId: string) {
    if (getFolderIdFromCategory(activeCategoryId) === folderId) {
      setActiveCategoryId("all");
    }

    deleteFolder(folderId);
  }

  function handleMoveCurrentNoteToFolder(folderId: string | null) {
    moveNoteToFolder(activeNoteId, folderId);
  }

  function handleDeleteCurrentNote() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);
    requestDeleteNote(activeNoteId);
  }

  function handleInsertImage() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);
    editorPanelRef.current?.openImagePicker();
  }

  function handleShareTrigger() {
    setIsSettingsOpen(false);

    if (window.matchMedia("(min-width: 641px)").matches) {
      desktopViewBeforeShareRef.current = desktopWorkspaceView;
      setIsDesktopViewMenuOpen(false);
      setIsDesktopSharePreview(true);
      setDesktopWorkspaceView("preview");
      return;
    }

    setIsShareOpen((isOpen) => !isOpen);
  }

  function handleCloseDesktopSharePreview() {
    setIsDesktopSharePreview(false);
    setDesktopWorkspaceView(desktopViewBeforeShareRef.current);
  }

  return (
    <>
      <div
        className="app-layout"
        data-theme={selectedTheme}
        data-render-mode={isPlaywrightRender ? "playwright" : undefined}
        data-desktop-view={desktopWorkspaceView}
        data-desktop-category-collapsed={
          isDesktopCategoryCollapsed ? "true" : "false"
        }
        data-desktop-share={isDesktopSharePreview ? "true" : "false"}
        data-category-open={isCategorySidebarOpen ? "true" : "false"}
        data-has-active-note={hasActiveCategoryNote ? "true" : "false"}
        data-mobile-view={mobileWorkspaceView}
      >
        <header className="app-topbar">
          <div className="app-topbar-inner">
            <button
              type="button"
              className="mobile-notes-back"
              aria-label="返回便签列表"
              onClick={() => {
                setIsSettingsOpen(false);
                setIsShareOpen(false);
                setMobileWorkspaceView("notes");
              }}
            >
              <span className="mobile-back-icon" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="note-navigation-trigger"
              aria-controls="note-sidebar"
              aria-expanded={isNoteSidebarOpen}
              aria-label={isNoteSidebarOpen ? "关闭便签导航" : "打开便签导航"}
              onClick={() => setIsNoteSidebarOpen((isOpen) => !isOpen)}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>

            <div className="app-brand">
              <div className="app-brand-mark" aria-hidden="true">
                <img src="/header/logo.png" alt="" />
              </div>
              <div className="app-brand-copy">
                <span className="app-brand-title">锤子便签</span>
              </div>
            </div>

            <button
              type="button"
              className="mobile-list-title"
              aria-controls="category-sidebar"
              aria-expanded={isCategorySidebarOpen}
              onClick={() => {
                setIsSettingsOpen(false);
                setIsShareOpen(false);
                setIsCategorySidebarOpen((isOpen) => !isOpen);
              }}
            >
              <span>{categoryLabel}</span>
              <span className="mobile-list-title-arrow" aria-hidden="true">
                ▾
              </span>
            </button>

            <button
              type="button"
              className="mobile-list-create"
              aria-label="新建便签"
              title="新建便签"
              onClick={handleCreateNote}
            >
              <span className="smartisan-toolbar-icon icon-create" aria-hidden="true" />
            </button>

            <div className="desktop-left-actions">
              <button
                type="button"
                className={`desktop-toolbar-button desktop-refresh-note${
                  isRefreshingNotes ? " is-refreshing" : ""
                }`}
                aria-label="刷新便签"
                aria-busy={isRefreshingNotes}
                title="刷新便签"
                onClick={handleRefreshNotes}
              >
                <span className="smartisan-toolbar-icon icon-refresh" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="desktop-toolbar-button desktop-create-note"
                aria-label="新建便签"
                title="新建便签"
                onClick={handleCreateNote}
              >
                <span className="smartisan-toolbar-icon icon-create" aria-hidden="true" />
              </button>
            </div>

            <div className="app-topbar-actions">
              <button type="button" className="primary preview-export" onClick={handleExport}>
                {isExporting ? "导出中..." : "存图"}
              </button>

              <div className="mobile-detail-actions">
                <button
                  type="button"
                  className="mobile-detail-action mobile-insert-image"
                  aria-label={isImportingImage ? "正在导入图片" : "插入图片"}
                  disabled={isImportingImage}
                  onClick={handleInsertImage}
                >
                  <span
                    className="smartisan-toolbar-icon icon-insert-image"
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className="mobile-detail-action desktop-move-note"
                  aria-label="转移当前便签到文件夹"
                  disabled={!activeCategoryNote || activeCategoryId === "trash"}
                  onClick={() => setIsMoveDialogOpen(true)}
                >
                  <span className="smartisan-toolbar-icon icon-move" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="mobile-detail-action mobile-edit-done"
                  aria-label="完成编辑并预览"
                  onClick={() => setMobileWorkspaceView("preview")}
                >
                  <span className="smartisan-toolbar-icon icon-create" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="mobile-detail-action mobile-delete-note"
                  aria-label="删除当前便签"
                  onClick={handleDeleteCurrentNote}
                >
                  <span className="smartisan-toolbar-icon icon-delete" aria-hidden="true" />
                </button>

                <div className="app-share" ref={shareContainerRef}>
                  <button
                    type="button"
                    className="share-trigger"
                    aria-label={isShareOpen ? "关闭分享与导出" : "打开分享与导出"}
                    aria-controls="app-share-panel"
                    aria-expanded={isShareOpen}
                    title="分享与导出"
                    onClick={handleShareTrigger}
                  >
                    <span className="smartisan-toolbar-icon icon-share" aria-hidden="true" />
                  </button>

                  {isShareOpen ? (
                    <SharePanel
                      copyButtonText={getCopyButtonText(copyState)}
                      isArchiving={isArchiving}
                      isCopyingWechat={wechatCopyState === "preparing"}
                      isExporting={isExporting}
                      onArchiveDownload={() => {
                        setIsShareOpen(false);
                        void handleArchiveDownload();
                      }}
                      onClose={() => setIsShareOpen(false)}
                      onCopyMarkdown={() => {
                        void handleCopyMarkdown();
                      }}
                      onCopyWechat={() => {
                        void handleCopyWechat();
                      }}
                      onExport={() => {
                        setIsShareOpen(false);
                        void handleExport();
                      }}
                      wechatButtonText={getWechatCopyButtonText(wechatCopyState)}
                    />
                  ) : null}
                </div>
              </div>

              {isDesktopSharePreview ? (
                <div className="desktop-share-preview-actions">
                  <button
                    type="button"
                    className="desktop-share-cancel"
                    onClick={handleCloseDesktopSharePreview}
                  >
                    取消
                  </button>
                  <div className="desktop-share-export-actions">
                    <button
                      type="button"
                      disabled={wechatCopyState === "preparing"}
                      onClick={() => {
                        void handleCopyWechat();
                      }}
                    >
                      {getWechatCopyButtonText(wechatCopyState)}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopyMarkdown();
                      }}
                    >
                      {getCopyButtonText(copyState)}
                    </button>
                    <button
                      type="button"
                      disabled={isArchiving}
                      onClick={() => {
                        void handleArchiveDownload();
                      }}
                    >
                      {isArchiving ? "归档中..." : "下载归档"}
                    </button>
                    <button
                      type="button"
                      disabled={isExporting}
                      onClick={() => {
                        void handleExport();
                      }}
                    >
                      {isExporting ? "导出中..." : "保存图片"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="app-settings" ref={settingsContainerRef}>
                <button
                  type="button"
                  className="settings-trigger"
                  aria-label={isSettingsOpen ? "关闭设置" : "打开设置"}
                  aria-controls="app-settings-panel"
                  aria-expanded={isSettingsOpen}
                  title="设置"
                  onClick={() => {
                    setIsCategorySidebarOpen(false);
                    setIsShareOpen(false);
                    setIsSettingsOpen((isOpen) => !isOpen);
                  }}
                >
                  <img
                    src="/smartisan/mobile/btn_settings.png"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                </button>

                {isSettingsOpen ? (
                  <SettingsPanel
                    selectedTheme={selectedTheme}
                    onClose={() => setIsSettingsOpen(false)}
                    onThemeChange={setSelectedTheme}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className="app-shell">
          <CategorySidebar
            activeCategoryId={activeCategoryId}
            folders={folders}
            isOpen={isCategorySidebarOpen}
            notes={noteDocuments}
            searchQuery={searchQuery}
            onCategorySelect={handleSelectCategory}
            onClose={() => setIsCategorySidebarOpen(false)}
            onCreateFolder={createFolder}
            onDeleteFolder={handleDeleteFolder}
            onSearchQueryChange={setSearchQuery}
          />

          <button
            type="button"
            className={`category-popover-backdrop${
              isCategorySidebarOpen ? " is-visible" : ""
            }`}
            aria-label="关闭分类浮窗"
            tabIndex={isCategorySidebarOpen ? 0 : -1}
            onClick={() => setIsCategorySidebarOpen(false)}
          />

          <NoteSidebar
            activeNoteId={activeNoteId}
            categoryLabel={categoryLabel}
            isTrashView={activeCategoryId === "trash"}
            isOpen={isNoteSidebarOpen}
            notes={categoryNoteDocuments}
            searchQuery={searchQuery}
            onClose={() => setIsNoteSidebarOpen(false)}
            onCreateNote={handleCreateNote}
            onPermanentlyDeleteNote={requestPermanentlyDeleteNote}
            onReorderNotes={reorderNotes}
            onRestoreNote={restoreNote}
            onSearchQueryChange={setSearchQuery}
            onSelectNote={handleSelectNote}
            onTogglePinned={togglePinned}
            onToggleStarred={toggleStarred}
            isDesktopCategoryCollapsed={isDesktopCategoryCollapsed}
            onToggleDesktopCategory={() =>
              setIsDesktopCategoryCollapsed((isCollapsed) => !isCollapsed)
            }
          />

          <button
            type="button"
            className={`note-sidebar-backdrop${isNoteSidebarOpen ? " is-visible" : ""}`}
            aria-label="关闭便签导航"
            tabIndex={isNoteSidebarOpen ? 0 : -1}
            onClick={() => setIsNoteSidebarOpen(false)}
          />

          <div className="desktop-workspace-toolbar" aria-label="桌面便签工作区状态">
            <div className="desktop-view-switch" ref={desktopViewMenuRef}>
              <button
                type="button"
                className="desktop-view-switch-trigger"
                aria-label="切换编辑与实时预览"
                aria-haspopup="menu"
                aria-expanded={isDesktopViewMenuOpen}
                onClick={() => setIsDesktopViewMenuOpen((isOpen) => !isOpen)}
              >
                <span>
                  {desktopWorkspaceView === "editor" ? "Markdown 模式" : "实时预览"}
                </span>
                <span className="desktop-view-switch-arrow" aria-hidden="true" />
              </button>

              {isDesktopViewMenuOpen ? (
                <div className="desktop-view-menu" role="menu">
                  {(
                    [
                      ["editor", "Markdown 模式"],
                      ["preview", "实时预览"],
                    ] as const
                  ).map(([view, label]) => (
                    <button
                      type="button"
                      key={view}
                      role="menuitemradio"
                      aria-checked={desktopWorkspaceView === view}
                      className={
                        desktopWorkspaceView === view ? "is-active" : undefined
                      }
                      onClick={() => {
                        setDesktopWorkspaceView(view);
                        setIsDesktopViewMenuOpen(false);
                      }}
                    >
                      <span aria-hidden="true">
                        {desktopWorkspaceView === view ? "✓" : ""}
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="desktop-note-status" aria-label="当前便签信息">
              <label className="desktop-note-folder">
                <span aria-hidden="true">▧</span>
                <span className="visually-hidden">移动当前便签到文件夹</span>
                <select
                  aria-label="移动当前便签到文件夹"
                  disabled={!activeCategoryNote || activeCategoryId === "trash"}
                  value={activeNote?.folderId ?? ""}
                  onChange={(event) =>
                    handleMoveCurrentNoteToFolder(event.target.value || null)
                  }
                >
                  <option value="">全部便签</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              <span aria-hidden="true">|</span>
              <span>{formatMobileNoteUpdatedAt(activeCategoryNote?.updatedAt)}</span>
              <span aria-hidden="true">|</span>
              <span>{mobileNoteCharacterCount} 字</span>
            </div>
          </div>

          <div className="mobile-workspace-tabs" aria-label="便签详情信息与视图">
            <label
              className="mobile-note-folder"
            >
              <span aria-hidden="true">▧</span>
              <span className="visually-hidden">移动当前便签到文件夹</span>
              <select
                aria-label="移动当前便签到文件夹"
                disabled={!activeCategoryNote || activeCategoryId === "trash"}
                value={activeNote?.folderId ?? ""}
                onChange={(event) =>
                  handleMoveCurrentNoteToFolder(event.target.value || null)
                }
              >
                <option value="">全部便签</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <span className="mobile-note-folder-arrow" aria-hidden="true">
                ▾
              </span>
            </label>
            <span className="mobile-note-stats">
              <span>{formatMobileNoteUpdatedAt(activeCategoryNote?.updatedAt)}</span>
              <span aria-hidden="true">|</span>
              <span>{mobileNoteCharacterCount}</span>
            </span>
            <button
              type="button"
              className="mobile-view-toggle"
              aria-pressed={mobileWorkspaceView === "preview"}
              aria-label={
                mobileWorkspaceView === "preview"
                  ? "切换到 Markdown 编辑"
                  : "切换到便签预览"
              }
              onClick={() =>
                setMobileWorkspaceView((currentView) =>
                  currentView === "preview" ? "editor" : "preview",
                )
              }
            >
              {mobileWorkspaceView === "preview" ? "编辑" : "预览"}
            </button>
          </div>

          <EditorPanel
            key={activeNoteId}
            ref={editorPanelRef}
            markdown={markdown}
            onImageImportingChange={setIsImportingImage}
            onMarkdownChange={setMarkdown}
          />

          <PreviewPanel
            notes={notes}
            exportError={exportError}
            footerBrand={footerBrand}
            footerVia={footerVia}
            onFooterBrandChange={setFooterBrand}
            onFooterViaChange={setFooterVia}
          />

          <div className="category-empty-workspace" role="status">
            <p>{activeCategoryId === "trash" ? "回收站为空" : "这个分类还没有便签"}</p>
            {activeCategoryId !== "trash" ? (
              <button type="button" onClick={handleCreateNote}>
                新建便签
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        pendingAction={pendingAction}
        onClose={clearPendingAction}
        onConfirm={confirmPendingAction}
      />

      {isMoveDialogOpen ? (
        <MoveNoteDialog
          currentFolderId={activeNote?.folderId ?? null}
          folders={folders}
          onClose={() => setIsMoveDialogOpen(false)}
          onCreateFolder={createFolder}
          onMove={handleMoveCurrentNoteToFolder}
        />
      ) : null}
    </>
  );
}
