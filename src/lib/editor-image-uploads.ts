import { collectEditorImagePreviews, splitEditorContent, type EditorContentBlock } from "./editor-images.js";
import { importImageFile, importImageUrl, type ImageImportOptions } from "./images.js";
import type { ImageImportResult } from "../types/app.js";

export const IMAGE_UPLOAD_CONCURRENCY = 5;

export interface EditorImageUpload {
  id: number;
  offset: number;
  source: File | string;
  previewUrl: string | null;
  status: "queued" | "uploading" | "failed";
  progress: number;
  error: string;
}

export interface EditorUploadBlock {
  kind: "upload";
  upload: EditorImageUpload;
}

// Pending images live outside Markdown, so autosave/export never persist blob URLs
// or temporary upload markers. Anchors move with edits to the real document.
interface EditRange { start: number; end: number }

function findEdit(before: string, after: string, range?: EditRange) {
  let start = range?.start ?? 0;
  let oldEnd = range?.end ?? before.length;
  let newEnd = oldEnd + after.length - before.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { start, oldEnd, newEnd };
}

function mapEditedOffset(offset: number, { start, oldEnd, newEnd }: ReturnType<typeof findEdit>, keepBefore: boolean) {
  if (offset < start) return offset;
  if (offset === start && keepBefore) return offset;
  if (offset >= oldEnd) return offset + newEnd - oldEnd;
  return newEnd;
}

export function splitEditorContentWithUploads(
  markdown: string,
  uploads: EditorImageUpload[],
): Array<EditorContentBlock | EditorUploadBlock> {
  const pending = [...uploads].sort((a, b) => a.offset - b.offset || a.id - b.id);
  const result: Array<EditorContentBlock | EditorUploadBlock> = [];
  for (const block of splitEditorContent(markdown)) {
    if (block.kind !== "text") {
      result.push(block);
      continue;
    }
    let start = block.start;
    while (pending.length && pending[0].offset <= block.end) {
      const upload = pending.shift()!;
      const offset = Math.max(start, upload.offset);
      result.push({ kind: "text", start, end: offset, text: markdown.slice(start, offset) });
      result.push({ kind: "upload", upload });
      start = offset;
    }
    result.push({ ...block, start, text: markdown.slice(start, block.end) });
  }
  return result;
}

type Importer = (source: File | string, options: ImageImportOptions) => Promise<ImageImportResult>;
const defaultImporter: Importer = (source, options) => typeof source === "string"
  ? importImageUrl(source, options) : importImageFile(source, options);

export class EditorImageUploadSession {
  markdown: string;
  private items: EditorImageUpload[] = [];
  private nextId = 0;
  private active = new Map<number, AbortController>();

  constructor(
    markdown: string,
    private onMarkdown: (markdown: string) => void,
    private onUpdate: (uploads: EditorImageUpload[]) => void,
    private importer: Importer = defaultImporter,
  ) { this.markdown = markdown; }

  updateHandlers(onMarkdown: (markdown: string) => void): void { this.onMarkdown = onMarkdown; }
  getUploads(): EditorImageUpload[] { return [...this.items]; }

  syncMarkdown(next: string, keepBeforeIds = new Set<number>(), range?: EditRange): void {
    if (next === this.markdown) return;
    if (!this.items.length) { this.markdown = next; return; }
    const edit = findEdit(this.markdown, next, range);
    const images = collectEditorImagePreviews(next);
    this.items = this.items.map((item) => {
      let offset = mapEditedOffset(item.offset, edit, keepBeforeIds.has(item.id));
      // An external replacement can cross image markers. Keep placeholders at
      // valid text boundaries rather than splitting a persisted image's source.
      const image = images.find((image) => offset > image.markerStart && offset < image.markerEnd);
      if (image) offset = image.markerEnd;
      return { ...item, offset };
    });
    this.markdown = next;
    this.publish();
  }

  editMarkdown(next: string, keepBeforeIds?: Set<number>, range?: EditRange): void {
    this.syncMarkdown(next, keepBeforeIds, range);
    this.onMarkdown(next);
  }

  enqueue(sources: Array<File | string>, offset: number): void {
    const safeOffset = Math.max(0, Math.min(this.markdown.length, offset));
    this.items.push(...sources.map((source): EditorImageUpload => ({
      id: ++this.nextId, offset: safeOffset, source,
      previewUrl: typeof source === "string" ? null : URL.createObjectURL(source),
      status: "queued", progress: 0, error: "",
    })));
    this.publish();
    this.pump();
  }

  retry(id: number): void {
    this.items = this.items.map((item) => item.id === id && item.status === "failed"
      ? { ...item, status: "queued", error: "", progress: 0 } : item);
    this.publish();
    this.pump();
  }

  cancel(id: number): void {
    const item = this.items.find((item) => item.id === id);
    if (!item) return;
    this.items = this.items.filter((item) => item.id !== id);
    this.release(item);
    this.active.get(id)?.abort();
    this.publish();
    this.pump();
  }

  dispose(): void {
    for (const controller of this.active.values()) controller.abort();
    for (const item of this.items) this.release(item);
    this.items = [];
    // Keep requests in active until their promises settle, including StrictMode
    // cleanup/re-setup, so the concurrency bound also covers cancelled requests.
  }

  private publish(): void { this.onUpdate([...this.items]); }
  private release(item: EditorImageUpload): void {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  private pump(): void {
    for (const item of this.items) {
      if (this.active.size >= IMAGE_UPLOAD_CONCURRENCY) break;
      if (item.status !== "queued") continue;
      const controller = new AbortController();
      this.active.set(item.id, controller);
      item.status = "uploading";
      this.publish();
      void this.run(item, controller);
    }
  }

  private async run(item: EditorImageUpload, controller: AbortController): Promise<void> {
    try {
      const result = await this.importer(item.source, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          const current = this.items.find((entry) => entry.id === item.id);
          if (current && current.progress !== progress) {
            current.progress = progress;
            this.publish();
          }
        },
      });
      const current = this.items.find((entry) => entry.id === item.id);
      if (!current || controller.signal.aborted) return;
      const imageUrl = result.path || result.url;
      if (!imageUrl) throw new Error("图片上传未返回有效地址，请重试。");
      const before = this.markdown.slice(0, current.offset);
      const after = this.markdown.slice(current.offset);
      const imageMarkdown = `![](${imageUrl})`;
      const inserted = `${before && !before.endsWith("\n") ? "\n" : ""}${imageMarkdown}${after && !after.startsWith("\n") ? "\n" : ""}`;
      const offset = current.offset;
      this.items = this.items.filter((entry) => entry.id !== item.id).map((entry) => ({
        ...entry,
        offset: entry.offset > offset || (entry.offset === offset && entry.id > current.id)
          ? entry.offset + inserted.length : entry.offset,
      }));
      this.markdown = `${before}${inserted}${after}`;
      this.release(current);
      this.onMarkdown(this.markdown);
    } catch (error) {
      const current = this.items.find((entry) => entry.id === item.id);
      if (current && !controller.signal.aborted) {
        current.status = "failed";
        current.error = error instanceof Error ? error.message : "图片上传失败，请重试。";
      }
    } finally {
      this.active.delete(item.id);
      if (this.items.length || !controller.signal.aborted) this.publish();
      this.pump();
    }
  }
}
