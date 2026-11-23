import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { preview } from "vite";
import { notesOrigin } from "../chrome-x-article/media.js";

const extension = fileURLToPath(new URL("../dist-x-article-extension", import.meta.url));
const editorFixture = await readFile(new URL("../chrome-x-article/tests/editor.html", import.meta.url), "utf8");
const png = await readFile(new URL("../public/header/logo.png", import.meta.url));
const draft = "https://x.com/compose/articles/fixture";
const producer = process.env.NOTES_EXTENSION_PRODUCER;
const previewServer = producer === "local"
  ? await preview({ preview: { host: "127.0.0.1", port: 0, strictPort: true } })
  : null;
const producerOrigin = previewServer
  ? "http://127.0.0.1:" + previewServer.httpServer.address().port
  : producer === "production" ? notesOrigin : null;
const fixtureId = "chrome-extension-copy-fixture";
const first = `![First](${notesOrigin}/images/first.png)`;
const second = `![Second](${notesOrigin}/images/second.png)`;
const article = `# Clipboard heading\n\n**before** ${first} after\n\n${second}\n\nLast paragraph`;
const images = [];
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

try {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(draft).origin });
  if (producerOrigin) {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: producerOrigin });
    await context.addInitScript(({ origin, id, markdown }) => {
      if (location.origin !== origin) return;
      localStorage.setItem("notes.workspace.v1", JSON.stringify({
        version: 1, activeNoteId: id, folders: [],
        notes: [{
          id, markdown, createdAt: 1, updatedAt: 1, normalOrder: 1,
          pinnedAt: null, folderId: null, isStarred: false, deletedAt: null,
        }],
      }));
    }, {
      origin: producerOrigin, id: fixtureId,
      markdown: producer === "production" ? article.replaceAll(notesOrigin, "") : article,
    });
  }
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.href === draft || url.href === "https://x.com/home") {
      await route.fulfill({ contentType: "text/html", body: editorFixture });
    } else if (url.origin === notesOrigin && ["/images/first.png", "/images/second.png", "/images/missing.png"].includes(url.pathname)) {
      if (route.request().serviceWorker()) images.push(url.pathname);
      const index = url.pathname === "/images/first.png" ? 1 : 2;
      await route.fulfill(url.pathname === "/images/missing.png"
        ? { status: 404 }
        : { contentType: "image/png", body: Buffer.concat([png, Buffer.from([index])]) });
    } else if (producerOrigin && url.origin === producerOrigin && route.request().method() === "GET") {
      if (producer === "local" && url.pathname.startsWith("/api/")) {
        await route.fulfill({ json: { requireLogin: false, user: null } });
      } else {
        await route.continue();
      }
    } else {
      await route.abort();
    }
  });

  const page = context.pages()[0];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (producerOrigin) {
    await page.goto(producerOrigin + "/#note=" + fixtureId + "&view=preview");
    await page.getByRole("button", { name: "打开分享与导出", exact: true }).click();
    await page.getByRole("button", { name: "复制到 X 文章", exact: true }).click();
    const photos = page.getByRole("dialog", { name: "正文已复制" });
    await photos.waitFor();
    assert.equal(await photos.getByRole("button", { name: "保存图片 1", exact: true }).count(), 1);
    const clipboard = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return {
        html: await (await item.getType("text/html")).text(),
        text: await (await item.getType("text/plain")).text(),
      };
    });
    assert.ok(clipboard.html.includes(`data-notes-x-image-url="${notesOrigin}/images/first.png"`));
    assert.ok(clipboard.html.includes(`data-notes-x-image-url="${notesOrigin}/images/second.png"`));
    assert.match(clipboard.text, /【图片 1】[\s\S]*【图片 2】/);
  }
  await page.goto(draft);
  await page.bringToFront();
  const editor = page.getByRole("textbox", { name: "Article body" });
  const paste = async (markdown, target = editor) => {
    await page.evaluate((value) => navigator.clipboard.writeText(value), markdown);
    await target.focus();
    await page.keyboard.press("ControlOrMeta+v");
  };

  if (producerOrigin) {
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+v");
  } else {
    await paste(article);
  }

  const status = page.locator("#notes-x-article-paste-status");
  await status.getByText(/Placed all 2 images/).waitFor();
  await paste(first, page.getByRole("textbox", { name: "Title" }));
  assert.equal(await page.getByRole("textbox", { name: "Title" }).inputValue(), first);
  assert.equal(await editor.locator("h1").textContent(), "Clipboard heading");
  assert.equal(await editor.locator("strong").textContent(), "before");
  assert.deepEqual(images, ["/images/first.png", "/images/second.png"]);
  assert.deepEqual(await editor.locator("section").evaluateAll((elements) => elements.map(
    (element) => [element.dataset.filename, element.dataset.tailByte],
  )), [["notes-image-1.png", "1"], ["notes-image-2.png", "2"]]);
  assert.match(await editor.innerHTML(), /Existing draft text[\s\S]*before[\s\S]*notes-image-1\.png[\s\S]*after[\s\S]*notes-image-2\.png[\s\S]*Last paragraph/);
  assert.doesNotMatch(await editor.textContent(), /【图片/);
  assert.equal(await page.locator("body").getAttribute("data-published"), null);
  assert.equal(await page.locator("body").getAttribute("data-cover-changed"), null);

  await paste(`![Missing](/images/missing.png)\n\n${first}\n\n${first}`);
  await status.getByText(/Placed 2 of 3 images/).waitFor();
  assert.match(await editor.textContent(), /【图片 1 · [a-f0-9]{8}】/);
  assert.equal(await editor.locator("section").count(), 4);
  assert.equal(await page.locator("body").getAttribute("data-published"), null);

  await page.goto("https://x.com/home");
  await paste(first, page.getByRole("textbox", { name: "Article body" }));
  assert.match(await page.getByRole("textbox", { name: "Article body" }).textContent(), /!\[First\]/);
  assert.equal(await status.count(), 0);
  assert.deepEqual(errors, []);
  console.log("Chrome extension verified with one trusted paste, ordered inline images, repeat and failure recovery, and composer scoping.");
  if (producerOrigin) console.log(`The ${producer} Notes rich-copy action supplied the actual clipboard payload.`);
} finally {
  await context.close();
  await previewServer?.close();
}
