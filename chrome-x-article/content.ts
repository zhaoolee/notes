import { buildXArticleClipboard, formatXArticleImageMarker, type XArticleImage } from "../src/lib/x-article.js";
import { imageExtensions, isArticleComposer, notesImageUrl, notesOrigin } from "./media.js";

declare const chrome: {
  runtime: {
    sendMessage(message: { type: string; url: string }): Promise<{
      error?: string;
      type?: string;
      base64?: string;
    }>;
  };
};

const editorSelector = '.DraftEditor-editorContainer [contenteditable="true"]';
const blockSelector = '[data-block="true"]';
const dialogSelector = '[role="dialog"], dialog[open]';
const buttonSelector = 'button, [role="button"], [role="menuitem"], [role="option"]';
const insertNames = new Set(["insert", "add media", "插入", "添加媒体", "新增媒體", "挿入", "삽입"]);
const mediaNames = new Set(["media", "媒体", "媒體", "メディア", "미디어"]);
const applyNames = new Set(["apply", "done", "insert", "add", "应用", "套用", "完成", "插入", "添加", "新增", "適用", "완료"]);

type ImportJob = {
  controller: AbortController;
  editor: HTMLElement;
  url: string;
};

let runningJob: ImportJob | null = null;

function ensureCurrent(job: ImportJob): void {
  if (job.controller.signal.aborted || !job.editor.isConnected || location.href !== job.url) {
    throw new Error("Import stopped.");
  }
}

async function waitFor<T>(
  job: ImportJob,
  check: () => T | undefined,
  error: string,
  timeout = 8_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    ensureCurrent(job);
    const value = check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(error);
}

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden" &&
    !element.closest('[aria-hidden="true"], [inert]');
}

function buttonLabel(element: HTMLElement): string {
  return (element.getAttribute("aria-label") || element.textContent || "").trim().toLowerCase();
}

function findButton(root: ParentNode, names: Set<string>, selector = buttonSelector) {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(selector))
    .filter((element) =>
      names.has(buttonLabel(element)) && isVisible(element) &&
      !element.matches(':disabled, [aria-disabled="true"]'),
    );
  return matches.length === 1 ? matches[0] : undefined;
}

function markerRange(editor: HTMLElement, token: string): Range | undefined {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let range: Range | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const start = text.indexOf(token);
    if (start === -1) continue;
    if (range || text.indexOf(token, start + token.length) !== -1) return undefined;
    range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + token.length);
  }
  return range;
}

function selectRange(editor: HTMLElement, range: Range, collapse: boolean): void {
  const selection = window.getSelection();
  if (!selection) throw new Error("The X editor selection is unavailable.");
  editor.focus({ preventScroll: true });
  if (collapse) range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function mediaBlocks(editor: HTMLElement): HTMLElement[] {
  return Array.from(editor.querySelectorAll<HTMLElement>(`${blockSelector}[contenteditable="false"]`))
    .filter((block) => block.querySelector("img[src], picture img"));
}

function blockKey(block: HTMLElement): string | HTMLElement {
  return block.getAttribute("data-offset-key") ||
    block.closest<HTMLElement>("[data-offset-key]")?.getAttribute("data-offset-key") ||
    block;
}

function isAtMarker(editor: HTMLElement, media: HTMLElement, token: string): boolean {
  const markerBlock = markerRange(editor, token)?.startContainer.parentElement?.closest(blockSelector);
  if (!markerBlock) return false;
  const blocks = Array.from(editor.querySelectorAll<HTMLElement>(blockSelector))
    .filter((block) => block === markerBlock || block === media || block.textContent?.trim() || block.querySelector("img"));
  const distance = blocks.indexOf(markerBlock as HTMLElement) - blocks.indexOf(media);
  // X can put media just after an otherwise empty marker block.
  return distance === 1 || (distance === -1 && markerBlock.textContent?.trim() === token);
}

async function loadFile(image: XArticleImage): Promise<File> {
  const url = notesImageUrl(image.url);
  if (!url) throw new Error("The image is outside the Notes image library.");
  const result = await chrome.runtime.sendMessage({ type: "notes-article-image", url });
  const extension = result.type ? imageExtensions.get(result.type) : undefined;
  if (!extension || !result.base64) {
    throw new Error(result.error || "Notes did not return an image.");
  }
  const bytes = Uint8Array.from(atob(result.base64), (character) => character.charCodeAt(0));
  return new File([bytes], `notes-image-${image.number}.${extension}`, { type: result.type });
}

function visibleDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(dialogSelector)).filter(isVisible);
}

function fileInputs(root: ParentNode): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]:not(:disabled)'));
}

async function insertImage(job: ImportJob, image: XArticleImage, file: File): Promise<void> {
  const { editor } = job;
  const anchor = markerRange(editor, image.marker);
  const insertButton = findButton(document, insertNames);
  if (!anchor || !insertButton || visibleDialogs().length > 0) {
    throw new Error("X's Insert control or the image marker could not be located.");
  }

  const existing = new Set(mediaBlocks(editor).map(blockKey));
  const addedMedia = () => {
    const added = mediaBlocks(editor).filter((block) => !existing.has(blockKey(block)));
    return added.length === 1 ? added[0] : undefined;
  };
  anchor.startContainer.parentElement?.scrollIntoView({ block: "nearest" });
  selectRange(editor, anchor, true);
  // Let Draft.js synchronize its selection before focusing the toolbar.
  await new Promise((resolve) => setTimeout(resolve, 60));
  ensureCurrent(job);
  const selection = window.getSelection();
  if (!selection?.isCollapsed || selection.anchorNode !== anchor.startContainer ||
    selection.anchorOffset !== anchor.startOffset) {
    throw new Error("The caret moved before the image could be placed.");
  }
  insertButton.click();
  const mediaButton = await waitFor(job, () => findButton(document, mediaNames), "X's Media menu did not open.");
  const existingInputs = new Set(fileInputs(document));
  mediaButton.click();

  const input = await waitFor(job, () => {
    const dialogs = visibleDialogs();
    if (dialogs.length !== 1) return undefined;
    const inputs = fileInputs(dialogs[0]);
    const preferred = inputs.filter((candidate) => candidate.dataset.testid === "fileInput");
    if (preferred.length === 1) return preferred[0];
    if (inputs.length > 0) return inputs.length === 1 ? inputs[0] : undefined;
    // A portal may mount the media input outside the dialog. Ignore pre-existing inputs, such as the cover picker.
    const portal = fileInputs(document).filter((candidate) =>
      !existingInputs.has(candidate) && candidate.dataset.testid === "fileInput",
    );
    return portal.length === 1 ? portal[0] : undefined;
  }, "X's media dialog did not expose an image picker.");

  const fileList = new DataTransfer();
  fileList.items.add(file);
  input.files = fileList.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const next = await waitFor(job, () => {
    const block = addedMedia();
    if (block) return { block };
    const dialogs = visibleDialogs();
    if (dialogs.length !== 1) return undefined;
    const apply = findButton(dialogs[0], applyNames);
    return apply ? { apply } : undefined;
  }, "X did not confirm the image.", 30_000);
  next.apply?.click();

  await waitFor(job, () => {
    const media = addedMedia();
    return media && visibleDialogs().length === 0 && isAtMarker(editor, media, image.marker)
      ? media
      : undefined;
  }, "X did not confirm the image at its marker.", 30_000);

  const marker = markerRange(editor, image.marker);
  if (!marker) throw new Error("The image marker moved before it could be removed.");
  selectRange(editor, marker, false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  ensureCurrent(job);
  if (window.getSelection()?.toString() !== image.marker || !document.execCommand("delete")) {
    throw new Error("The image is in the draft. Its marker still needs to be removed.");
  }
  await waitFor(job, () => !editor.textContent?.includes(image.marker) ? true : undefined,
    "The image is in the draft. Its marker still needs to be removed.");
}

function openStatus(controller: AbortController) {
  document.getElementById("notes-x-article-paste-status")?.remove();
  const panel = document.createElement("div");
  panel.id = "notes-x-article-paste-status";
  const message = document.createElement("span");
  message.setAttribute("role", "status");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Stop";
  button.addEventListener("click", () => {
    if (button.textContent === "Close") panel.remove();
    else controller.abort();
  });
  panel.append(message, button);
  document.body.append(panel);
  return {
    show(text: string) { message.textContent = text; },
    finish(text: string) { message.textContent = text; button.textContent = "Close"; },
  };
}

function readRichNote(html: string, imageMarker: (number: number) => string) {
  if (!html.includes("data-notes-x-image-url=")) return undefined;
  const template = document.createElement("template");
  try {
    template.innerHTML = html;
  } catch {
    return undefined;
  }

  const images: XArticleImage[] = [];
  for (const slot of template.content.querySelectorAll("span[data-notes-x-image-url]")) {
    const number = images.length + 1;
    const url = slot.getAttribute("data-notes-x-image-url");
    if (!url || slot.textContent !== formatXArticleImageMarker(number)) return undefined;
    const marker = imageMarker(number);
    images.push({ number, marker, url, alt: "" });
    slot.replaceWith(marker);
  }

  return { html: template.innerHTML, markdown: template.content.textContent?.trim() ?? "", images };
}

async function pasteNote(job: ImportJob, note: ReturnType<typeof buildXArticleClipboard>): Promise<void> {
  const status = openStatus(job.controller);
  let inserted = 0;
  const skipped: number[] = [];

  try {
    status.show("Pasting the Notes article…");
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", note.html);
    clipboard.setData("text/plain", note.markdown);
    job.editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));

    await waitFor(job, () => note.images.every(({ marker }) => markerRange(job.editor, marker)) ? true : undefined,
      "X did not accept the formatted paste. Your clipboard still contains the note.");

    for (const image of note.images) {
      ensureCurrent(job);
      status.show(`Placing image ${image.number} of ${note.images.length}…`);
      let file: File;
      try {
        file = await loadFile(image);
      } catch {
        skipped.push(image.number);
        continue;
      }
      ensureCurrent(job);
      await insertImage(job, image, file);
      inserted++;
    }

    status.finish(skipped.length > 0
      ? `Placed ${inserted} of ${note.images.length} images. Unavailable images: ${skipped.join(", ")}. Their markers are still in the draft.`
      : `Placed all ${inserted} images. Review the X draft before publishing.`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Import stopped.";
    status.finish(`Placed ${inserted} of ${note.images.length} images. ${detail}`);
  } finally {
    if (runningJob === job) runningJob = null;
  }
}

document.addEventListener("paste", (event) => {
  const target = event.target;
  if (!event.isTrusted || !isArticleComposer(location.pathname) || !(target instanceof HTMLElement)) return;
  const editor = target.closest<HTMLElement>(editorSelector);
  if (!editor || event.defaultPrevented || !event.clipboardData) return;
  const html = event.clipboardData.getData("text/html");
  const markdown = event.clipboardData.getData("text/plain");
  if (html ? !html.includes("data-notes-x-image-url=") : !markdown.includes("/images/") || !markdown.includes("![")) return;

  const token = crypto.randomUUID().slice(0, 8);
  const marker = (number: number) => `【图片 ${number} · ${token}】`;
  const note = html ? readRichNote(html, marker) : buildXArticleClipboard(markdown, notesOrigin, marker);
  if (!note?.images.some(({ url }) => notesImageUrl(url))) return;

  if (runningJob) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  const job = { editor, url: location.href, controller: new AbortController() };
  runningJob = job;
  void pasteNote(job, note);
}, true);

function stopOnEditorInteraction(event: Event): void {
  if (event.isTrusted && runningJob && event.target instanceof Node && runningJob.editor.contains(event.target)) {
    runningJob.controller.abort();
  }
}

document.addEventListener("pointerdown", stopOnEditorInteraction, true);
document.addEventListener("keydown", stopOnEditorInteraction, true);
