import { useEffect } from "react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EditorPanel } from "./components/EditorPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import {
  DRAFT_STORAGE_KEY,
  FALLBACK_CONTENT,
  getRenderMode,
  SAMPLE_MARKDOWN_CONTENT,
  THEME_STORAGE_KEY,
} from "./lib/app-state";
import { copyTextToClipboard } from "./lib/clipboard";
import { exportMarkdownAsPng, getExportErrorMessage } from "./lib/export";
import { splitSections } from "./lib/markdown";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const renderMode = getRenderMode();
  const isPlaywrightRender = renderMode === "playwright";
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

  async function handleExport() {
    if (isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");
      await exportMarkdownAsPng(markdown, selectedTheme);
    } catch (error) {
      console.error("PNG export failed", error);
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCopyMarkdown() {
    try {
      await copyTextToClipboard(markdown);
      setCopyState("copied");
    } catch (error) {
      console.error("Markdown copy failed", error);
      setCopyState("failed");
    }
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
                {isExporting ? "导出中..." : "保存图片"}
              </button>
            </div>
          </div>
        </header>

        <div className="app-shell">
          <EditorPanel
            markdown={markdown}
            selectedTheme={selectedTheme}
            copyState={copyState}
            onThemeChange={setSelectedTheme}
            onLoadExample={() =>
              requestReplaceMarkdown(
                SAMPLE_MARKDOWN_CONTENT,
                "加载示例？",
                "这会覆盖你当前正在编辑的草稿内容。",
              )
            }
            onClearMarkdown={() =>
              requestReplaceMarkdown(
                FALLBACK_CONTENT,
                "清空重写？",
                "这会清空当前草稿，建议确认后再继续。",
              )
            }
            onCopyMarkdown={handleCopyMarkdown}
            onMarkdownChange={setMarkdown}
          />

          <PreviewPanel
            notes={notes}
            exportError={exportError}
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
