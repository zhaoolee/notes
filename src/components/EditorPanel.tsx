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
} from "react";
import { importImageFile, importImageUrl } from "../lib/images";

interface EditorPanelProps {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  onImageImportingChange: (isImporting: boolean) => void;
}

export interface EditorPanelHandle {
  openImagePicker: () => void;
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
  const caretSyncFrameRef = useRef<number | null>(null);
  const selectionRef = useRef({
    start: markdown.length,
    end: markdown.length,
  });
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [imageImportError, setImageImportError] = useState("");
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);

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

  const updateCustomCaret = useCallback((): void => {
    caretSyncFrameRef.current = null;

    const textarea = textareaRef.current;
    const mirrorText = caretMirrorTextRef.current;
    const mirrorAnchor = caretMirrorAnchorRef.current;
    const customCaret = customCaretRef.current;

    if (
      !textarea ||
      !mirrorText ||
      !mirrorAnchor ||
      !customCaret ||
      !window.matchMedia("(max-width: 640px)").matches ||
      document.activeElement !== textarea ||
      textarea.selectionStart !== textarea.selectionEnd
    ) {
      hideCustomCaret();
      return;
    }

    mirrorText.textContent = textarea.value.slice(0, textarea.selectionStart);
    customCaret.classList.add("is-visible");

    const textareaStyle = window.getComputedStyle(textarea);
    const caretStyle = window.getComputedStyle(customCaret);
    const lineHeight = Number.parseFloat(textareaStyle.lineHeight) || 42;
    const caretHeight = Number.parseFloat(caretStyle.height) || 22;
    const left = mirrorAnchor.offsetLeft - textarea.scrollLeft;
    const top =
      mirrorAnchor.offsetTop -
      textarea.scrollTop +
      Math.max(0, (lineHeight - caretHeight) / 2);

    if (
      left < 0 ||
      left > textarea.clientWidth ||
      top + caretHeight < 0 ||
      top > textarea.clientHeight
    ) {
      hideCustomCaret();
      return;
    }

    customCaret.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }, [hideCustomCaret]);

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
          ref={textareaRef}
          className="markdown-editor"
          value={markdown}
          onChange={(event) => {
            onMarkdownChange(event.target.value);
            scheduleCustomCaretSync();
          }}
          onSelect={syncSelection}
          onClick={syncSelection}
          onKeyUp={syncSelection}
          onFocus={syncSelection}
          onBlur={hideCustomCaret}
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
      </div>
    </aside>
  );
});
