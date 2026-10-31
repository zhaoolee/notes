import assert from "node:assert/strict";
import test from "node:test";
import { collectEditorImagePreviews } from "../../src/lib/editor-images.js";
import {
  EditorImageUploadSession,
  splitEditorContentWithUploads,
  type EditorImageUpload,
} from "../../src/lib/editor-image-uploads.js";
import type { ImageImportOptions } from "../../src/lib/images.js";
import type { ImageImportResult } from "../../src/types/app.js";

function harness(markdown = "") {
  let uploads: EditorImageUpload[] = [];
  let saved = markdown;
  let active = 0;
  let maxActive = 0;
  const requests: Array<{
    source: string;
    options: ImageImportOptions;
    succeed: () => void;
    fail: () => void;
    done: boolean;
  }> = [];
  const session = new EditorImageUploadSession(markdown, (next) => { saved = next; }, (next) => { uploads = next; },
    (source, options) => new Promise((resolve, reject) => {
      active++;
      maxActive = Math.max(active, maxActive);
      const finish = (error?: Error) => {
        if (request.done) return;
        request.done = true;
        active--;
        if (error) reject(error);
        else resolve({ path: `/images/${source}.png`, url: "", hash: "", extension: "png" } satisfies ImageImportResult);
      };
      const request = { source: String(source), options, succeed: () => finish(), fail: () => finish(new Error("服务端拒绝图片")), done: false };
      requests.push(request);
      options.signal?.addEventListener("abort", () => finish(new DOMException("已取消", "AbortError")), { once: true });
    }));
  return { session, requests, uploads: () => uploads, saved: () => saved, maxActive: () => maxActive };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("100 张图片共享 5 个并发槽位，乱序完成后仍按原顺序插入", async () => {
  const h = harness();
  h.session.enqueue(Array.from({ length: 100 }, (_, index) => String(index)), 0);
  assert.equal(h.requests.length, 5);
  assert.equal(h.uploads().filter((item) => item.status === "queued").length, 95);
  assert.equal(h.saved(), "", "占位不可写入便签存储");
  while (h.uploads().length) {
    [...h.requests].reverse().find((request) => !request.done)!.succeed();
    await flush();
  }
  assert.equal(h.maxActive(), 5);
  assert.deepEqual(collectEditorImagePreviews(h.saved()).map((image) => image.source),
    Array.from({ length: 100 }, (_, index) => `/images/${index}.png`));
});

test("追加批次共用队列；失败不阻塞其他图片，重试仍插回原位置", async () => {
  const h = harness("正文");
  h.session.enqueue(["a", "b", "c", "d", "e", "f"], 2);
  h.session.enqueue(["g", "h"], 2);
  assert.equal(h.requests.length, 5);
  h.requests[1].options.onProgress?.(47);
  assert.equal(h.uploads().find((item) => item.id === 2)?.progress, 47);
  h.requests[1].fail();
  await flush();
  assert.equal(h.requests.length, 6);
  assert.equal(h.uploads().find((item) => item.id === 2)?.status, "failed");
  assert.equal(h.uploads().find((item) => item.id === 2)?.error, "服务端拒绝图片");
  h.session.editMarkdown(`新文字${h.session.markdown}`);
  h.session.editMarkdown(`${h.session.markdown}结尾`, new Set(h.uploads().map((item) => item.id)));
  while (h.requests.some((request) => !request.done)) {
    h.requests.find((request) => !request.done)!.succeed();
    await flush();
  }
  h.session.retry(2);
  h.requests.at(-1)!.succeed();
  await flush();
  assert.equal(h.maxActive(), 5);
  assert.match(h.saved(), /^新文字正文/);
  assert.match(h.saved(), /结尾$/);
  assert.deepEqual(collectEditorImagePreviews(h.saved()).map((image) => image.source),
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => `/images/${id}.png`));
});

test("上传期间的正文编辑与独立插入位置不会被旧快照覆盖", async () => {
  const h = harness("前文\n后文");
  h.session.enqueue(["first", "second"], 3);
  h.session.editMarkdown("新增\n前文\n后文");
  h.session.editMarkdown("新增\n前文\n后文继续编辑");
  h.session.enqueue(["top"], 0);
  h.requests[1].succeed();
  await flush();
  h.requests[2].succeed();
  await flush();
  h.requests[0].succeed();
  await flush();
  assert.equal(h.saved(), "![](/images/top.png)\n新增\n前文\n![](/images/first.png)\n![](/images/second.png)\n后文继续编辑");
});

test("移除排队和在途图片、切换便签清理后，旧请求不能回写正文", async () => {
  const h = harness("保留正文");
  h.session.enqueue(["a", "b", "c", "d", "e", "queued"], 4);
  h.session.cancel(6);
  h.session.cancel(1);
  await flush();
  assert.equal(h.requests.length, 5, "取消排队项不能启动请求");
  assert.equal(h.requests[0].options.signal?.aborted, true);
  h.session.dispose();
  await flush();
  for (const request of h.requests) {
    assert.equal(request.options.signal?.aborted, true);
    request.succeed();
  }
  await flush();
  assert.equal(h.saved(), "保留正文");
  assert.deepEqual(h.session.getUploads(), []);
});

test("占位嵌入正文原位置，保留所有文本和正式图片标记", () => {
  const h = harness("前文\n![](/images/existing.png)\n后文");
  h.session.enqueue(["a", "b"], 3);
  const blocks = splitEditorContentWithUploads(h.session.markdown, h.uploads());
  assert.deepEqual(blocks.filter((block) => block.kind === "upload").map((block) => block.upload.id), [1, 2]);
  assert.equal(blocks.map((block) => block.kind === "text" ? block.text : block.kind === "image"
    ? h.session.markdown.slice(block.markerStart, block.markerEnd) : "").join(""), h.session.markdown);
  assert.equal(blocks.findIndex((block) => block.kind === "upload"), 1);
  h.session.dispose();
});

test("占位两侧文本相同时，使用实际编辑段落消除插入位置歧义", async () => {
  const h = harness("相同文字");
  h.session.enqueue(["a", "b"], 0);
  // The empty segment before the uploads, followed by the existing text.
  h.session.editMarkdown("相同文字相同文字", new Set(), { start: 0, end: 0 });
  assert.deepEqual(h.uploads().map((item) => item.offset), [4, 4]);
  // Replace only the trailing text segment, preserving text before uploads.
  h.session.editMarkdown("相同文字图片后文字", new Set([1, 2]), { start: 4, end: 8 });
  h.requests[1].succeed();
  await flush();
  h.requests[0].succeed();
  await flush();
  assert.equal(h.saved(), "相同文字\n![](/images/a.png)\n![](/images/b.png)\n图片后文字");
});
