// Run after npm run build. All uploads and workspace data are isolated test data.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const output = await fs.mkdtemp(path.join(os.tmpdir(), "notes-upload-browser-"));
const png = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#d7b58b" } }).png().toBuffer();
const requests = [];
const active = new Set();
let peak = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/images/import") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const filename = Buffer.concat(chunks).toString("latin1").match(/filename="([^"]+)"/)?.[1];
    const entry = { filename, res, done: false };
    requests.push(entry);
    active.add(entry);
    peak = Math.max(peak, active.size);
    res.on("close", () => { active.delete(entry); entry.done = true; });
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ user: null, requireLogin: false, available: false }));
    return;
  }
  if (url.pathname.startsWith("/images/")) { res.setHeader("Content-Type", "image/png"); res.end(png); return; }
  try {
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filename = path.resolve(root, "dist", relative);
    if (!filename.startsWith(path.join(root, "dist") + path.sep)) throw new Error("Invalid path");
    const content = await fs.readFile(filename);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2" };
    res.setHeader("Content-Type", types[path.extname(filename)] ?? "application/octet-stream");
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function until(condition) {
  const deadline = Date.now() + 15_000;
  while (!condition()) { if (Date.now() > deadline) throw new Error("Timed out waiting for upload requests"); await tick(); }
}
function finish(entry, fail = false) {
  active.delete(entry);
  entry.done = true;
  entry.res.writeHead(fail ? 500 : 200, { "Content-Type": "application/json" });
  entry.res.end(JSON.stringify(fail ? { error: "图片上传测试失败，可重试" } : {
    path: `/images/${entry.filename}`, url: "", hash: "test", extension: "png",
  }));
}
let browser;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    const now = Date.now();
    const note = (id, markdown) => ({ id, markdown, createdAt: now, updatedAt: now, normalOrder: 0, pinnedAt: null, folderId: null, isStarred: false, deletedAt: null });
    localStorage.setItem("notes.workspace.v1", JSON.stringify({ version: 1, activeNoteId: "upload", folders: [], notes: [note("upload", "图片前"), note("other", "切换目标")] }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator("#markdown-editor").waitFor();
  await page.locator("#markdown-editor").focus();
  await page.locator("#markdown-editor").evaluate((element) => { element.setSelectionRange(element.value.length, element.value.length); element.dispatchEvent(new Event("select", { bubbles: true })); });
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    for (let index = 0; index < 100; index++) transfer.items.add(new File([bytes], `batch-${String(index).padStart(3, "0")}.png`, { type: "image/png" }));
    transfer.items.add(new File(["ignored"], "ignore.txt", { type: "text/plain" }));
    document.querySelector(".markdown-editor-frame").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, png.toString("base64"));
  await until(() => requests.length === 5);
  await page.waitForFunction(() => document.querySelectorAll(".editor-image-upload").length === 100);
  assert.equal(await page.locator('[data-upload-state="queued"]').count(), 95);
  await page.waitForFunction(() => [...document.querySelectorAll(".editor-image-upload progress")].some((progress) => progress.value === 99));
  assert.equal((await page.locator(".editor-image-upload").first().boundingBox()).height > 120, true);
  await page.locator(".editor-text-segment").first().fill("图片前继续编辑");
  await page.locator(".editor-text-segment").last().fill("图片后继续编辑");
  await page.locator(".editor-text-segment").first().focus();
  await page.locator(".editor-text-segment").first().evaluate((element) => { element.setSelectionRange(element.value.length, element.value.length); element.dispatchEvent(new Event("select", { bubbles: true })); });
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles([100, 101].map((index) => ({ name: `batch-${index}.png`, mimeType: "image/png", buffer: png })));
  assert.equal(await page.locator(".editor-image-upload").count(), 102);
  await page.locator(".markdown-editor-flow").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "desktop-queued.png") });
  const failed = requests.find((entry) => entry.filename === "batch-001.png");
  finish(failed, true);
  await page.locator('[data-upload-state="failed"]').waitFor();
  await until(() => requests.length === 6);
  const savedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("notes.workspace.v1")));
  assert.equal(savedBefore.notes.find((note) => note.id === "upload").markdown, "图片前继续编辑图片后继续编辑");
  while (requests.length < 102 || active.size) {
    const entry = [...active].at(-1);
    if (entry) finish(entry);
    await tick();
  }
  await page.locator('[data-upload-state="failed"]').getByRole("button", { name: "重试" }).click();
  await until(() => active.size === 1);
  finish([...active][0]);
  await page.waitForFunction(() => document.querySelectorAll(".editor-image-upload").length === 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("notes.workspace.v1")).notes.find((note) => note.id === "upload").markdown);
  assert.match(saved, /^图片前继续编辑\n/);
  assert.match(saved, /图片后继续编辑$/);
  assert.deepEqual([...saved.matchAll(/!\[\]\(\/images\/([^)]+)\)/g)].map((match) => match[1]),
    Array.from({ length: 102 }, (_, index) => `batch-${String(index).padStart(3, "0")}.png`));
  assert.equal(peak, 5);
  await page.setViewportSize({ width: 390, height: 844 });
  // Enter the note from the mobile list, then switch its preview to editing.
  if (await page.locator(".note-list-item.active").isVisible()) {
    await page.locator(".note-list-item.active").click();
  }
  const edit = page.getByRole("button", { name: "切换到 Markdown 编辑", exact: true });
  if (await edit.isVisible()) await edit.click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "mobile.png", mimeType: "image/png", buffer: png });
  await until(() => active.size === 1);
  await page.locator(".editor-image-upload").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile-upload.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator(".editor-image-upload").getByRole("button", { name: "取消" }).click();
  await until(() => active.size === 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: "switch.png", mimeType: "image/png", buffer: png });
  await until(() => active.size === 1);
  await page.locator(".note-list-item").filter({ hasText: "切换目标" }).click();
  await until(() => active.size === 0);
  assert.equal(await page.locator(".editor-image-upload").count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, images: 102, maxConcurrentRequests: peak, screenshots: output }));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
