import {
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { importImageFile, importImageUrl } from "../lib/images";
import {
  applyMarkdownShortcut,
  continueMarkdownBlock,
  type MarkdownEditResult,
  type MarkdownShortcut,
} from "../lib/markdown-shortcuts";

interface EditorPanelProps {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  onImageImportingChange: (isImporting: boolean) => void;
}

export interface EditorPanelHandle {
  openImagePicker: () => void;
}

const MARKDOWN_SHORTCUTS: Array<{
  action: MarkdownShortcut;
  label: string;
  accessibleLabel: string;
}> = [
  { action: "title", label: "# Title", accessibleLabel: "切换当前行标题级别" },
  { action: "center", label: "[Center]", accessibleLabel: "居中当前行" },
  { action: "list", label: "- List", accessibleLabel: "将当前行设为列表" },
  {
    action: "bold",
    label: "**Bold**",
    accessibleLabel: "插入加粗标记或加粗所选文字",
  },
  { action: "quote", label: "> Quote", accessibleLabel: "将当前行设为引用" },
];

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

export const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(function EditorPanel(
  {
    markdown,
    onMarkdownChange,
    onImageImportingChange,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const caretMirrorTextRef = useRef<HTMLSpanElement | null>(null);
  const caretMirrorAnchorRef = useRef<HTMLSpanElement | null>(null);
  const customCaretRef = useRef<HTMLSpanElement | null>(null);
  const selectionStartHandleRef = useRef<HTMLSpanElement | null>(null);
  const selectionEndHandleRef = useRef<HTMLSpanElement | null>(null);
  const caretSyncFrameRef = useRef<number | null>(null);
  const keyboardBaselineHeightRef = useRef<number | null>(null);
  const selectionRef = useRef({
    start: markdown.length,
    end: markdown.length,
  });
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [imageImportError, setImageImportError] = useState("");
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [isQuickInputVisible, setIsQuickInputVisible] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      openImagePicker: () => {
        imageInputRef.current?.click();
      },
    }),
    [],
  );

  const hideCustomCaret = useCallback((): void => {
    customCaretRef.current?.classList.remove("is-visible");
  }, []);

  const hideSelectionHandles = useCallback((): void => {
    selectionStartHandleRef.current?.classList.remove("is-visible");
    selectionEndHandleRef.current?.classList.remove("is-visible");
  }, []);

  const hideEditorIndicators = useCallback((): void => {
    hideCustomCaret();
    hideSelectionHandles();
  }, [hideCustomCaret, hideSelectionHandles]);

  const updateCustomCaret = useCallback((): void => {
    caretSyncFrameRef.current = null;

    const textarea = textareaRef.current;
    const mirrorText = caretMirrorTextRef.current;
    const mirrorAnchor = caretMirrorAnchorRef.current;
    const customCaret = customCaretRef.current;
    const selectionStartHandle = selectionStartHandleRef.current;
    const selectionEndHandle = selectionEndHandleRef.current;

    if (textarea) {
      textarea.parentElement?.style.setProperty(
        "--editor-paper-scroll-y",
        `${-textarea.scrollTop}px`,
      );
    }

    if (
      !textarea ||
      !mirrorText ||
      !mirrorAnchor ||
      !customCaret ||
      !selectionStartHandle ||
      !selectionEndHandle ||
      !window.matchMedia("(max-width: 640px)").matches ||
      document.activeElement !== textarea
    ) {
      hideEditorIndicators();
      return;
    }

    const measureAnchorAt = (offset: number): { left: number; top: number; height: number } => {
      mirrorText.textContent = textarea.value.slice(0, offset);

      return {
        left: mirrorAnchor.offsetLeft - textarea.scrollLeft,
        top: mirrorAnchor.offsetTop - textarea.scrollTop,
        height: mirrorAnchor.offsetHeight,
      };
    };

    const positionSelectionHandle = (
      handle: HTMLSpanElement,
      anchor: { left: number; top: number; height: number },
    ): void => {
      const handleStyle = window.getComputedStyle(handle);
      const handleWidth = Number.parseFloat(handleStyle.width) || 2;
      const handleHeight =
        Number.parseFloat(handleStyle.height) ||
        anchor.height ||
        Number.parseFloat(window.getComputedStyle(textarea).lineHeight) ||
        42;

      if (
        anchor.left < 0 ||
        anchor.left > textarea.clientWidth ||
        anchor.top + handleHeight < 0 ||
        anchor.top > textarea.clientHeight
      ) {
        handle.classList.remove("is-visible");
        return;
      }

      handle.style.transform =
        `translate3d(${anchor.left - handleWidth / 2}px, ${anchor.top}px, 0)`;
      handle.classList.add("is-visible");
    };

    if (textarea.selectionStart !== textarea.selectionEnd) {
      hideCustomCaret();
      positionSelectionHandle(
        selectionStartHandle,
        measureAnchorAt(textarea.selectionStart),
      );
      positionSelectionHandle(
        selectionEndHandle,
        measureAnchorAt(textarea.selectionEnd),
      );
      return;
    }

    hideSelectionHandles();

    const caretStyle = window.getComputedStyle(customCaret);
    const caretHeight = Number.parseFloat(caretStyle.height) || 22;
    const caretAnchor = measureAnchorAt(textarea.selectionStart);
    const anchorHeight = caretAnchor.height || caretHeight;
    const top = caretAnchor.top + Math.max(0, (anchorHeight - caretHeight) / 2);

    if (
      caretAnchor.left < 0 ||
      caretAnchor.left > textarea.clientWidth ||
      top + caretHeight < 0 ||
      top > textarea.clientHeight
    ) {
      hideCustomCaret();
      return;
    }

    customCaret.classList.add("is-visible");
    customCaret.style.transform =
      `translate3d(${caretAnchor.left}px, ${top}px, 0)`;
  }, [hideCustomCaret, hideEditorIndicators, hideSelectionHandles]);

  const scheduleCustomCaretSync = useCallback((): void => {
    if (caretSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(caretSyncFrameRef.current);
    }

    caretSyncFrameRef.current = window.requestAnimationFrame(updateCustomCaret);
  }, [updateCustomCaret]);

  useEffect(() => {
    scheduleCustomCaretSync();
  }, [markdown, scheduleCustomCaretSync]);

  useEffect(() => {
    window.addEventListener("resize", scheduleCustomCaretSync);

    return () => {
      window.removeEventListener("resize", scheduleCustomCaretSync);

      if (caretSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(caretSyncFrameRef.current);
      }
    };
  }, [scheduleCustomCaretSync]);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 640px)");
    const viewport = window.visualViewport;

    const getViewportHeight = (): number =>
      Math.max(1, viewport?.height ?? window.innerHeight);

    const syncQuickInputVisibility = (): void => {
      if (!mobileQuery.matches) {
        keyboardBaselineHeightRef.current = null;
        setIsQuickInputVisible(false);
        return;
      }

      const textarea = textareaRef.current;
      const viewportHeight = getViewportHeight();
      const isEditorFocused = document.activeElement === textarea;

      if (!isEditorFocused) {
        keyboardBaselineHeightRef.current = viewportHeight;
        setIsQuickInputVisible(false);
        return;
      }

      const baselineHeight = Math.max(
        keyboardBaselineHeightRef.current ?? viewportHeight,
        viewportHeight,
      );
      keyboardBaselineHeightRef.current = baselineHeight;

      if (baselineHeight - viewportHeight > 80) {
        setIsQuickInputVisible(true);
        return;
      }

      setIsQuickInputVisible(false);
    };

    keyboardBaselineHeightRef.current = getViewportHeight();
    mobileQuery.addEventListener("change", syncQuickInputVisibility);
    viewport?.addEventListener("resize", syncQuickInputVisibility);
    window.addEventListener("resize", syncQuickInputVisibility);
    window.addEventListener("orientationchange", syncQuickInputVisibility);

    return () => {
      mobileQuery.removeEventListener("change", syncQuickInputVisibility);
      viewport?.removeEventListener("resize", syncQuickInputVisibility);
      window.removeEventListener("resize", syncQuickInputVisibility);
      window.removeEventListener("orientationchange", syncQuickInputVisibility);
    };
  }, []);

  function syncSelection(): void {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    selectionRef.current = {
      start: textarea.selectionStart ?? markdown.length,
      end: textarea.selectionEnd ?? markdown.length,
    };
    scheduleCustomCaretSync();
  }

  useEffect(() => {
    const syncNativeSelectionChange = (): void => {
      const textarea = textareaRef.current;

      if (!textarea || document.activeElement !== textarea) {
        return;
      }

      selectionRef.current = {
        start: textarea.selectionStart ?? textarea.value.length,
        end: textarea.selectionEnd ?? textarea.value.length,
      };
      hideEditorIndicators();
      scheduleCustomCaretSync();
    };

    document.addEventListener("selectionchange", syncNativeSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", syncNativeSelectionChange);
    };
  }, [hideEditorIndicators, scheduleCustomCaretSync]);

  function commitMarkdownEdit(edit: MarkdownEditResult): void {
    const textarea = textareaRef.current;

    if (edit.markdown !== markdown) {
      onMarkdownChange(edit.markdown);
    }

    selectionRef.current = {
      start: edit.selectionStart,
      end: edit.selectionEnd,
    };

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      scheduleCustomCaretSync();
    });
  }

  function handleMarkdownShortcut(shortcut: MarkdownShortcut): void {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? selectionRef.current.start;
    const selectionEnd = textarea?.selectionEnd ?? selectionRef.current.end;

    commitMarkdownEdit(
      applyMarkdownShortcut(markdown, selectionStart, selectionEnd, shortcut),
    );
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    const edit = continueMarkdownBlock(
      markdown,
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd,
    );

    if (!edit) {
      return;
    }

    event.preventDefault();
    commitMarkdownEdit(edit);
  }

  function insertImageMarkdown(imageUrl: string): void {
    const textarea = textareaRef.current;
    const hasFocus = typeof document !== "undefined" && document.activeElement === textarea;
    const selectionStart = hasFocus
      ? (textarea?.selectionStart ?? markdown.length)
      : selectionRef.current.start;
    const selectionEnd = hasFocus
      ? (textarea?.selectionEnd ?? markdown.length)
      : selectionRef.current.end;
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
    selectionRef.current = {
      start: nextCursorPosition,
      end: nextCursorPosition,
    };

    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  async function handleImportedSource(source: File | string): Promise<void> {
    try {
      setIsImportingImage(true);
      onImageImportingChange(true);
      setImageImportError("");
      const result =
        typeof source === "string"
          ? await importImageUrl(source)
          : await importImageFile(source);
      insertImageMarkdown(result.path || result.url);
    } catch (error) {
      console.error("Image import failed", error);
      setImageImportError(
        error instanceof Error ? error.message : "图片导入失败，请稍后重试。",
      );
    } finally {
      setIsImportingImage(false);
      onImageImportingChange(false);
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

  async function handleImageInputChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    await handleImportedSource(file);
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
      {imageImportError ? <p className="image-import-status error">{imageImportError}</p> : null}
      {isImportingImage ? <p className="image-import-status">正在导入图片...</p> : null}
      <div
        className={`markdown-editor-frame${isDropTargetActive ? " drag-active" : ""}`}
      >
        {isDropTargetActive ? (
          <div className="markdown-drop-indicator">松手即可导入图片</div>
        ) : null}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void handleImageInputChange(event);
          }}
        />
        <textarea
          id="markdown-editor"
          name="note-content"
          ref={textareaRef}
          className="markdown-editor"
          aria-label="便签正文"
          aria-multiline="true"
          autoComplete="off"
          autoCapitalize="sentences"
          inputMode="text"
          enterKeyHint="enter"
          value={markdown}
          onChange={(event) => {
            onMarkdownChange(event.target.value);
            scheduleCustomCaretSync();
          }}
          onSelect={syncSelection}
          onClick={syncSelection}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={syncSelection}
          onFocus={() => {
            if (window.matchMedia("(max-width: 640px)").matches) {
              keyboardBaselineHeightRef.current = Math.max(
                keyboardBaselineHeightRef.current ??
                  window.visualViewport?.height ??
                  window.innerHeight,
                window.visualViewport?.height ?? window.innerHeight,
              );
            }

            syncSelection();
          }}
          onBlur={() => {
            setIsQuickInputVisible(false);
            hideEditorIndicators();
          }}
          onScroll={scheduleCustomCaretSync}
          onCompositionUpdate={scheduleCustomCaretSync}
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
        <div className="markdown-editor-caret-mirror" aria-hidden="true">
          <span ref={caretMirrorTextRef} />
          <span ref={caretMirrorAnchorRef}>{"\u200b"}</span>
        </div>
        <span
          ref={customCaretRef}
          className="markdown-editor-caret"
          aria-hidden="true"
        />
        <span
          ref={selectionStartHandleRef}
          className="markdown-editor-selection-handle is-start"
          aria-hidden="true"
        />
        <span
          ref={selectionEndHandleRef}
          className="markdown-editor-selection-handle is-end"
          aria-hidden="true"
        />
      </div>
      {isQuickInputVisible ? (
        <div
          className="markdown-quick-input"
          role="toolbar"
          aria-label="Markdown 快速输入"
        >
          {MARKDOWN_SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.action}
              type="button"
              aria-label={shortcut.accessibleLabel}
              onPointerDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => handleMarkdownShortcut(shortcut.action)}
            >
              {shortcut.label}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
});
