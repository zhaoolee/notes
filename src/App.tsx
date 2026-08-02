import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CategorySidebar } from "./components/CategorySidebar";
import { AiReviewDialog } from "./components/AiReviewDialog";
import { ChangePasswordDialog } from "./components/ChangePasswordDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorPanel, type EditorPanelHandle } from "./components/EditorPanel";
import { LoginDialog } from "./components/LoginDialog";
import { MoveNoteDialog } from "./components/MoveNoteDialog";
import { NoteSidebar } from "./components/NoteSidebar";
import { PreviewPanel } from "./components/PreviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SharePanel } from "./components/SharePanel";
import {
  getInitialAiEnabled,
  getInitialFooterBrand,
  getInitialFooterLogoUrl,
  getInitialFooterVia,
  getInitialNoteWorkspace,
  getRenderMode,
  isSmartisanWebTestDataMode,
  persistAiEnabled,
  persistFooterLogoUrl,
  persistFooterText,
  persistNoteWorkspace,
  THEME_STORAGE_KEY,
} from "./lib/app-state";
import { getAiStatus } from "./lib/ai";
import {
  canUseCloudWorkspace,
  changeUserPassword,
  downloadHermesSkillPackage,
  getHermesSkillInstallLink,
  getAuthSession,
  getCloudWorkspace,
  loginUser,
  logoutUser,
  resetHermesSkillInstallLink,
  saveCloudWorkspace,
  type AuthUser,
} from "./lib/auth";
import { copyTextToClipboard, normalizeClipboardMarkdown } from "./lib/clipboard";
import {
  exportMarkdownArchive,
  exportMarkdownAsPng,
  exportNoteWorkspaceArchive,
  getExportErrorMessage,
  type WorkspaceArchiveProgress,
} from "./lib/export";
import { buildHermesSkillInstallInstruction } from "./lib/hermes";
import { splitSections } from "./lib/markdown";
import { useResolvedTheme } from "./lib/use-theme";
import {
  getCategoryNoteDocuments,
  getFolderIdFromCategory,
  orderNoteDocuments,
} from "./lib/notes";
import {
  parseNoteRouteHash,
  writeCurrentNoteRoute,
  type NoteRoute,
  type NoteRouteView,
} from "./lib/note-route";
import { copyMarkdownForWechat } from "./lib/wechat";
import { useAppStore } from "./store/useAppStore";
import type {
  CopyState,
  NoteCategoryId,
  NoteFolder,
  NoteWorkspace,
} from "./types/app";

type MobileWorkspaceView = "notes" | "editor" | "preview";
type DesktopWorkspaceView = "editor" | "preview";
type WechatCopyState = "idle" | "preparing" | "copied" | "failed";
type HermesSkillLinkActionState =
  | "idle"
  | "copying"
  | "copied"
  | "resetting"
  | "reset";

interface NoteRouteNavigation {
  revision: number;
  route: NoteRoute | null;
}

const NOTE_REFRESH_DELAY_MS = 650;
const CLOUD_SAVE_DELAY_MS = 650;
const CLOUD_POLL_INTERVAL_MS = 15_000;
const HERMES_SKILL_LINK_RESET_CONFIRMATION = {
  title: "重置 Hermes 安装链接？",
  description:
    "重置后，当前专属链接会立即失效，之后无法再用于下载；已经安装的 Skill 不受影响。",
  confirmLabel: "确认重置",
};

function getCurrentWorkspace(): NoteWorkspace {
  const state = useAppStore.getState();

  return {
    activeNoteId: state.activeNoteId,
    folders: state.folders,
    notes: state.notes,
    version: 1,
  };
}

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
    return "已复制文字";
  }

  if (copyState === "failed") {
    return "复制失败";
  }

  return "复制文字";
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
  const isTestDataMode = isSmartisanWebTestDataMode();
  const [footerBrand, setFooterBrand] = useState(getInitialFooterBrand);
  const [footerLogoUrl, setFooterLogoUrl] = useState(getInitialFooterLogoUrl);
  const [footerVia, setFooterVia] = useState(getInitialFooterVia);
  const [aiEnabled, setAiEnabled] = useState(getInitialAiEnabled);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiReviewNoteId, setAiReviewNoteId] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isWorkspaceArchiveExporting, setIsWorkspaceArchiveExporting] =
    useState(false);
  const [workspaceArchiveProgress, setWorkspaceArchiveProgress] =
    useState<WorkspaceArchiveProgress | null>(null);
  const [workspaceArchiveError, setWorkspaceArchiveError] = useState("");
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
  const [isDesktopFocusMode, setIsDesktopFocusMode] = useState(false);
  const [isDesktopSharePreview, setIsDesktopSharePreview] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "ready">("loading");
  const [cloudSyncState, setCloudSyncState] = useState<
    "local" | "syncing" | "synced" | "failed"
  >("local");
  const [cloudSyncError, setCloudSyncError] = useState("");
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isHermesSkillDownloading, setIsHermesSkillDownloading] =
    useState(false);
  const [
    isHermesSkillLinkResetConfirmationOpen,
    setIsHermesSkillLinkResetConfirmationOpen,
  ] = useState(false);
  const [hermesSkillLinkActionState, setHermesSkillLinkActionState] =
    useState<HermesSkillLinkActionState>("idle");
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [wechatCopyState, setWechatCopyState] =
    useState<WechatCopyState>("idle");
  const [activeCategoryId, setActiveCategoryId] =
    useState<NoteCategoryId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileWorkspaceView, setMobileWorkspaceView] =
    useState<MobileWorkspaceView>("notes");
  const [desktopWorkspaceView, setDesktopWorkspaceView] =
    useState<DesktopWorkspaceView>("editor");
  const [noteRouteNavigation, setNoteRouteNavigation] =
    useState<NoteRouteNavigation>(() => ({
      revision: 0,
      route:
        typeof window === "undefined"
          ? null
          : parseNoteRouteHash(window.location.hash),
    }));
  const editorPanelRef = useRef<EditorPanelHandle | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopSettingsContainerRef = useRef<HTMLButtonElement | null>(null);
  const settingsPanelHostRef = useRef<HTMLDivElement | null>(null);
  const shareContainerRef = useRef<HTMLDivElement | null>(null);
  const accountContainerRef = useRef<HTMLDivElement | null>(null);
  const desktopViewMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopViewBeforeShareRef = useRef<DesktopWorkspaceView>("editor");
  const mobileDraftNoteIdRef = useRef<string | null>(null);
  const cloudSaveTimeoutRef = useRef<number | null>(null);
  const cloudRevisionRef = useRef(0);
  const cloudHydratedUserIdRef = useRef<string | null>(null);
  const skipNextCloudSaveRef = useRef(false);
  const restoredNoteRouteRevisionRef = useRef(-1);
  const activeNoteId = useAppStore((state) => state.activeNoteId);
  const folders = useAppStore((state) => state.folders);
  const noteDocuments = useAppStore((state) => state.notes);
  const markdown = useAppStore((state) => state.markdown);
  const selectedTheme = useAppStore((state) => state.selectedTheme);
  const resolvedTheme = useResolvedTheme(selectedTheme);
  const isExporting = useAppStore((state) => state.isExporting);
  const exportError = useAppStore((state) => state.exportError);
  const copyState = useAppStore((state) => state.copyState);
  const pendingAction = useAppStore((state) => state.pendingAction);
  const createNote = useAppStore((state) => state.createNote);
  const discardEmptyDraft = useAppStore((state) => state.discardEmptyDraft);
  const createFolder = useAppStore((state) => state.createFolder);
  const deleteFolder = useAppStore((state) => state.deleteFolder);
  const reorderNotes = useAppStore((state) => state.reorderNotes);
  const moveNoteToFolder = useAppStore((state) => state.moveNoteToFolder);
  const selectNote = useAppStore((state) => state.selectNote);
  const requestDeleteNote = useAppStore((state) => state.requestDeleteNote);
  const requestPermanentlyDeleteNote = useAppStore(
    (state) => state.requestPermanentlyDeleteNote,
  );
  const replaceWorkspace = useAppStore((state) => state.replaceWorkspace);
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

  useLayoutEffect(() => {
    const rootStyle = document.documentElement.style;
    const mobileQuery = window.matchMedia("(max-width: 640px)");
    const viewport = window.visualViewport;
    const propertyNames = [
      "--mobile-visual-viewport-height",
      "--mobile-visual-viewport-offset-top",
    ] as const;

    const clearViewportProperties = () => {
      for (const propertyName of propertyNames) {
        rootStyle.removeProperty(propertyName);
      }
    };

    const syncVisualViewport = () => {
      if (!mobileQuery.matches) {
        clearViewportProperties();
        return;
      }

      const height = Math.max(1, viewport?.height ?? window.innerHeight);
      const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);

      rootStyle.setProperty("--mobile-visual-viewport-height", `${height}px`);
      rootStyle.setProperty(
        "--mobile-visual-viewport-offset-top",
        `${offsetTop}px`,
      );
    };

    syncVisualViewport();
    mobileQuery.addEventListener("change", syncVisualViewport);
    viewport?.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("scroll", syncVisualViewport);
    window.addEventListener("orientationchange", syncVisualViewport);
    window.addEventListener("pageshow", syncVisualViewport);
    window.addEventListener("resize", syncVisualViewport);

    return () => {
      mobileQuery.removeEventListener("change", syncVisualViewport);
      viewport?.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("scroll", syncVisualViewport);
      window.removeEventListener("orientationchange", syncVisualViewport);
      window.removeEventListener("pageshow", syncVisualViewport);
      window.removeEventListener("resize", syncVisualViewport);
      clearViewportProperties();
    };
  }, []);

  useEffect(() => {
    if (isTestDataMode) {
      setAuthStatus("ready");
      setCloudSyncState("local");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const session = await getAuthSession();

        if (cancelled) {
          return;
        }

        if (canUseCloudWorkspace(session)) {
          setCloudSyncState("syncing");
          const cloud = await getCloudWorkspace();

          if (cancelled) {
            return;
          }

          if (cloud.workspace) {
            skipNextCloudSaveRef.current = true;
            replaceWorkspace(cloud.workspace);
            cloudRevisionRef.current = cloud.updatedAt ?? 0;
          } else {
            const saved = await saveCloudWorkspace(getCurrentWorkspace());

            if (cancelled) {
              return;
            }

            cloudRevisionRef.current = saved.updatedAt ?? 0;
            skipNextCloudSaveRef.current = true;
          }

          cloudHydratedUserIdRef.current = session.id;
          setCloudSyncState("synced");
        }

        setAuthUser(session);
      } catch (error) {
        if (!cancelled) {
          setCloudSyncState("failed");
          setCloudSyncError(
            error instanceof Error ? error.message : "云端同步初始化失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setAuthStatus("ready");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isTestDataMode, replaceWorkspace]);

  useEffect(() => {
    if (isPlaywrightRender) {
      return;
    }

    let cancelled = false;
    let retryTimeoutId: number | null = null;
    let attempts = 0;

    const checkStatus = async () => {
      attempts += 1;

      try {
        const available = await getAiStatus();

        if (!cancelled) {
          setAiAvailable(available);
        }
      } catch {
        if (!cancelled && attempts < 10) {
          retryTimeoutId = window.setTimeout(() => {
            void checkStatus();
          }, 800);
        }
      }
    };

    void checkStatus();

    return () => {
      cancelled = true;

      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [isPlaywrightRender]);

  useEffect(() => {
    if (authStatus !== "ready") {
      return;
    }

    const workspace: NoteWorkspace = {
      activeNoteId,
      folders,
      notes: noteDocuments,
      version: 1,
    };

    if (!canUseCloudWorkspace(authUser)) {
      persistNoteWorkspace(workspace);
      setCloudSyncState("local");
      return;
    }

    if (cloudHydratedUserIdRef.current !== authUser.id) {
      return;
    }

    if (skipNextCloudSaveRef.current) {
      skipNextCloudSaveRef.current = false;
      return;
    }

    if (cloudSaveTimeoutRef.current !== null) {
      window.clearTimeout(cloudSaveTimeoutRef.current);
    }

    setCloudSyncState("syncing");
    cloudSaveTimeoutRef.current = window.setTimeout(() => {
      cloudSaveTimeoutRef.current = null;
      void saveCloudWorkspace(workspace)
        .then((stored) => {
          cloudRevisionRef.current = stored.updatedAt ?? Date.now();
          setCloudSyncError("");
          setCloudSyncState("synced");
        })
        .catch((error) => {
          setCloudSyncError(
            error instanceof Error ? error.message : "云端便签保存失败。",
          );
          setCloudSyncState("failed");
        });
    }, CLOUD_SAVE_DELAY_MS);
  }, [
    activeNoteId,
    authStatus,
    authUser,
    folders,
    noteDocuments,
  ]);

  useEffect(() => {
    if (!canUseCloudWorkspace(authUser)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (cloudSaveTimeoutRef.current !== null) {
        return;
      }

      void getCloudWorkspace()
        .then((cloud) => {
          if (
            cloud.workspace &&
            (cloud.updatedAt ?? 0) > cloudRevisionRef.current
          ) {
            cloudRevisionRef.current = cloud.updatedAt ?? 0;
            skipNextCloudSaveRef.current = true;
            replaceWorkspace(cloud.workspace);
            setCloudSyncError("");
            setCloudSyncState("synced");
          }
        })
        .catch((error) => {
          setCloudSyncError(
            error instanceof Error ? error.message : "跨端同步检查失败。",
          );
          setCloudSyncState("failed");
        });
    }, CLOUD_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authUser, replaceWorkspace]);

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      if (cloudSaveTimeoutRef.current !== null) {
        window.clearTimeout(cloudSaveTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    function handleLocationNavigation() {
      setNoteRouteNavigation((current) => ({
        revision: current.revision + 1,
        route: parseNoteRouteHash(window.location.hash),
      }));
    }

    window.addEventListener("hashchange", handleLocationNavigation);
    window.addEventListener("popstate", handleLocationNavigation);

    return () => {
      window.removeEventListener("hashchange", handleLocationNavigation);
      window.removeEventListener("popstate", handleLocationNavigation);
    };
  }, []);

  useEffect(() => {
    if (
      restoredNoteRouteRevisionRef.current === noteRouteNavigation.revision
    ) {
      return;
    }

    const route = noteRouteNavigation.route;

    if (!route) {
      restoredNoteRouteRevisionRef.current = noteRouteNavigation.revision;
      setMobileWorkspaceView("notes");
      return;
    }

    if (authStatus !== "ready") {
      return;
    }

    const routedNote = noteDocuments.find((note) => note.id === route.noteId);

    if (!routedNote) {
      restoredNoteRouteRevisionRef.current = noteRouteNavigation.revision;
      setActiveCategoryId("all");
      setMobileWorkspaceView("notes");
      writeCurrentNoteRoute(null);
      return;
    }

    const routedView: NoteRouteView = routedNote.deletedAt
      ? "preview"
      : route.view;

    restoredNoteRouteRevisionRef.current = noteRouteNavigation.revision;
    setAiReviewNoteId(null);
    setActiveCategoryId(routedNote.deletedAt ? "trash" : "all");
    selectNote(routedNote.id);
    setDesktopWorkspaceView(routedView);
    setMobileWorkspaceView(routedView);
    setIsDesktopViewMenuOpen(false);
    setIsDesktopSharePreview(false);
    setIsShareOpen(false);
    setIsNoteSidebarOpen(false);
    setIsCategorySidebarOpen(false);

    if (routedView !== route.view) {
      writeCurrentNoteRoute({ noteId: routedNote.id, view: routedView });
    }
  }, [
    authStatus,
    noteDocuments,
    noteRouteNavigation,
    selectNote,
  ]);

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
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme, selectedTheme]);

  useEffect(() => {
    persistFooterText(footerBrand, footerVia);
  }, [footerBrand, footerVia]);

  useEffect(() => {
    persistFooterLogoUrl(footerLogoUrl);
  }, [footerLogoUrl]);

  useEffect(() => {
    persistAiEnabled(aiEnabled);
  }, [aiEnabled]);

  useEffect(() => {
    if (aiReviewNoteId && aiReviewNoteId !== activeNoteId) {
      setAiReviewNoteId(null);
    }
  }, [activeNoteId, aiReviewNoteId]);

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
      if (isHermesSkillLinkResetConfirmationOpen) {
        return;
      }

      const target = event.target;

      const isInsideSettings =
        target instanceof Node &&
        [
          settingsContainerRef.current,
          desktopSettingsContainerRef.current,
          settingsPanelHostRef.current,
        ].some((container) => container?.contains(target));

      if (target instanceof Node && !isInsideSettings) {
        setIsSettingsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isHermesSkillLinkResetConfirmationOpen) {
          setIsHermesSkillLinkResetConfirmationOpen(false);
          return;
        }

        setIsSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHermesSkillLinkResetConfirmationOpen, isSettingsOpen]);

  useEffect(() => {
    if (!isAccountMenuOpen && !isLoginOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        isAccountMenuOpen &&
        target instanceof Node &&
        !accountContainerRef.current?.contains(target)
      ) {
        setIsAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
        setIsLoginOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen, isLoginOpen]);

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

  useEffect(() => {
    if (isPlaywrightRender) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        !window.matchMedia("(min-width: 641px)").matches
      ) {
        return;
      }

      const target = event.target;

      if (
        !isDesktopFocusMode &&
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"))
      ) {
        return;
      }

      const hasOpenOverlay =
        isSettingsOpen ||
        isAccountMenuOpen ||
        isLoginOpen ||
        isChangePasswordOpen ||
        isShareOpen ||
        isNoteSidebarOpen ||
        isDesktopViewMenuOpen ||
        isMoveDialogOpen ||
        isCategorySidebarOpen ||
        Boolean(aiReviewNoteId) ||
        Boolean(pendingAction);

      if (hasOpenOverlay) {
        return;
      }

      if (isDesktopSharePreview) {
        event.preventDefault();
        setIsDesktopSharePreview(false);
        setDesktopWorkspaceView(
          activeCategoryId === "trash" ? "preview" : "editor",
        );
        return;
      }

      if (
        desktopWorkspaceView === "preview" &&
        activeCategoryId !== "trash"
      ) {
        event.preventDefault();
        setDesktopWorkspaceView("editor");
        writeCurrentNoteRoute({ noteId: activeNoteId, view: "editor" });
        return;
      }

      if (isDesktopFocusMode) {
        event.preventDefault();
        setIsDesktopFocusMode(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeCategoryId,
    aiReviewNoteId,
    desktopWorkspaceView,
    isAccountMenuOpen,
    isCategorySidebarOpen,
    isChangePasswordOpen,
    isDesktopFocusMode,
    isDesktopSharePreview,
    isDesktopViewMenuOpen,
    isLoginOpen,
    isMoveDialogOpen,
    isNoteSidebarOpen,
    isPlaywrightRender,
    isSettingsOpen,
    isShareOpen,
    pendingAction,
  ]);

  async function handleUserAuthenticated(user: AuthUser) {
    setCloudSyncState("syncing");
    setCloudSyncError("");
    const anonymousWorkspace = getCurrentWorkspace();

    try {
      const cloud = await getCloudWorkspace();

      if (cloud.workspace) {
        skipNextCloudSaveRef.current = true;
        replaceWorkspace(cloud.workspace);
        cloudRevisionRef.current = cloud.updatedAt ?? 0;
      } else {
        const stored = await saveCloudWorkspace(anonymousWorkspace);
        cloudRevisionRef.current = stored.updatedAt ?? 0;
        skipNextCloudSaveRef.current = true;
      }

      cloudHydratedUserIdRef.current = user.id;
      setCloudSyncState("synced");
    } catch (error) {
      cloudHydratedUserIdRef.current = null;
      setCloudSyncState("failed");
      setCloudSyncError(
        error instanceof Error ? error.message : "云端便签加载失败。",
      );
    }

    setAuthUser(user);
    setAuthStatus("ready");
    setIsLoginOpen(false);
    setIsAccountMenuOpen(false);
  }

  async function handleLogout() {
    if (
      canUseCloudWorkspace(authUser) &&
      cloudHydratedUserIdRef.current === authUser.id
    ) {
      if (cloudSaveTimeoutRef.current !== null) {
        window.clearTimeout(cloudSaveTimeoutRef.current);
        cloudSaveTimeoutRef.current = null;
      }

      try {
        await saveCloudWorkspace(getCurrentWorkspace());
      } catch (error) {
        setCloudSyncError(
          error instanceof Error ? error.message : "退出前云端保存失败。",
        );
      }
    }

    await logoutUser();
    cloudHydratedUserIdRef.current = null;
    cloudRevisionRef.current = 0;
    setAuthUser(null);
    setAiReviewNoteId(null);
    setCloudSyncState("local");
    setIsAccountMenuOpen(false);
    replaceWorkspace(getInitialNoteWorkspace());
    setMobileWorkspaceView("notes");
    writeCurrentNoteRoute(null);
  }

  async function handleHermesSkillDownload() {
    if (isHermesSkillDownloading) {
      return;
    }

    try {
      setIsHermesSkillDownloading(true);
      await downloadHermesSkillPackage();
    } catch (error) {
      console.error("Hermes Skill download failed", error);
      window.alert(
        error instanceof Error
          ? error.message
          : "Hermes Skill 下载失败，请稍后重试。",
      );
    } finally {
      setIsHermesSkillDownloading(false);
    }
  }

  async function handleHermesSkillLinkCopy() {
    if (
      hermesSkillLinkActionState === "copying" ||
      hermesSkillLinkActionState === "resetting"
    ) {
      return;
    }

    try {
      setHermesSkillLinkActionState("copying");
      const { installUrl } = await getHermesSkillInstallLink();
      await copyTextToClipboard(buildHermesSkillInstallInstruction(installUrl));
      setHermesSkillLinkActionState("copied");
      window.setTimeout(() => {
        setHermesSkillLinkActionState((state) =>
          state === "copied" ? "idle" : state,
        );
      }, 2_400);
    } catch (error) {
      console.error("Hermes Skill install link copy failed", error);
      setHermesSkillLinkActionState("idle");
      window.alert(
        error instanceof Error
          ? error.message
          : "Hermes 安装指令复制失败，请稍后重试。",
      );
    }
  }

  async function handleHermesSkillLinkReset() {
    if (
      hermesSkillLinkActionState === "copying" ||
      hermesSkillLinkActionState === "resetting"
    ) {
      return;
    }

    setIsHermesSkillLinkResetConfirmationOpen(false);

    try {
      setHermesSkillLinkActionState("resetting");
      await resetHermesSkillInstallLink();
      setHermesSkillLinkActionState("reset");
      window.setTimeout(() => {
        setHermesSkillLinkActionState((state) =>
          state === "reset" ? "idle" : state,
        );
      }, 2_400);
    } catch (error) {
      console.error("Hermes Skill install link reset failed", error);
      setHermesSkillLinkActionState("idle");
      window.alert(
        error instanceof Error
          ? error.message
          : "Hermes 安装链接重置失败，请稍后重试。",
      );
    }
  }

  async function handleExport() {
    if (isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");
      await exportMarkdownAsPng(markdown, resolvedTheme, {
        footerBrand,
        footerLogoUrl,
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
        footerLogoUrl,
        footerVia,
      });
    } catch (error) {
      console.error("Archive download failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleWorkspaceArchiveExport() {
    if (isWorkspaceArchiveExporting) {
      return;
    }

    try {
      setIsWorkspaceArchiveExporting(true);
      setWorkspaceArchiveError("");
      setWorkspaceArchiveProgress({
        percent: 0,
        message: "正在提交整体导出任务",
        completedNotes: 0,
        totalNotes: noteDocuments.length,
      });
      await exportNoteWorkspaceArchive(
        getCurrentWorkspace(),
        setWorkspaceArchiveProgress,
      );
    } catch (error) {
      console.error("Workspace archive export failed", error);
      setWorkspaceArchiveError(getExportErrorMessage(error));
    } finally {
      setIsWorkspaceArchiveExporting(false);
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
      await copyMarkdownForWechat(markdown, {
        footerBrand,
        footerLogoUrl,
        footerVia,
      });
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
    setAiReviewNoteId(null);
    const folderId = getFolderIdFromCategory(activeCategoryId);
    const shouldStar = activeCategoryId === "starred";

    if (activeCategoryId === "trash") {
      setActiveCategoryId("all");
    }

    const createdNoteId = createNote("", folderId, shouldStar);
    mobileDraftNoteIdRef.current = createdNoteId;
    setDesktopWorkspaceView("editor");
    setMobileWorkspaceView("editor");
    setIsDesktopViewMenuOpen(false);
    setIsDesktopSharePreview(false);
    writeCurrentNoteRoute(
      { noteId: createdNoteId, view: "editor" },
      "push",
    );
  }

  function handleReturnToNoteList() {
    setIsSettingsOpen(false);
    setIsShareOpen(false);

    const draftNoteId = mobileDraftNoteIdRef.current;
    mobileDraftNoteIdRef.current = null;

    if (draftNoteId) {
      const preferredNextNoteId = orderNoteDocuments(
        categoryNoteDocuments.filter((note) => note.id !== draftNoteId),
      )[0]?.id;
      discardEmptyDraft(draftNoteId, preferredNextNoteId);
    }

    setMobileWorkspaceView("notes");
    writeCurrentNoteRoute(null);
  }

  function handleMobileWorkspaceViewChange(view: NoteRouteView) {
    setMobileWorkspaceView(view);

    if (activeNoteId) {
      writeCurrentNoteRoute({ noteId: activeNoteId, view });
    }
  }

  function handleDesktopWorkspaceViewChange(view: NoteRouteView) {
    setDesktopWorkspaceView(view);

    if (activeNoteId) {
      writeCurrentNoteRoute({ noteId: activeNoteId, view });
    }
  }

  function handleOpenAiReview() {
    if (!activeNoteId) {
      return;
    }

    if (document.activeElement instanceof HTMLTextAreaElement) {
      document.activeElement.blur();
    }

    setIsSettingsOpen(false);
    setIsShareOpen(false);
    setAiReviewNoteId(activeNoteId);
  }

  function handleAiReviewPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.pointerType !== "touch") {
      return;
    }

    event.preventDefault();
    handleOpenAiReview();
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
    const selectedNote = noteDocuments.find((note) => note.id === noteId);

    if (!selectedNote) {
      return;
    }

    const selectedView: NoteRouteView = selectedNote.deletedAt
      ? "preview"
      : "editor";

    setAiReviewNoteId(null);
    selectNote(noteId);
    setIsShareOpen(false);
    setIsNoteSidebarOpen(false);
    setIsCategorySidebarOpen(false);
    setDesktopWorkspaceView(selectedView);
    setMobileWorkspaceView(selectedView);
    setIsDesktopViewMenuOpen(false);
    setIsDesktopSharePreview(false);
    writeCurrentNoteRoute({ noteId, view: selectedView }, "push");
  }

  function handleSelectCategory(categoryId: NoteCategoryId) {
    setAiReviewNoteId(null);
    setActiveCategoryId(categoryId);
    setIsCategorySidebarOpen(false);
    setIsNoteSidebarOpen(false);
    setMobileWorkspaceView("notes");

    const [firstNote] = getCategoryNoteDocuments(noteDocuments, categoryId);

    if (firstNote) {
      selectNote(firstNote.id);
    }

    if (
      firstNote &&
      window.matchMedia("(min-width: 641px)").matches
    ) {
      const selectedView: NoteRouteView =
        firstNote.deletedAt === null ? "editor" : "preview";
      setDesktopWorkspaceView(selectedView);
      writeCurrentNoteRoute({ noteId: firstNote.id, view: selectedView });
      return;
    }

    writeCurrentNoteRoute(null);
  }

  function handleConfirmPendingAction() {
    const confirmedAction = pendingAction;
    confirmPendingAction();

    if (
      confirmedAction?.kind !== "delete-note" &&
      confirmedAction?.kind !== "permanently-delete-note"
    ) {
      return;
    }

    if (
      window.matchMedia("(max-width: 640px)").matches &&
      mobileWorkspaceView === "notes"
    ) {
      writeCurrentNoteRoute(null);
      return;
    }

    const nextState = useAppStore.getState();
    const nextActiveNote = getCategoryNoteDocuments(
      nextState.notes,
      activeCategoryId,
    ).find((note) => note.id === nextState.activeNoteId);

    if (!nextActiveNote) {
      setMobileWorkspaceView("notes");
      writeCurrentNoteRoute(null);
      return;
    }

    const nextView: NoteRouteView = nextActiveNote.deletedAt
      ? "preview"
      : window.matchMedia("(max-width: 640px)").matches
        ? mobileWorkspaceView === "preview"
          ? "preview"
          : "editor"
        : desktopWorkspaceView;

    writeCurrentNoteRoute({ noteId: nextActiveNote.id, view: nextView });
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

  function handleSettingsToggle() {
    setIsCategorySidebarOpen(false);
    setIsShareOpen(false);
    setIsAccountMenuOpen(false);
    setIsSettingsOpen((isOpen) => !isOpen);
  }

  const desktopAccountEntry = (
    <div className="app-account" ref={accountContainerRef}>
      <button
        type="button"
        className="auth-trigger"
        disabled={authStatus === "loading"}
        aria-haspopup={authUser ? "menu" : "dialog"}
        aria-expanded={authUser ? isAccountMenuOpen : isLoginOpen}
        aria-label={
          authStatus === "loading"
            ? "正在检查登录状态"
            : authUser
              ? `账号：${authUser.username}`
              : "登录账号"
        }
        title={
          authUser
            ? `${authUser.username} · 点击查看账号菜单`
            : "登录账号"
        }
        onClick={() => {
          setIsSettingsOpen(false);
          setIsShareOpen(false);

          if (authUser) {
            setIsAccountMenuOpen((isOpen) => !isOpen);
          } else {
            setIsLoginOpen(true);
          }
        }}
      >
        <span className="auth-trigger-dot" aria-hidden="true" />
        <span className="auth-trigger-label">
          {authStatus === "loading"
            ? "检查登录..."
            : authUser?.username ?? "登录锤子便签"}
        </span>
      </button>

      {authUser && isAccountMenuOpen ? (
        <div className="account-menu" role="menu">
          <div className="account-menu-summary">
            <strong title={authUser.username}>{authUser.username}</strong>
            <span>
              {authUser.role === "superadmin" ? "管理员 · " : ""}
              {cloudSyncState === "syncing"
                ? "正在同步云端..."
                : cloudSyncState === "failed"
                  ? "云端同步异常"
                  : "云端已同步"}
            </span>
          </div>
          {cloudSyncError ? <p role="alert">{cloudSyncError}</p> : null}
          {authUser.role === "superadmin" ? (
            <a
              className="account-menu-item"
              href="/superadmin"
              role="menuitem"
            >
              进入管理后台
            </a>
          ) : null}
          {authUser.role === "user" ? (
            <button
              type="button"
              className="account-menu-item"
              role="menuitem"
              onClick={() => {
                setIsAccountMenuOpen(false);
                setIsChangePasswordOpen(true);
              }}
            >
              修改密码
            </button>
          ) : null}
          <button
            type="button"
            className="account-menu-item account-menu-logout"
            role="menuitem"
            onClick={() => void handleLogout()}
          >
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );

  const desktopSidebarFooter = (
    <div className="desktop-sidebar-footer">
      {desktopAccountEntry}
    </div>
  );

  const settingsPanel = isSettingsOpen ? (
    <SettingsPanel
      aiAvailable={aiAvailable}
      aiEnabled={aiEnabled}
      authUsername={authUser?.username}
      canChangePassword={authUser?.role === "user"}
      cloudStatusLabel={
        canUseCloudWorkspace(authUser)
          ? cloudSyncState === "syncing"
            ? "正在同步云端"
            : cloudSyncState === "failed"
              ? "云端同步异常"
              : authUser.role === "superadmin"
                ? "管理员便签已保存到云端"
                : "便签已保存到云端"
          : "数据仅保存在当前浏览器"
      }
      footerBrand={footerBrand}
      footerLogoUrl={footerLogoUrl}
      footerVia={footerVia}
      hermesSkillLinkActionState={hermesSkillLinkActionState}
      isHermesSkillDownloading={isHermesSkillDownloading}
      isWorkspaceArchiveExporting={isWorkspaceArchiveExporting}
      selectedTheme={selectedTheme}
      workspaceArchiveError={workspaceArchiveError}
      workspaceArchiveProgress={workspaceArchiveProgress}
      onAiEnabledChange={setAiEnabled}
      onChangePassword={() => {
        setIsSettingsOpen(false);
        setIsChangePasswordOpen(true);
      }}
      onClose={() => setIsSettingsOpen(false)}
      onLogin={() => {
        setIsSettingsOpen(false);
        setIsLoginOpen(true);
      }}
      onLogout={() => {
        setIsSettingsOpen(false);
        void handleLogout();
      }}
      onFooterBrandChange={setFooterBrand}
      onFooterLogoChange={setFooterLogoUrl}
      onFooterViaChange={setFooterVia}
      onHermesSkillDownload={() => void handleHermesSkillDownload()}
      onHermesSkillLinkCopy={() => void handleHermesSkillLinkCopy()}
      onHermesSkillLinkReset={() =>
        setIsHermesSkillLinkResetConfirmationOpen(true)
      }
      onThemeChange={setSelectedTheme}
      onWorkspaceArchiveExport={() => void handleWorkspaceArchiveExport()}
    />
  ) : null;

  return (
    <>
      <div
        className="app-layout"
        data-theme={resolvedTheme}
        data-theme-preference={selectedTheme}
        data-authenticated={authUser ? "true" : "false"}
        data-render-mode={isPlaywrightRender ? "playwright" : undefined}
        data-desktop-view={desktopWorkspaceView}
        data-desktop-category-collapsed={
          isDesktopCategoryCollapsed ? "true" : "false"
        }
        data-desktop-focus={isDesktopFocusMode ? "true" : "false"}
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
              onClick={handleReturnToNoteList}
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
              <button
                ref={desktopSettingsContainerRef}
                type="button"
                className="desktop-brand-settings-trigger"
                aria-label={isSettingsOpen ? "关闭设置" : "打开设置"}
                aria-controls="app-settings-panel"
                aria-expanded={isSettingsOpen}
                title="设置"
                onClick={handleSettingsToggle}
              >
                <span className="app-brand-mark" aria-hidden="true">
                  <img src="/header/logo.png" alt="" />
                </span>
              </button>
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
                  onClick={() => handleMobileWorkspaceViewChange("preview")}
                >
                  <span className="smartisan-toolbar-icon icon-create" aria-hidden="true" />
                </button>

                <div className="desktop-note-actions">
                  {aiAvailable &&
                  aiEnabled &&
                  authUser &&
                  activeCategoryNote &&
                  activeCategoryId !== "trash" ? (
                    <button
                      type="button"
                      className="ai-review-trigger"
                      aria-label="使用 AI 审阅当前便签"
                      title="AI 辅助审阅"
                      onClick={handleOpenAiReview}
                      onPointerDown={handleAiReviewPointerDown}
                    >
                      AI
                    </button>
                  ) : null}
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
                  onClick={handleSettingsToggle}
                >
                  <img
                    src="/smartisan/mobile/btn_settings.png"
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="app-shell">
          <CategorySidebar
            activeCategoryId={activeCategoryId}
            desktopFooter={desktopSidebarFooter}
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
            onDeleteNote={requestDeleteNote}
            onPermanentlyDeleteNote={requestPermanentlyDeleteNote}
            onReorderNotes={reorderNotes}
            onRestoreNote={restoreNote}
            onSearchQueryChange={setSearchQuery}
            onSelectNote={handleSelectNote}
            onTogglePinned={togglePinned}
            onToggleStarred={toggleStarred}
            isDesktopCategoryCollapsed={isDesktopCategoryCollapsed}
            onToggleDesktopCategory={() => {
              setIsSettingsOpen(false);
              setIsDesktopCategoryCollapsed((isCollapsed) => !isCollapsed);
            }}
          />

          <button
            type="button"
            className={`note-sidebar-backdrop${isNoteSidebarOpen ? " is-visible" : ""}`}
            aria-label="关闭便签导航"
            tabIndex={isNoteSidebarOpen ? 0 : -1}
            onClick={() => setIsNoteSidebarOpen(false)}
          />

          <div className="desktop-workspace-toolbar" aria-label="桌面便签工作区状态">
            <button
              type="button"
              className="desktop-focus-exit"
              aria-label="退出专注编辑"
              title="退出专注编辑"
              onClick={() => setIsDesktopFocusMode(false)}
            >
              <span className="desktop-focus-back-icon" aria-hidden="true" />
            </button>

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
                        handleDesktopWorkspaceViewChange(view);
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
                <span className="desktop-note-folder-icon" aria-hidden="true" />
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
                <span className="desktop-note-folder-arrow" aria-hidden="true" />
              </label>
              <span aria-hidden="true">|</span>
              <span>{formatMobileNoteUpdatedAt(activeCategoryNote?.updatedAt)}</span>
              <span aria-hidden="true">|</span>
              <span>{mobileNoteCharacterCount} 字</span>
              <span aria-hidden="true">|</span>
              <button
                type="button"
                className="desktop-focus-toggle"
                aria-label={
                  isDesktopFocusMode ? "退出专注编辑" : "进入专注编辑"
                }
                aria-pressed={isDesktopFocusMode}
                title={isDesktopFocusMode ? "退出专注编辑" : "进入专注编辑"}
                onClick={() => {
                  setIsDesktopFocusMode((isFocused) => {
                    if (!isFocused) {
                      handleDesktopWorkspaceViewChange("editor");
                      setIsDesktopViewMenuOpen(false);
                      setIsCategorySidebarOpen(false);
                      setIsNoteSidebarOpen(false);
                    }

                    return !isFocused;
                  });
                }}
              >
                <span className="desktop-focus-toggle-icon" aria-hidden="true" />
              </button>
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
                handleMobileWorkspaceViewChange(
                  mobileWorkspaceView === "preview" ? "editor" : "preview",
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
            footerLogoUrl={footerLogoUrl}
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

        <div className="settings-panel-host" ref={settingsPanelHostRef}>
          {settingsPanel}
          <ConfirmDialog
            pendingAction={
              isHermesSkillLinkResetConfirmationOpen
                ? HERMES_SKILL_LINK_RESET_CONFIRMATION
                : null
            }
            onClose={() => setIsHermesSkillLinkResetConfirmationOpen(false)}
            onConfirm={() => void handleHermesSkillLinkReset()}
          />
        </div>

        {aiReviewNoteId === activeNoteId && activeNote ? (
          <AiReviewDialog
            key={aiReviewNoteId}
            currentMarkdown={markdown}
            currentNoteId={aiReviewNoteId}
            onClose={() => setAiReviewNoteId(null)}
            onMarkdownChange={setMarkdown}
          />
        ) : null}
      </div>

      {isLoginOpen ? (
        <LoginDialog
          login={loginUser}
          onAuthenticated={handleUserAuthenticated}
          onClose={() => setIsLoginOpen(false)}
        />
      ) : null}

      {isChangePasswordOpen ? (
        <ChangePasswordDialog
          changePassword={changeUserPassword}
          onClose={() => setIsChangePasswordOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        pendingAction={pendingAction}
        onClose={clearPendingAction}
        onConfirm={handleConfirmPendingAction}
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
