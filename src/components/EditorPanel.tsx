import {
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { importImageFile, importImageUrl } from "../lib/images";
import {
  splitEditorContent,
  type EditorTextBlock,
} from "../lib/editor-images";
import {
  EDITOR_EMPTY_LINE_MARKER,
  editorOffsetToSourceOffset,
  sourceOffsetToEditorOffset,
  stripEditorDisplayMarkers,
  toEditorDisplayText,
} from "../lib/editor-text";
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
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const keyboardBaselineHeightRef = useRef<number | null>(null);
  const selectionRef = useRef({
    start: markdown.length,
    end: markdown.length,
  });
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [imageImportError, setImageImportError] = useState("");
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [isQuickInputVisible, setIsQuickInputVisible] = useState(false);
  const editorContent = useMemo(
    () => splitEditorContent(markdown),
    [markdown],
  );

  useImperativeHandle(
    ref,
    () => ({
      openImagePicker: () => {
        imageInputRef.current?.click();
      },
    }),
    [],
  );

  const syncEditorPaperScroll = useCallback((): void => {
    const scroller = editorScrollRef.current;

    if (scroller) {
      scroller.style.setProperty(
        "--editor-paper-scroll-y",
        `${-scroller.scrollTop}px`,
      );
    }
  }, []);

  useEffect(() => {
    syncEditorPaperScroll();
  }, [markdown, syncEditorPaperScroll]);

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

      const viewportHeight = getViewportHeight();
      const isEditorFocused = Array.from(textareaRefs.current.values()).includes(
        document.activeElement as HTMLTextAreaElement,
      );

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

  useLayoutEffect(() => {
    const resizeTextareas = (): void => {
      for (const [blockIndex, textarea] of textareaRefs.current) {
        const block = editorContent[blockIndex];

        if (!block || block.kind !== "text") {
          continue;
        }

        textarea.style.height = "0px";
        textarea.style.height = `${Math.max(
          textarea.scrollHeight,
          Number.parseFloat(
            getComputedStyle(textarea).getPropertyValue("--editor-line-height"),
          ) || 42,
        )}px`;
      }

      for (const imageBlock of editorScrollRef.current?.querySelectorAll<HTMLElement>(
        ".editor-image-block",
      ) ?? []) {
        snapImageBlockToLineGrid(imageBlock);
      }
    };

    resizeTextareas();
    const animationFrame = window.requestAnimationFrame(resizeTextareas);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [editorContent]);

  useEffect(() => {
    const syncImageGrid = (): void => {
      for (const imageBlock of editorScrollRef.current?.querySelectorAll<HTMLElement>(
        ".editor-image-block",
      ) ?? []) {
        snapImageBlockToLineGrid(imageBlock);
      }
    };

    window.addEventListener("resize", syncImageGrid);

    return () => {
      window.removeEventListener("resize", syncImageGrid);
    };
  }, [editorContent]);

  function snapImageBlockToLineGrid(imageBlock: HTMLElement | null): void {
    if (!imageBlock) {
      return;
    }

    imageBlock.style.setProperty("--editor-image-grid-spacer", "0px");
    const computedStyle = getComputedStyle(imageBlock);
    const lineHeight =
      Number.parseFloat(
        computedStyle.getPropertyValue("--editor-line-height"),
      ) || 42;
    const occupiedHeight =
      imageBlock.getBoundingClientRect().height +
      Number.parseFloat(computedStyle.marginTop) +
      Number.parseFloat(computedStyle.marginBottom);
    const remainder = occupiedHeight % lineHeight;
    const spacer =
      remainder < 0.25 || lineHeight - remainder < 0.25
        ? 0
        : lineHeight - remainder;

    imageBlock.style.setProperty(
      "--editor-image-grid-spacer",
      `${spacer}px`,
    );
  }

  function getActiveTextBlock(): {
    block: EditorTextBlock;
    blockIndex: number;
    textarea: HTMLTextAreaElement;
  } | null {
    const activeElement = document.activeElement;

    for (const [blockIndex, textarea] of textareaRefs.current) {
      const block = editorContent[blockIndex];

      if (
        activeElement === textarea &&
        block &&
        block.kind === "text"
      ) {
        return { block, blockIndex, textarea };
      }
    }

    return null;
  }

  function syncSelection(): void {
    const active = getActiveTextBlock();

    if (!active) {
      return;
    }

    const displayText = active.textarea.value;
    const displayStart = active.textarea.selectionStart ?? 0;
    const displayEnd = active.textarea.selectionEnd ?? displayStart;

    selectionRef.current = {
      start:
        active.block.start +
        editorOffsetToSourceOffset(displayText, displayStart),
      end:
        active.block.start +
        editorOffsetToSourceOffset(displayText, displayEnd),
    };
  }

  useEffect(() => {
    const syncNativeSelectionChange = (): void => {
      syncSelection();
    };

    document.addEventListener("selectionchange", syncNativeSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", syncNativeSelectionChange);
    };
  }, [editorContent]);

  function focusGlobalSelection(
    nextMarkdown: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): void {
    const nextContent = splitEditorContent(nextMarkdown);
    let targetBlockIndex = nextContent.findIndex(
      (block) =>
        block.kind === "text" &&
        selectionStart >= block.start &&
        selectionStart <= block.end,
    );

    if (targetBlockIndex < 0) {
      for (let index = nextContent.length - 1; index >= 0; index -= 1) {
        if (nextContent[index]?.kind === "text") {
          targetBlockIndex = index;
          break;
        }
      }
    }

    const targetBlock = nextContent[targetBlockIndex];

    if (!targetBlock || targetBlock.kind !== "text") {
      return;
    }

    const localStart = Math.max(
      0,
      Math.min(targetBlock.text.length, selectionStart - targetBlock.start),
    );
    const localEnd = Math.max(
      localStart,
      Math.min(targetBlock.text.length, selectionEnd - targetBlock.start),
    );

    window.requestAnimationFrame(() => {
      const textarea = textareaRefs.current.get(targetBlockIndex);

      if (!textarea) {
        return;
      }

      const displayStart = sourceOffsetToEditorOffset(
        targetBlock.text,
        localStart,
      );
      const displayEnd = sourceOffsetToEditorOffset(
        targetBlock.text,
        localEnd,
      );

      textarea.focus();
      textarea.setSelectionRange(displayStart, displayEnd);
      textarea.scrollIntoView({ block: "nearest" });
    });
  }

  function commitMarkdownEdit(edit: MarkdownEditResult): void {
    if (edit.markdown !== markdown) {
      onMarkdownChange(edit.markdown);
    }

    selectionRef.current = {
      start: edit.selectionStart,
      end: edit.selectionEnd,
    };
    focusGlobalSelection(
      edit.markdown,
      edit.selectionStart,
      edit.selectionEnd,
    );
  }

  function handleMarkdownShortcut(shortcut: MarkdownShortcut): void {
    syncSelection();
    const { start: selectionStart, end: selectionEnd } = selectionRef.current;

    commitMarkdownEdit(
      applyMarkdownShortcut(markdown, selectionStart, selectionEnd, shortcut),
    );
  }

  function focusAfterImage(markerEnd: number): void {
    selectionRef.current = {
      end: markerEnd,
      start: markerEnd,
    };
    focusGlobalSelection(markdown, markerEnd);
  }

  function removeAdjacentImage(
    markerStart: number,
    markerEnd: number,
  ): void {
    const nextMarkdown = `${markdown.slice(0, markerStart)}${markdown.slice(
      markerEnd,
    )}`;

    onMarkdownChange(nextMarkdown);
    selectionRef.current = {
      end: markerStart,
      start: markerStart,
    };
    focusGlobalSelection(nextMarkdown, markerStart);
  }

  function handleEditorKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    block: EditorTextBlock,
    blockIndex: number,
  ): void {
    const displayText = event.currentTarget.value;
    const displaySelectionStart = event.currentTarget.selectionStart;
    const displaySelectionEnd = event.currentTarget.selectionEnd;
    const selectionStart = editorOffsetToSourceOffset(
      displayText,
      displaySelectionStart,
    );
    const selectionEnd = editorOffsetToSourceOffset(
      displayText,
      displaySelectionEnd,
    );
    const previousBlock = editorContent[blockIndex - 1];
    const nextBlock = editorContent[blockIndex + 1];

    if (
      event.key === "Backspace" &&
      selectionStart === 0 &&
      selectionEnd === 0 &&
      previousBlock?.kind === "image"
    ) {
      event.preventDefault();
      removeAdjacentImage(previousBlock.markerStart, previousBlock.markerEnd);
      return;
    }

    if (
      event.key === "Delete" &&
      selectionStart === block.text.length &&
      selectionEnd === block.text.length &&
      nextBlock?.kind === "image"
    ) {
      event.preventDefault();
      removeAdjacentImage(nextBlock.markerStart, nextBlock.markerEnd);
      return;
    }

    if (
      selectionStart === selectionEnd &&
      event.key === "Backspace" &&
      displayText[displaySelectionStart - 1] === EDITOR_EMPTY_LINE_MARKER
    ) {
      event.preventDefault();

      if (selectionStart > 0) {
        const nextMarkdown = `${markdown.slice(
          0,
          block.start + selectionStart - 1,
        )}${markdown.slice(block.start + selectionStart)}`;

        onMarkdownChange(nextMarkdown);
        selectionRef.current = {
          start: block.start + selectionStart - 1,
          end: block.start + selectionStart - 1,
        };
        focusGlobalSelection(
          nextMarkdown,
          block.start + selectionStart - 1,
        );
      }

      return;
    }

    if (
      selectionStart === selectionEnd &&
      event.key === "Delete" &&
      displayText[displaySelectionStart] === EDITOR_EMPTY_LINE_MARKER
    ) {
      event.preventDefault();

      if (selectionStart < block.text.length) {
        const nextMarkdown = `${markdown.slice(
          0,
          block.start + selectionStart,
        )}${markdown.slice(block.start + selectionStart + 1)}`;

        onMarkdownChange(nextMarkdown);
        selectionRef.current = {
          start: block.start + selectionStart,
          end: block.start + selectionStart,
        };
        focusGlobalSelection(nextMarkdown, block.start + selectionStart);
      }

      return;
    }

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
      block.start + selectionStart,
      block.start + selectionEnd,
    );

    if (!edit) {
      return;
    }

    event.preventDefault();
    commitMarkdownEdit(edit);
  }

  function insertImageMarkdown(imageUrl: string): void {
    syncSelection();
    const selectionStart = selectionRef.current.start;
    const selectionEnd = selectionRef.current.end;
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
    focusGlobalSelection(nextMarkdown, nextCursorPosition);
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

  function handleTextBlockChange(
    event: ChangeEvent<HTMLTextAreaElement>,
    block: EditorTextBlock,
  ): void {
    const displayValue = event.target.value;
    const displaySelectionStart =
      event.target.selectionStart ?? displayValue.length;
    const displaySelectionEnd =
      event.target.selectionEnd ?? displaySelectionStart;
    const nextValue = stripEditorDisplayMarkers(displayValue);
    const nextMarkdown = `${markdown.slice(0, block.start)}${nextValue}${markdown.slice(
      block.end,
    )}`;
    const selectionStart =
      block.start +
      editorOffsetToSourceOffset(displayValue, displaySelectionStart);
    const selectionEnd =
      block.start +
      editorOffsetToSourceOffset(displayValue, displaySelectionEnd);

    selectionRef.current = {
      end: selectionEnd,
      start: selectionStart,
    };
    onMarkdownChange(nextMarkdown);

    if (
      nextMarkdown === markdown &&
      displayValue !== toEditorDisplayText(block.text)
    ) {
      event.target.value = toEditorDisplayText(block.text);
      event.target.setSelectionRange(
        sourceOffsetToEditorOffset(block.text, selectionStart - block.start),
        sourceOffsetToEditorOffset(block.text, selectionEnd - block.start),
      );
    }
  }

  function handleTextBlockCopy(
    event: ClipboardEvent<HTMLTextAreaElement>,
  ): void {
    const selectedDisplayText = event.currentTarget.value.slice(
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd,
    );

    if (!selectedDisplayText.includes(EDITOR_EMPTY_LINE_MARKER)) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      stripEditorDisplayMarkers(selectedDisplayText),
    );
  }

  function handleTextBlockCut(
    event: ClipboardEvent<HTMLTextAreaElement>,
    block: EditorTextBlock,
  ): void {
    const displayText = event.currentTarget.value;
    const displayStart = event.currentTarget.selectionStart;
    const displayEnd = event.currentTarget.selectionEnd;
    const selectedDisplayText = displayText.slice(displayStart, displayEnd);

    if (!selectedDisplayText.includes(EDITOR_EMPTY_LINE_MARKER)) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      stripEditorDisplayMarkers(selectedDisplayText),
    );

    const localStart = editorOffsetToSourceOffset(displayText, displayStart);
    const localEnd = editorOffsetToSourceOffset(displayText, displayEnd);

    if (localStart === localEnd) {
      return;
    }

    const nextMarkdown = `${markdown.slice(0, block.start + localStart)}${markdown.slice(
      block.start + localEnd,
    )}`;

    onMarkdownChange(nextMarkdown);
    selectionRef.current = {
      start: block.start + localStart,
      end: block.start + localStart,
    };
    focusGlobalSelection(nextMarkdown, block.start + localStart);
  }

  async function importFromDrop(event: DragEvent<HTMLElement>): Promise<void> {
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

  function handleDragEnter(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setIsDropTargetActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropTargetActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>): void {
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
        className={`markdown-editor-frame${
          isDropTargetActive ? " drag-active" : ""
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => {
          event.preventDefault();
          setIsDropTargetActive(false);
          void importFromDrop(event);
        }}
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
        <div
          ref={editorScrollRef}
          className="markdown-editor-flow"
          onScroll={syncEditorPaperScroll}
        >
          {editorContent.map((block, blockIndex) =>
            block.kind === "text" ? (
              <textarea
                id={blockIndex === 0 ? "markdown-editor" : undefined}
                key={`text-${blockIndex}`}
                name={`note-content-${blockIndex}`}
                ref={(textarea) => {
                  if (textarea) {
                    textareaRefs.current.set(blockIndex, textarea);
                  } else {
                    textareaRefs.current.delete(blockIndex);
                  }
                }}
                className="markdown-editor editor-text-segment"
                aria-label={
                  editorContent.length === 1
                    ? "便签正文"
                    : `便签正文第 ${Math.floor(blockIndex / 2) + 1} 段`
                }
                aria-multiline="true"
                autoComplete="off"
                autoCapitalize="sentences"
                inputMode="text"
                enterKeyHint="enter"
                value={toEditorDisplayText(block.text)}
                onChange={(event) => handleTextBlockChange(event, block)}
                onSelect={syncSelection}
                onClick={syncSelection}
                onKeyDown={(event) =>
                  handleEditorKeyDown(event, block, blockIndex)
                }
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
                }}
                onPaste={(event) => {
                  void importFromClipboard(event);
                }}
                onCopy={handleTextBlockCopy}
                onCut={(event) => handleTextBlockCut(event, block)}
                spellCheck={false}
              />
            ) : (
              <figure
                key={`image-${block.markerStart}-${block.source}`}
                className="editor-image-block"
                data-editor-image="true"
              >
                <img
                  src={block.source}
                  alt={block.alt || `正文图片 ${Math.floor(blockIndex / 2) + 1}`}
                  loading="lazy"
                  onLoad={(event) => {
                    snapImageBlockToLineGrid(event.currentTarget.parentElement);
                  }}
                />
                <button
                  type="button"
                  className="editor-image-handle"
                  aria-label="将光标移到图片后"
                  onPointerDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => focusAfterImage(block.markerEnd)}
                >
                  <span />
                  <span />
                  <span />
                </button>
              </figure>
            ),
          )}
        </div>
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
