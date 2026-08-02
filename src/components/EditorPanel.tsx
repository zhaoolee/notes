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
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImageCropDialog } from "./ImageCropDialog";
import { importImageFile, importImageUrl } from "../lib/images";
import {
  moveEditorImage,
  replaceEditorImageAlt,
  replaceEditorImageSource,
  splitEditorContent,
  type EditorImageBlock,
  type EditorTextBlock,
} from "../lib/editor-images";
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

function getEditorImageKey(image: EditorImageBlock): string {
  return `${image.markerStart}:${image.source}`;
}

function collectVisualLineOffsets(
  textarea: HTMLTextAreaElement,
  text: string,
): number[] {
  const style = getComputedStyle(textarea);
  const contentWidth = Math.max(
    1,
    textarea.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight),
  );
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return [0, text.length];
  }

  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
  const offsets = [0];
  let lineWidth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\n") {
      offsets.push(index + 1);
      lineWidth = 0;
      continue;
    }

    const characterWidth = context.measureText(character).width + letterSpacing;

    if (lineWidth > 0 && lineWidth + characterWidth > contentWidth) {
      offsets.push(index);
      lineWidth = characterWidth;
    } else {
      lineWidth += characterWidth;
    }
  }

  if (offsets.at(-1) !== text.length) {
    offsets.push(text.length);
  }

  return Array.from(new Set(offsets));
}

export const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(function EditorPanel(
  {
    markdown,
    onMarkdownChange,
    onImageImportingChange,
  },
  ref,
) {
  const editorFrameRef = useRef<HTMLDivElement | null>(null);
  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const captionInputRefs = useRef(new Map<string, HTMLInputElement>());
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const caretMirrorRef = useRef<HTMLDivElement | null>(null);
  const caretMirrorTextRef = useRef<HTMLSpanElement | null>(null);
  const caretMirrorAnchorRef = useRef<HTMLSpanElement | null>(null);
  const mobileCaretRef = useRef<HTMLSpanElement | null>(null);
  const caretSyncFrameRef = useRef<number | null>(null);
  const imageDragCleanupRef = useRef<(() => void) | null>(null);
  const isComposingRef = useRef(false);
  const keyboardBaselineHeightRef = useRef<number | null>(null);
  const selectionRef = useRef({
    start: markdown.length,
    end: markdown.length,
  });
  const [isImportingImage, setIsImportingImage] = useState(false);
  const [imageImportError, setImageImportError] = useState("");
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [isQuickInputVisible, setIsQuickInputVisible] = useState(false);
  const [activeImageKey, setActiveImageKey] = useState<string | null>(null);
  const [captionImageKey, setCaptionImageKey] = useState<string | null>(null);
  const [pendingImageDeletion, setPendingImageDeletion] = useState<{
    focusOffset: number;
    imageKey: string;
  } | null>(null);
  const [draggingImageKey, setDraggingImageKey] = useState<string | null>(null);
  const [imageDropIndicatorTop, setImageDropIndicatorTop] = useState<number | null>(
    null,
  );
  const [previewImage, setPreviewImage] = useState<{
    alt: string;
    source: string;
  } | null>(null);
  const [cropSession, setCropSession] = useState<{
    alt: string;
    imageKey: string;
    source: string;
  } | null>(null);
  const editorContent = useMemo(
    () => splitEditorContent(markdown),
    [markdown],
  );

  useEffect(() => {
    const imageKeys = new Set(
      editorContent
        .filter((block): block is EditorImageBlock => block.kind === "image")
        .map(getEditorImageKey),
    );

    if (activeImageKey && !imageKeys.has(activeImageKey)) {
      setActiveImageKey(null);
    }

    if (captionImageKey && !imageKeys.has(captionImageKey)) {
      setCaptionImageKey(null);
    }

    if (
      pendingImageDeletion &&
      !imageKeys.has(pendingImageDeletion.imageKey)
    ) {
      setPendingImageDeletion(null);
    }
  }, [
    activeImageKey,
    captionImageKey,
    editorContent,
    pendingImageDeletion,
  ]);

  useEffect(
    () => () => {
      imageDragCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const handlePreviewKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewImage(null);
      }
    };

    window.addEventListener("keydown", handlePreviewKeyDown);
    return () => window.removeEventListener("keydown", handlePreviewKeyDown);
  }, [previewImage]);

  useImperativeHandle(
    ref,
    () => ({
      openImagePicker: () => {
        imageInputRef.current?.click();
      },
    }),
    [],
  );

  const hideMobileCaret = useCallback((): void => {
    for (const textarea of textareaRefs.current.values()) {
      textarea.classList.remove("uses-fixed-mobile-caret");
    }

    mobileCaretRef.current?.classList.remove("is-visible");
  }, []);

  const updateMobileCaret = useCallback((): void => {
    caretSyncFrameRef.current = null;

    const flow = editorScrollRef.current;
    const mirror = caretMirrorRef.current;
    const mirrorText = caretMirrorTextRef.current;
    const mirrorAnchor = caretMirrorAnchorRef.current;
    const caret = mobileCaretRef.current;
    const textarea = Array.from(textareaRefs.current.values()).find(
      (candidate) => document.activeElement === candidate,
    );

    if (
      !flow ||
      !mirror ||
      !mirrorText ||
      !mirrorAnchor ||
      !caret ||
      !textarea ||
      !window.matchMedia("(max-width: 640px)").matches ||
      isComposingRef.current ||
      textarea.selectionStart !== textarea.selectionEnd
    ) {
      hideMobileCaret();
      return;
    }

    const textareaStyle = window.getComputedStyle(textarea);
    mirror.style.top = `${textarea.offsetTop}px`;
    mirror.style.left = `${textarea.offsetLeft}px`;
    mirror.style.width = `${textarea.offsetWidth}px`;
    mirror.style.height = `${textarea.scrollHeight}px`;
    mirror.style.padding = textareaStyle.padding;
    mirror.style.fontFamily = textareaStyle.fontFamily;
    mirror.style.fontSize = textareaStyle.fontSize;
    mirror.style.fontStyle = textareaStyle.fontStyle;
    mirror.style.fontWeight = textareaStyle.fontWeight;
    mirror.style.letterSpacing = textareaStyle.letterSpacing;
    mirror.style.lineHeight = textareaStyle.lineHeight;
    mirror.style.textAlign = textareaStyle.textAlign;
    mirror.style.textIndent = textareaStyle.textIndent;
    mirror.style.textTransform = textareaStyle.textTransform;
    mirror.style.wordSpacing = textareaStyle.wordSpacing;
    mirrorText.textContent = textarea.value.slice(0, textarea.selectionStart);

    const caretStyle = window.getComputedStyle(caret);
    const caretHeight = Number.parseFloat(caretStyle.height) || 22;
    const anchorHeight = mirrorAnchor.offsetHeight || caretHeight;
    const left = textarea.offsetLeft + mirrorAnchor.offsetLeft;
    const top =
      textarea.offsetTop +
      mirrorAnchor.offsetTop +
      Math.max(0, (anchorHeight - caretHeight) / 2);

    if (
      left < flow.scrollLeft ||
      left > flow.scrollLeft + flow.clientWidth ||
      top + caretHeight < flow.scrollTop ||
      top > flow.scrollTop + flow.clientHeight
    ) {
      hideMobileCaret();
      return;
    }

    for (const candidate of textareaRefs.current.values()) {
      candidate.classList.toggle(
        "uses-fixed-mobile-caret",
        candidate === textarea,
      );
    }

    caret.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    caret.classList.remove("is-visible");
    void caret.offsetWidth;
    caret.classList.add("is-visible");
  }, [hideMobileCaret]);

  const scheduleMobileCaretSync = useCallback((): void => {
    if (caretSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(caretSyncFrameRef.current);
    }

    caretSyncFrameRef.current = window.requestAnimationFrame(updateMobileCaret);
  }, [updateMobileCaret]);

  useEffect(() => {
    scheduleMobileCaretSync();
  }, [markdown, scheduleMobileCaretSync]);

  useEffect(() => {
    const viewport = window.visualViewport;

    window.addEventListener("resize", scheduleMobileCaretSync);
    viewport?.addEventListener("resize", scheduleMobileCaretSync);

    return () => {
      window.removeEventListener("resize", scheduleMobileCaretSync);
      viewport?.removeEventListener("resize", scheduleMobileCaretSync);

      if (caretSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(caretSyncFrameRef.current);
      }
    };
  }, [scheduleMobileCaretSync]);

  const syncEditorPaperScroll = useCallback((): void => {
    const scroller = editorScrollRef.current;

    if (scroller) {
      editorFrameRef.current?.style.setProperty(
        "--editor-paper-scroll-y",
        `${-scroller.scrollTop}px`,
      );
    }

    scheduleMobileCaretSync();
  }, [scheduleMobileCaretSync]);

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

  const resizeEditorContent = useCallback((): void => {
    const scroller = editorScrollRef.current;

    if (!scroller || scroller.clientWidth === 0) {
      return;
    }

    const scrollTop = scroller.scrollTop;
    const textareas: HTMLTextAreaElement[] = [];

    for (const [blockIndex, textarea] of textareaRefs.current) {
      const block = editorContent[blockIndex];

      if (!block || block.kind !== "text") {
        continue;
      }

      textarea.style.height = "0px";
      textareas.push(textarea);
    }

    for (const textarea of textareas) {
      textarea.style.height = `${Math.max(
        textarea.scrollHeight,
        Number.parseFloat(
          getComputedStyle(textarea).getPropertyValue("--editor-line-height"),
        ) || 42,
      )}px`;
    }

    // A tall textarea can make the flow scrollbar appear and narrow the text
    // after the first measurement. Settle that second wrapping pass as well.
    for (const textarea of textareas) {
      if (textarea.scrollHeight > textarea.clientHeight) {
        textarea.style.height = `${textarea.scrollHeight}px`;
      }
    }

    for (const imageBlock of scroller.querySelectorAll<HTMLElement>(
      ".editor-image-block",
    )) {
      snapImageBlockToLineGrid(imageBlock);
    }

    scroller.scrollTop = scrollTop;
    editorFrameRef.current?.style.setProperty(
      "--editor-paper-scroll-y",
      `${-scroller.scrollTop}px`,
    );
  }, [editorContent]);

  useLayoutEffect(() => {
    resizeEditorContent();
    const animationFrame = window.requestAnimationFrame(resizeEditorContent);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [resizeEditorContent]);

  useEffect(() => {
    const scroller = editorScrollRef.current;

    if (!scroller) {
      return;
    }

    let animationFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      resizeEditorContent();
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(resizeEditorContent);
    });

    resizeObserver.observe(scroller);
    window.addEventListener("resize", resizeEditorContent);

    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resizeEditorContent);
    };
  }, [resizeEditorContent]);

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

    const localStart = active.textarea.selectionStart ?? 0;
    const localEnd = active.textarea.selectionEnd ?? localStart;

    selectionRef.current = {
      start: active.block.start + localStart,
      end: active.block.start + localEnd,
    };
    scheduleMobileCaretSync();
  }

  useEffect(() => {
    const syncNativeSelectionChange = (): void => {
      syncSelection();
    };

    document.addEventListener("selectionchange", syncNativeSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", syncNativeSelectionChange);
    };
  }, [editorContent, scheduleMobileCaretSync]);

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

      textarea.focus();
      textarea.setSelectionRange(localStart, localEnd);
      textarea.scrollIntoView({ block: "nearest" });
      scheduleMobileCaretSync();
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
    setActiveImageKey(null);
    setCaptionImageKey(null);
    selectionRef.current = {
      end: markerStart,
      start: markerStart,
    };
    focusGlobalSelection(nextMarkdown, markerStart);
  }

  function requestImageDeletion(
    image: EditorImageBlock,
    focusOffset: number,
  ): void {
    const imageKey = getEditorImageKey(image);

    if (activeImageKey !== imageKey) {
      setCaptionImageKey(null);
      setActiveImageKey(imageKey);
      return;
    }

    setPendingImageDeletion({ focusOffset, imageKey });
  }

  function closeImageDeletionConfirmation(): void {
    const focusOffset = pendingImageDeletion?.focusOffset;
    setPendingImageDeletion(null);

    if (focusOffset !== undefined) {
      focusGlobalSelection(markdown, focusOffset);
    }
  }

  function confirmImageDeletion(): void {
    const image = editorContent.find(
      (block): block is EditorImageBlock =>
        block.kind === "image" &&
        getEditorImageKey(block) === pendingImageDeletion?.imageKey,
    );

    setPendingImageDeletion(null);

    if (image) {
      removeAdjacentImage(image.markerStart, image.markerEnd);
    }
  }

  function updateImageAlt(image: EditorImageBlock, nextAlt: string): void {
    const nextMarkdown = replaceEditorImageAlt(markdown, image, nextAlt);

    if (nextMarkdown !== markdown) {
      onMarkdownChange(nextMarkdown);
    }
  }

  function openImageCaption(image: EditorImageBlock): void {
    const imageKey = getEditorImageKey(image);
    setActiveImageKey(null);
    setCaptionImageKey(imageKey);
    hideMobileCaret();

    window.requestAnimationFrame(() => {
      const input = captionInputRefs.current.get(imageKey);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
      input?.scrollIntoView({ block: "nearest" });
      snapImageBlockToLineGrid(
        input?.closest<HTMLElement>(".editor-image-block") ?? null,
      );
    });
  }

  async function downloadEditorImage(image: EditorImageBlock): Promise<void> {
    const fallbackName = image.alt.trim() || "note-image";

    try {
      const response = await fetch(image.source);

      if (!response.ok) {
        throw new Error(`图片下载失败（${response.status}）`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${fallbackName.replace(/[\\/:*?"<>|]/g, "-")}.${extension}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      setImageImportError("");
    } catch (error) {
      const anchor = document.createElement("a");
      anchor.href = image.source;
      anchor.download = fallbackName;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setImageImportError(
        error instanceof Error
          ? `${error.message}，已在新窗口打开原图。`
          : "图片下载失败，已在新窗口打开原图。",
      );
    }
  }

  async function openImageCrop(image: EditorImageBlock): Promise<void> {
    try {
      setActiveImageKey(null);
      setIsImportingImage(true);
      onImageImportingChange(true);
      setImageImportError("");
      const imageUrl = new URL(image.source, window.location.href);
      let cropSource = imageUrl.href;

      if (
        (imageUrl.protocol === "http:" || imageUrl.protocol === "https:") &&
        imageUrl.origin !== window.location.origin
      ) {
        const imported = await importImageUrl(image.source);
        cropSource = new URL(
          imported.path || imported.url,
          window.location.href,
        ).href;
      }

      setCropSession({
        alt: image.alt,
        imageKey: getEditorImageKey(image),
        source: cropSource,
      });
    } catch (error) {
      setImageImportError(
        error instanceof Error ? error.message : "无法打开图片裁剪。",
      );
    } finally {
      setIsImportingImage(false);
      onImageImportingChange(false);
    }
  }

  async function saveCroppedImage(file: File): Promise<void> {
    const session = cropSession;
    const currentImage = editorContent.find(
      (block): block is EditorImageBlock =>
        block.kind === "image" && getEditorImageKey(block) === session?.imageKey,
    );

    if (!session || !currentImage) {
      throw new Error("图片内容已变化，请重新打开裁剪。");
    }

    try {
      setIsImportingImage(true);
      onImageImportingChange(true);
      setImageImportError("");
      const imported = await importImageFile(file);
      const nextMarkdown = replaceEditorImageSource(
        markdown,
        currentImage,
        imported.path || imported.url,
      );

      if (nextMarkdown === markdown) {
        throw new Error("裁剪后的图片无法替换原图。");
      }

      onMarkdownChange(nextMarkdown);
      setCropSession(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "图片裁剪失败。";
      setImageImportError(message);
      throw new Error(message);
    } finally {
      setIsImportingImage(false);
      onImageImportingChange(false);
    }
  }

  function getImageDropTargets(): Array<{ offset: number; y: number }> {
    const targets: Array<{ offset: number; y: number }> = [];

    for (const [blockIndex, textarea] of textareaRefs.current) {
      const block = editorContent[blockIndex];

      if (!block || block.kind !== "text") {
        continue;
      }

      const style = getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(style.lineHeight) || 42;
      const paddingTop = Number.parseFloat(style.paddingTop) || 0;
      const rect = textarea.getBoundingClientRect();
      const offsets = collectVisualLineOffsets(textarea, block.text);

      offsets.forEach((offset, lineIndex) => {
        targets.push({
          offset: block.start + offset,
          y: Math.min(
            rect.bottom,
            rect.top + paddingTop + lineIndex * lineHeight + lineHeight / 2,
          ),
        });
      });
    }

    return targets;
  }

  function beginImageDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    image: EditorImageBlock,
  ): void {
    if (event.button !== 0) {
      return;
    }

    const flow = editorScrollRef.current;

    if (!flow) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    hideMobileCaret();
    const pointerId = event.pointerId;
    const startY = event.clientY;
    let hasMoved = false;
    let targetOffset: number | null = null;

    const cleanup = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      imageDragCleanupRef.current = null;
      setDraggingImageKey(null);
      setImageDropIndicatorTop(null);
    };

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      if (!hasMoved && Math.abs(pointerEvent.clientY - startY) < 6) {
        return;
      }

      hasMoved = true;
      pointerEvent.preventDefault();
      setActiveImageKey(null);
      setDraggingImageKey(getEditorImageKey(image));

      const flowRect = flow.getBoundingClientRect();
      const edgeSize = Math.min(72, flowRect.height * 0.16);

      if (pointerEvent.clientY < flowRect.top + edgeSize) {
        flow.scrollTop -= 18;
      } else if (pointerEvent.clientY > flowRect.bottom - edgeSize) {
        flow.scrollTop += 18;
      }

      const targets = getImageDropTargets();
      const nearest = targets.reduce<
        { offset: number; y: number } | undefined
      >((current, candidate) =>
        !current ||
        Math.abs(candidate.y - pointerEvent.clientY) <
          Math.abs(current.y - pointerEvent.clientY)
          ? candidate
          : current,
      undefined);

      if (!nearest) {
        return;
      }

      targetOffset = nearest.offset;
      setImageDropIndicatorTop(
        nearest.y - flowRect.top + flow.scrollTop - 1,
      );
      syncEditorPaperScroll();
    };

    const handlePointerUp = (pointerEvent: globalThis.PointerEvent): void => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      cleanup();

      if (!hasMoved || targetOffset === null) {
        focusAfterImage(image.markerEnd);
        return;
      }

      const nextMarkdown = moveEditorImage(markdown, image, targetOffset);

      if (nextMarkdown !== markdown) {
        onMarkdownChange(nextMarkdown);
      }
    };

    imageDragCleanupRef.current?.();
    imageDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function handleEditorKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    block: EditorTextBlock,
    blockIndex: number,
  ): void {
    const selectionStart = event.currentTarget.selectionStart;
    const selectionEnd = event.currentTarget.selectionEnd;
    const previousBlock = editorContent[blockIndex - 1];
    const nextBlock = editorContent[blockIndex + 1];

    if (
      event.key === "Backspace" &&
      selectionStart === 0 &&
      selectionEnd === 0 &&
      previousBlock?.kind === "image"
    ) {
      event.preventDefault();
      requestImageDeletion(previousBlock, block.start);
      return;
    }

    if (
      event.key === "Delete" &&
      selectionStart === block.text.length &&
      selectionEnd === block.text.length &&
      nextBlock?.kind === "image"
    ) {
      event.preventDefault();
      requestImageDeletion(nextBlock, block.end);
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
    const imageMarkdown = `![](${imageUrl})`;
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
    const nextValue = event.target.value;
    const localSelectionStart =
      event.target.selectionStart ?? nextValue.length;
    const localSelectionEnd =
      event.target.selectionEnd ?? localSelectionStart;
    const nextMarkdown = `${markdown.slice(0, block.start)}${nextValue}${markdown.slice(
      block.end,
    )}`;
    const selectionStart = block.start + localSelectionStart;
    const selectionEnd = block.start + localSelectionEnd;

    selectionRef.current = {
      end: selectionEnd,
      start: selectionStart,
    };
    onMarkdownChange(nextMarkdown);
    scheduleMobileCaretSync();
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
    <>
      <aside className="editor-panel">
      {imageImportError ? <p className="image-import-status error">{imageImportError}</p> : null}
      {isImportingImage ? <p className="image-import-status">正在导入图片...</p> : null}
      <div
        ref={editorFrameRef}
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
          onPointerDown={(event) => {
            if (!(event.target as HTMLElement).closest(".editor-image-block")) {
              setActiveImageKey(null);
            }
          }}
        >
          {imageDropIndicatorTop !== null ? (
            <span
              className="editor-image-drop-line"
              style={{ top: `${imageDropIndicatorTop}px` }}
              aria-hidden="true"
            />
          ) : null}
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
                value={block.text}
                onChange={(event) => handleTextBlockChange(event, block)}
                onSelect={syncSelection}
                onClick={syncSelection}
                onKeyDown={(event) =>
                  handleEditorKeyDown(event, block, blockIndex)
                }
                onKeyUp={syncSelection}
                onPointerDown={hideMobileCaret}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                  hideMobileCaret();
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                  scheduleMobileCaretSync();
                }}
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
                  scheduleMobileCaretSync();
                }}
                onBlur={() => {
                  setIsQuickInputVisible(false);
                  hideMobileCaret();
                }}
                onPaste={(event) => {
                  void importFromClipboard(event);
                }}
                spellCheck={false}
              />
            ) : (
              <figure
                key={`image-${block.markerStart}-${block.source}`}
                className={`editor-image-block${
                  activeImageKey === getEditorImageKey(block) ? " is-active" : ""
                }${
                  draggingImageKey === getEditorImageKey(block)
                    ? " is-dragging"
                    : ""
                }`}
                data-editor-image="true"
                data-image-key={getEditorImageKey(block)}
              >
                <div
                  className="editor-image-visual"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveImageKey((currentKey) =>
                      currentKey === getEditorImageKey(block)
                        ? null
                        : getEditorImageKey(block),
                    );
                  }}
                >
                  <img
                    className="editor-image-main"
                    src={block.source}
                    alt={block.alt || `正文图片 ${Math.floor(blockIndex / 2) + 1}`}
                    loading="lazy"
                    draggable={false}
                    onLoad={(event) => {
                      snapImageBlockToLineGrid(
                        event.currentTarget.closest(".editor-image-block"),
                      );
                    }}
                  />

                  {activeImageKey === getEditorImageKey(block) ? (
                    <div
                      className="editor-image-actions"
                      role="toolbar"
                      aria-label="图片操作"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label="删除这张图片"
                        onClick={() =>
                          requestImageDeletion(block, block.markerEnd)
                        }
                      >
                        <img
                          src="/smartisan/mobile/item_image_btn_unbrella_delete.png"
                          alt=""
                        />
                      </button>
                      <button
                        type="button"
                        aria-label="编辑图片标注"
                        onClick={() => openImageCaption(block)}
                      >
                        <img
                          src="/smartisan/mobile/item_image_btn_unbrella_edit_detail.png"
                          alt=""
                        />
                      </button>
                      <button
                        type="button"
                        aria-label="下载这张图片"
                        onClick={() => void downloadEditorImage(block)}
                      >
                        <img
                          src="/smartisan/mobile/item_image_btn_unbrella_download_image.png"
                          alt=""
                        />
                      </button>
                      <button
                        type="button"
                        aria-label="放大查看这张图片"
                        onClick={() => {
                          setActiveImageKey(null);
                          setPreviewImage({ alt: block.alt, source: block.source });
                        }}
                      >
                        <img
                          src="/smartisan/mobile/item_image_btn_unbrella_preview_image.png"
                          alt=""
                        />
                      </button>
                      <button
                        type="button"
                        aria-label="裁剪这张图片"
                        onClick={() => void openImageCrop(block)}
                      >
                        <img
                          src="/smartisan/mobile/item_image_btn_unbrella_edit_image.png"
                          alt=""
                        />
                      </button>
                    </div>
                  ) : null}
                </div>

                {captionImageKey === getEditorImageKey(block) || block.alt ? (
                  <input
                    ref={(input) => {
                      const imageKey = getEditorImageKey(block);

                      if (input) {
                        captionInputRefs.current.set(imageKey, input);
                      } else {
                        captionInputRefs.current.delete(imageKey);
                      }
                    }}
                    className="editor-image-caption"
                    aria-label="图片标注"
                    maxLength={240}
                    placeholder="图片描述"
                    value={block.alt}
                    onChange={(event) => updateImageAlt(block, event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => {
                      setActiveImageKey(null);
                      hideMobileCaret();
                    }}
                  />
                ) : null}

                <button
                  type="button"
                  className="editor-image-handle"
                  aria-label="拖动图片位置"
                  onPointerDown={(event) => {
                    beginImageDrag(event, block);
                  }}
                >
                  <img
                    src="/smartisan/mobile/detail_note_item_image_move.png"
                    alt=""
                    draggable={false}
                  />
                </button>
              </figure>
            ),
          )}
          <div
            ref={caretMirrorRef}
            className="markdown-editor-caret-mirror"
            aria-hidden="true"
          >
            <span ref={caretMirrorTextRef} />
            <span ref={caretMirrorAnchorRef}>{"\u200b"}</span>
          </div>
          <span
            ref={mobileCaretRef}
            className="markdown-editor-fixed-caret"
            aria-hidden="true"
          />
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

      {previewImage
        ? createPortal(
            <div
              className="editor-image-preview"
              role="dialog"
              aria-modal="true"
              aria-label="图片放大预览"
            >
              <button
                type="button"
                className="editor-image-preview-close"
                aria-label="关闭图片预览"
                onClick={() => setPreviewImage(null)}
              >
                ×
              </button>
              <strong className="editor-image-preview-count">1 / 1</strong>
              <img
                className="editor-image-preview-main"
                src={previewImage.source}
                alt={previewImage.alt || "图片预览"}
              />
              <button
                type="button"
                className="editor-image-preview-save"
                onClick={() => {
                  const image = editorContent.find(
                    (block): block is EditorImageBlock =>
                      block.kind === "image" &&
                      block.source === previewImage.source &&
                      block.alt === previewImage.alt,
                  );

                  if (image) {
                    void downloadEditorImage(image);
                  }
                }}
              >
                保存图片
              </button>
            </div>,
            document.body,
          )
        : null}

      {cropSession ? (
        <ImageCropDialog
          alt={cropSession.alt}
          source={cropSession.source}
          onCancel={() => setCropSession(null)}
          onConfirm={saveCroppedImage}
        />
      ) : null}

      <ConfirmDialog
        pendingAction={
          pendingImageDeletion
            ? {
                confirmLabel: "删除图片",
                description: "删除后将无法恢复，是否确认删除这张图片？",
                title: "删除图片",
              }
            : null
        }
        onClose={closeImageDeletionConfirmation}
        onConfirm={confirmImageDeletion}
      />
    </>
  );
});
