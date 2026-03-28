import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { importImageFile, importImageUrl } from "../lib/images";
import type { CopyState, ThemeId } from "../types/app";
import { ThemeSelector } from "./ThemeSelector";

interface EditorPanelProps {
  markdown: string;
  selectedTheme: ThemeId;
  copyState: CopyState;
  onThemeChange: (themeId: ThemeId) => void;
  onLoadExample: () => void;
  onClearMarkdown: () => void;
  onCopyMarkdown: () => void;
  onMarkdownChange: (markdown: string) => void;
}

function CopyActionIcon({ copyState }: { copyState: CopyState }) {
  if (copyState === "copied") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M6.75 12.5 10.2 16l7.05-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (copyState === "failed") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 7.25v5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.15"
          strokeLinecap="round"
        />
        <circle cx="12" cy="16.75" r="1.15" fill="currentColor" />
        <path
          d="M10.1 3.9a2.2 2.2 0 0 1 3.8 0l6.2 10.9A2.2 2.2 0 0 1 18.2 18H5.8a2.2 2.2 0 0 1-1.9-3.2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="9"
        y="7"
        width="9"
        height="11"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M7 15.2H6.2A2.2 2.2 0 0 1 4 13V6.2A2.2 2.2 0 0 1 6.2 4h6.6A2.2 2.2 0 0 1 15 6.2V7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.25 10.25h4.5M11.25 13h4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function getCopyButtonLabel(copyState: CopyState): string {
  if (copyState === "copied") {
    return "已复制 Markdown";
  }

  if (copyState === "failed") {
    return "复制 Markdown 失败";
  }

  return "复制 Markdown";
}

function getCopyButtonTitle(copyState: CopyState): string {
  if (copyState === "copied") {
    return "已复制 Markdown";
  }

  if (copyState === "failed") {
    return "复制失败，请重试";
  }

  return "复制 Markdown";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function findImageUrlFromHtml(html: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const image = doc.querySelector("img");
  const src = image?.getAttribute("src")?.trim();

  if (!src || !isHttpUrl(src)) {
    return null;
  }

  return src;
}

function extractImageFile(files: FileList | File[]): File | null {
  for (const file of Array.from(files)) {
    if (file.type.startsWith("image/")) {
      return file;
    }
  }

  return null;
}

export function EditorPanel({
  markdown,
  selectedTheme,
  copyState,
  onThemeChange,
  onLoadExample,
  onClearMarkdown,
  onCopyMarkdown,
  onMarkdownChange,
}: EditorPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [imageImportError, setImageImportError] = useState("");
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);

  function insertImageMarkdown(imageUrl: string): void {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? markdown.length;
    const selectionEnd = textarea?.selectionEnd ?? markdown.length;
    const before = markdown.slice(0, selectionStart);
    const after = markdown.slice(selectionEnd);
    const imageMarkdown = `![图片](${imageUrl})`;
    const leadingBreak = before && !before.endsWith("\n") ? "\n" : "";
    const trailingBreak = after && !after.startsWith("\n") ? "\n" : "";
    const inserted = `${leadingBreak}${imageMarkdown}${trailingBreak}`;
    const nextMarkdown = `${before}${inserted}${after}`;
    const nextCursorPosition = before.length + inserted.length;

    onMarkdownChange(nextMarkdown);
    setImageImportError("");

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  async function handleImportedSource(source: File | string): Promise<void> {
    try {
      setIsImportingImage(true);
      setImageImportError("");
      const result =
        typeof source === "string"
          ? await importImageUrl(source)
          : await importImageFile(source);
      insertImageMarkdown(result.url);
    } catch (error) {
      console.error("Image import failed", error);
      setImageImportError(
        error instanceof Error ? error.message : "图片导入失败，请稍后重试。",
      );
    } finally {
      setIsImportingImage(false);
    }
  }

  function pickUrlFromTransfer(html: string, text: string): string | null {
    const htmlUrl = html ? findImageUrlFromHtml(html) : null;

    if (htmlUrl) {
      return htmlUrl;
    }

    const trimmedText = text.trim();
    return isHttpUrl(trimmedText) ? trimmedText : null;
  }

  async function importFromClipboard(event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const fileFromItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .find((file): file is File => Boolean(file?.type.startsWith("image/")));

    if (fileFromItems) {
      event.preventDefault();
      await handleImportedSource(fileFromItems);
      return;
    }

    const clipboardUrl = pickUrlFromTransfer(
      event.clipboardData.getData("text/html"),
      event.clipboardData.getData("text/plain"),
    );

    if (!clipboardUrl) {
      return;
    }

    event.preventDefault();
    await handleImportedSource(clipboardUrl);
  }

  async function importFromDrop(event: DragEvent<HTMLTextAreaElement>): Promise<void> {
    const imageFile = extractImageFile(event.dataTransfer.files);

    if (imageFile) {
      await handleImportedSource(imageFile);
      return;
    }

    const droppedUrl = pickUrlFromTransfer(
      event.dataTransfer.getData("text/html"),
      event.dataTransfer.getData("text/uri-list") ||
        event.dataTransfer.getData("text/plain"),
    );

    if (droppedUrl) {
      await handleImportedSource(droppedUrl);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLTextAreaElement>): void {
    event.preventDefault();
    setIsDropTargetActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLTextAreaElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTargetActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLTextAreaElement>): void {
    event.preventDefault();

    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setIsDropTargetActive(false);
  }

  return (
    <aside className="editor-panel">
      <div className="panel-header">
        <ThemeSelector value={selectedTheme} onChange={onThemeChange} />

        <div className="toolbar">
          <button type="button" onClick={onLoadExample}>
            加载示例
          </button>
          <button type="button" onClick={onClearMarkdown}>
            清空重写
          </button>
          <button
            type="button"
            className={`toolbar-icon-button${copyState === "copied" ? " copied" : ""}${copyState === "failed" ? " failed" : ""}`}
            aria-label={getCopyButtonLabel(copyState)}
            title={getCopyButtonTitle(copyState)}
            onClick={onCopyMarkdown}
          >
            <CopyActionIcon copyState={copyState} />
          </button>
        </div>
      </div>

      {imageImportError ? <p className="image-import-status error">{imageImportError}</p> : null}
      {isImportingImage ? <p className="image-import-status">正在导入图片...</p> : null}
      <div
        className={`markdown-editor-frame${isDropTargetActive ? " drag-active" : ""}`}
      >
        {isDropTargetActive ? (
          <div className="markdown-drop-indicator">松手即可导入图片</div>
        ) : null}
        <textarea
          id="markdown-editor"
          ref={textareaRef}
          className="markdown-editor"
          value={markdown}
          onChange={(event) => onMarkdownChange(event.target.value)}
          onPaste={(event) => {
            void importFromClipboard(event);
          }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => {
            event.preventDefault();
            setIsDropTargetActive(false);
            void importFromDrop(event);
          }}
          spellCheck={false}
        />
      </div>
    </aside>
  );
}
