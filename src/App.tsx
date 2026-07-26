import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorPanel, type EditorPanelHandle } from "./components/EditorPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  DRAFT_STORAGE_KEY,
  FALLBACK_CONTENT,
  getInitialFooterBrand,
  getInitialFooterVia,
  getRenderMode,
  SAMPLE_MARKDOWN_CONTENT,
  THEME_STORAGE_KEY,
} from "./lib/app-state";
import { copyTextToClipboard, normalizeClipboardMarkdown } from "./lib/clipboard";
import { exportMarkdownArchive, exportMarkdownAsPng, getExportErrorMessage } from "./lib/export";
import { splitSections } from "./lib/markdown";
import { useAppStore } from "./store/useAppStore";
import type { CopyState } from "./types/app";

function getCopyButtonText(copyState: CopyState): string {
  if (copyState === "copied") {
    return "已复制文本";
  }

  if (copyState === "failed") {
    return "复制失败";
  }

  return "复制文本";
}

export default function App() {
  const renderMode = getRenderMode();
  const isPlaywrightRender = renderMode === "playwright";
  const [footerBrand, setFooterBrand] = useState(getInitialFooterBrand);
  const [footerVia, setFooterVia] = useState(getInitialFooterVia);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const editorPanelRef = useRef<EditorPanelHandle | null>(null);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const markdown = useAppStore((state) => state.markdown);
  const selectedTheme = useAppStore((state) => state.selectedTheme);
  const isExporting = useAppStore((state) => state.isExporting);
  const exportError = useAppStore((state) => state.exportError);
  const copyState = useAppStore((state) => state.copyState);
  const pendingAction = useAppStore((state) => state.pendingAction);
  const setMarkdown = useAppStore((state) => state.setMarkdown);
  const setSelectedTheme = useAppStore((state) => state.setSelectedTheme);
  const setIsExporting = useAppStore((state) => state.setIsExporting);
  const setExportError = useAppStore((state) => state.setExportError);
  const setCopyState = useAppStore((state) => state.setCopyState);
  const requestReplaceMarkdown = useAppStore((state) => state.requestReplaceMarkdown);
  const clearPendingAction = useAppStore((state) => state.clearPendingAction);
  const confirmReplaceMarkdown = useAppStore((state) => state.confirmReplaceMarkdown);

  const notes = splitSections(markdown);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(DRAFT_STORAGE_KEY, markdown);
  }, [markdown]);

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

  function handleClearMarkdown() {
    setIsSettingsOpen(false);
    requestReplaceMarkdown(
      FALLBACK_CONTENT,
      "清空重写？",
      "这会清空当前草稿，建议确认后再继续。",
    );
  }

  function handleLoadExample() {
    setIsSettingsOpen(false);
    requestReplaceMarkdown(
      SAMPLE_MARKDOWN_CONTENT,
      "加载示例？",
      "这会覆盖你当前正在编辑的草稿内容。",
    );
  }

  function handleInsertImage() {
    setIsSettingsOpen(false);
    editorPanelRef.current?.openImagePicker();
  }

  return (
    <>
      <div
        className="app-layout"
        data-theme={selectedTheme}
        data-render-mode={isPlaywrightRender ? "playwright" : undefined}
      >
        <header className="app-topbar">
          <div className="app-topbar-inner">
            <div className="app-brand">
              <div className="app-brand-mark" aria-hidden="true">
                <img src="/header/logo.png" alt="" />
              </div>
              <div className="app-brand-copy">
                <span className="app-brand-title">锤子便签Skill</span>
              </div>
            </div>

            <div className="app-topbar-actions">
              <button type="button" className="primary preview-export" onClick={handleExport}>
                {isExporting ? "导出中..." : "存图"}
              </button>
              <div className="app-settings" ref={settingsContainerRef}>
                <button
                  type="button"
                  className="settings-trigger"
                  aria-label={isSettingsOpen ? "关闭设置" : "打开设置"}
                  aria-controls="app-settings-panel"
                  aria-expanded={isSettingsOpen}
                  title="设置"
                  onClick={() => setIsSettingsOpen((isOpen) => !isOpen)}
                >
                  <span aria-hidden="true">⚙</span>
                </button>

                {isSettingsOpen ? (
                  <SettingsPanel
                    copyButtonText={getCopyButtonText(copyState)}
                    isArchiving={isArchiving}
                    isImportingImage={isImportingImage}
                    selectedTheme={selectedTheme}
                    onArchiveDownload={() => {
                      void handleArchiveDownload();
                    }}
                    onClearMarkdown={handleClearMarkdown}
                    onClose={() => setIsSettingsOpen(false)}
                    onCopyMarkdown={() => {
                      void handleCopyMarkdown();
                    }}
                    onInsertImage={handleInsertImage}
                    onLoadExample={handleLoadExample}
                    onThemeChange={setSelectedTheme}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className="app-shell">
          <EditorPanel
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
        </div>
      </div>

      <ConfirmDialog
        pendingAction={pendingAction}
        onClose={clearPendingAction}
        onConfirm={confirmReplaceMarkdown}
      />
    </>
  );
}
