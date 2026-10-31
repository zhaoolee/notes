// Run after npm run build. Uses a temporary server and isolated browser storage.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";

const dist = path.resolve(import.meta.dirname, "../dist");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ user: null, requireLogin: false, available: false }));
    return;
  }
  if (url.pathname.startsWith("/images/")) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#d7b58b"/></svg>');
    return;
  }
  try {
    const file = path.resolve(dist, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (!file.startsWith(dist + path.sep)) throw new Error("Invalid path");
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2" };
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
const markdown = "图片前的正文\n" + Array.from({ length: 12 }, (_, index) =>
  `![标注 ${index}](/images/repeated.svg)\n第 ${index} 张图片后的正文\n`,
).join("");
let browser;
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((content) => {
    const now = Date.now();
    localStorage.setItem("notes.workspace.v1", JSON.stringify({ version: 1,
      activeNoteId: "input", folders: [], notes: [{ id: "input", markdown: content,
        createdAt: now, updatedAt: now, normalOrder: 0, pinnedAt: null,
        folderId: null, isStarred: false, deletedAt: null }] }));
  }, markdown);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const segments = page.locator("textarea.editor-text-segment");
  await segments.first().waitFor();
  assert.equal(await page.locator(".preview-panel").count(), 0);
  await page.evaluate(() => {
    window.originalEditorImages = [...document.querySelectorAll(".editor-image-main")];
    for (const image of window.originalEditorImages) image.loading = "eager";
  });
  await page.waitForFunction(() => window.originalEditorImages.every((image) => image.naturalWidth > 0));
  await page.waitForFunction(() => [...document.querySelectorAll(".editor-image-block")].every((element) => {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.getPropertyValue("--editor-line-height"));
    const height = element.getBoundingClientRect().height +
      Number.parseFloat(style.marginTop) + Number.parseFloat(style.marginBottom);
    const remainder = height % lineHeight;
    return Math.min(remainder, lineHeight - remainder) < 0.3;
  }));

  // Grow and shrink a segment without leaving stale textarea heights.
  await segments.first().fill("长段落中文内容。".repeat(400));
  const tallHeight = await segments.first().evaluate((element) => element.clientHeight);
  assert.ok(tallHeight > 500);
  await segments.first().fill("图片前的最新正文\n");
  await page.waitForFunction(() => document.querySelector("textarea").clientHeight < 150);

  // Middle and trailing edits retain every occurrence of the same image URL.
  for (const index of [6, 12]) {
    const segment = segments.nth(index);
    await segment.scrollIntoViewIfNeeded();
    await segment.focus();
    await segment.evaluate((element) => element.setSelectionRange(element.value.length, element.value.length));
    const scrollTop = await page.locator(".markdown-editor-flow").evaluate((element) => element.scrollTop);
    await page.keyboard.insertText(`中文输入${index}`);
    assert.ok((await segment.inputValue()).endsWith(`中文输入${index}`));
    const nextScrollTop = await page.locator(".markdown-editor-flow").evaluate((element) => element.scrollTop);
    assert.ok(Math.abs(scrollTop - nextScrollTop) < 2, "输入不能把长文滚动位置重置到顶部");
  }
  assert.equal(await page.evaluate(() => window.originalEditorImages.every((image) => image.isConnected)), true);

  // Image caption edits still update the latest markdown offsets.
  await page.locator(".editor-image-caption").nth(5).fill("更新后的图片标注");
  await page.waitForFunction(() => localStorage.getItem("notes.workspace.v1").includes("更新后的图片标注"));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("notes.workspace.v1")).notes[0].markdown);
  assert.match(saved, /^图片前的最新正文/);
  assert.match(saved, /中文输入6/);
  assert.match(saved, /中文输入12$/);
  assert.equal([...saved.matchAll(/\/images\/repeated\.svg/g)].length, 12);

  await page.getByRole("button", { name: "切换编辑与实时预览", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "实时预览" }).click();
  await page.locator(".preview-panel").waitFor({ state: "visible" });
  assert.match(await page.locator(".preview-panel").innerText(), /图片前的最新正文/);
  assert.match(await page.locator(".preview-panel").innerText(), /中文输入12/);
  assert.equal(await page.locator(".preview-panel .note-image-frame").count(), 12);

  // Crossing the responsive breakpoint must show the correct view immediately.
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator(".note-list-item.active").isVisible()) {
    await page.locator(".note-list-item.active").click();
  }
  const editButton = page.getByRole("button", { name: "切换到 Markdown 编辑", exact: true });
  if (await editButton.isVisible()) await editButton.click();
  await segments.first().waitFor({ state: "visible" });
  assert.equal(await page.locator(".preview-panel").count(), 0);
  await segments.first().fill("手机长段落。".repeat(100));
  await page.waitForFunction(() => [...document.querySelectorAll("textarea.editor-text-segment")]
    .every((element) => element.clientHeight >= element.scrollHeight - 1));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("button", { name: "切换到便签预览", exact: true }).click();
  await page.locator(".preview-panel").waitFor({ state: "visible" });
  assert.match(await page.locator(".preview-panel").innerText(), /手机长段落/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "切换编辑与实时预览", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Markdown 模式" }).click();
  await page.getByRole("button", { name: "打开分享与导出", exact: true }).click();
  await page.locator(".preview-panel").waitFor({ state: "visible" });
  assert.match(await page.locator(".preview-panel").innerText(), /手机长段落/);

  const renderPage = await context.newPage();
  await renderPage.goto(`${base}/?renderMode=playwright`);
  await renderPage.locator(".preview-panel .note-sheet").waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, images: 12, checks: [
    "重复图片节点复用", "文本高度增长与收缩", "中间及末尾中文输入与滚动位置",
    "标注与本地保存", "桌面和手机预览最新正文", "响应式宽度", "分享与导出预览",
  ] }));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
