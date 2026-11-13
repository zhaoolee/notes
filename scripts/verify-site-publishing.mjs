// Run after `npm run build`. Uses an isolated temporary account and data store.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const noOrigin = process.env.SITE_PUBLISH_NO_ORIGIN === "1";
const githubUi = process.env.SITE_PUBLISH_GITHUB_UI === "1";
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "notes-site-browser-"));
const execFileAsync = promisify(execFile);
let browser;
let child;
let staticServer;
const assertions = [];
function check(condition, name) { assert.ok(condition, name); assertions.push(name); }
async function start(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
async function stop(server) {
  if (server?.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
async function freePort() { const server = createServer(); const port = await start(server); await stop(server); return port; }
async function exists(filename) { try { await fs.access(filename); return true; } catch { return false; } }

try {
  await fs.access(path.join(root, "dist/index.html"));
  let publicDirectory = "";
  const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".xml": "application/xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  const missingResources = [];
  staticServer = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!publicDirectory || !pathname.startsWith("/nested/blog/")) throw new Error("outside basePath");
      const relative = pathname.slice("/nested/blog/".length) + (pathname.endsWith("/") ? "index.html" : "");
      const filename = path.resolve(publicDirectory, relative);
      if (!filename.startsWith(`${publicDirectory}${path.sep}`)) throw new Error("outside public directory");
      const buffer = await fs.readFile(filename);
      response.writeHead(200, { "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream" }); response.end(buffer);
    } catch {
      missingResources.push(request.url); response.writeHead(404); response.end("Not found");
    }
  });
  const staticPort = await start(staticServer);
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const imagesDirectory = path.join(temporary, "images");
  await fs.mkdir(imagesDirectory);
  await fs.writeFile(path.join(imagesDirectory, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=", "base64"));
  const customLogoSource = path.join(temporary, "custom-logo.avif");
  await sharp({
    create: { width: 360, height: 200, channels: 4, background: { r: 30, g: 96, b: 145, alpha: 1 } },
  })
    .composite([{ input: Buffer.from('<svg width="180" height="180" xmlns="http://www.w3.org/2000/svg"><circle cx="90" cy="90" r="74" fill="#f8f1df"/><path d="M55 92h70M90 57v70" stroke="#1e608f" stroke-width="16" stroke-linecap="round"/></svg>'), left: 90, top: 10 }])
    .avif({ quality: 80 })
    .toFile(customLogoSource);
  const invalidLogoSource = path.join(temporary, "invalid-logo.svg");
  await fs.writeFile(invalidLogoSource, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  const corruptLogoSource = path.join(temporary, "corrupt-logo.png");
  await fs.writeFile(corruptLogoSource, "This file is not a decodable image.");
  child = spawn(process.execPath, [path.join(root, "dist-server/server/index.js")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_STORAGE_DIR: path.join(temporary, "data"), IMAGE_STORAGE_DIR: imagesDirectory, SUPERADMIN: "hugo-feedback", SUPERADMINPASSWORD: "hugo-feedback-only-password", SESSION_SECRET: "isolated-hugo-browser-test-signing-secret", REQUIRE_LOGIN: "true", OPENAI_API_KEY: "", OPENAI_BASE_URL: "", NOTES_PUBLIC_BASE_URL: baseURL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOutput = "";
  child.stdout.on("data", (chunk) => { serverOutput += chunk; });
  child.stderr.on("data", (chunk) => { serverOutput += chunk; });
  const deadline = Date.now() + 20_000;
  while (true) {
    if (child.exitCode !== null) throw new Error(`Test backend exited: ${serverOutput.slice(-1500)}`);
    try { if ((await fetch(`${baseURL}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error("Test backend health timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check((await fetch(`${baseURL}/api/site-publishing/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 401, "anonymous export rejected");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const login = await context.request.post(`${baseURL}/api/auth/login`, { data: { username: "hugo-feedback", password: "hugo-feedback-only-password" } });
  check(login.ok(), "isolated login works");
  const now = Date.now() - 1000;
  const makeNote = (id, markdown, deletedAt = null) => ({ id, markdown, createdAt: now, updatedAt: now, normalOrder: 0, pinnedAt: null, isStarred: false, folderId: null, deletedAt });
  const notes = [makeNote("selected", "## 示例网站发布\n\n这是用于验证子路径部署的图文便签。\n\n![验证图片](/images/pixel.png)\n\n## 操作步骤\n\n- [x] 选择便签\n- [x] 生成网站\n\n```js\nconsole.log('hello');\n```"), makeNote("private", "## 不公开的便签\n\nPRIVATEONLYMARKER"), makeNote("trash", "## 回收站不可发布\n\nTRASHONLYMARKER", now)];
  const save = await context.request.put(`${baseURL}/api/workspace`, { data: { workspace: { activeNoteId: "selected", version: 1, folders: [], notes } } });
  check(save.ok(), "isolated workspace seeded");
  check((await context.request.post(`${baseURL}/api/site-publishing/export`, { data: {}, headers: { Origin: "https://outside.example.test" } })).status() === 403, "cross-origin export rejected");
  check((await context.request.post(`${baseURL}/api/site-publishing/export`, { data: {} })).status() === 400, "invalid input rejected");
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(baseURL);
  await page.getByRole("button", { name: "账号：hugo-feedback" }).click();
  const menu = page.getByRole("menu");
  const menuText = await menu.innerText();
  check(menuText.indexOf("发布为网站") < menuText.indexOf("进入管理后台"), "menu entry is above admin");
  await page.screenshot({ path: path.join(temporary, "menu.png") });
  await page.getByRole("menuitem", { name: "发布为网站" }).click();
  const panel = page.getByRole("dialog", { name: "生成网站" });
  await panel.waitFor();
  await panel.getByText("已保存到账号", { exact: true }).waitFor();
  const advanced = panel.locator("details.site-publish-advanced");
  check(await advanced.evaluate((element) => element.open) === false, "advanced settings start collapsed");
  check(await panel.getByRole("textbox", { name: /^网站标题/ }).isVisible() === false, "site settings hidden until advanced opens");
  check(await panel.locator(".site-publish-group").count() === 5, "five default categories render as groups");
  for (const category of ["做法", "软件", "硬件", "项目", "杂谈"]) {
    check(await panel.getByRole("button", { name: `为「${category}」添加便签` }).isVisible(), `${category} group has add entry`);
  }
  check(await panel.locator(".site-publish-group-note").count() === 0, "no notes selected implicitly");
  check(await panel.getByRole("button", { name: "生成网站 ZIP" }).isDisabled(), "export disabled before any note is selected");
  await panel.getByRole("button", { name: "关闭网站发布面板" }).focus();
  await page.keyboard.press("Shift+Tab");
  check(await advanced.locator("summary").evaluate((element) => document.activeElement === element), "keyboard skips collapsed advanced fields when wrapping backwards");
  await page.keyboard.press("Tab");
  check(await panel.getByRole("button", { name: "关闭网站发布面板" }).evaluate((element) => document.activeElement === element), "keyboard focus stays inside the collapsed panel");
  check(await panel.locator('input[type="radio"]').count() === 0, "single theme renders no style radio");
  check(!(await panel.innerText()).includes("返回编辑") && !(await panel.innerText()).includes("已选便签（"), "no back-to-editor or legacy selected table");
  check(!(await panel.innerText()).includes("这些信息只写入") && !(await panel.innerText()).includes("最多 200"), "redundant guidance and artificial count limit absent");
  await page.screenshot({ path: path.join(temporary, "panel-default.png") });

  await advanced.locator("summary").click();
  check(await advanced.evaluate((element) => element.open) === true, "advanced settings expands on demand");
  const rootInput = panel.getByRole("textbox", { name: /^部署子路径/ });
  check(await rootInput.inputValue() === "/notes/", "fresh draft defaults to /notes/");
  check((await panel.locator(".site-publish-address").innerText()).includes("部署路径：/notes/"), "fresh default previews /notes/ without a domain");
  await page.screenshot({ path: path.join(temporary, "panel-default-basepath.png") });
  const logoPreview = panel.locator(".site-publish-logo img");
  const logoInput = panel.locator('input[type="file"]');
  check(await logoPreview.getAttribute("src") === "/smartisan/web/smartisan_hammer_footer.png", "default hammer logo preview");
  check(await panel.getByRole("button", { name: "恢复默认", exact: true }).count() === 0, "default logo has no redundant restore action");
  await logoInput.setInputFiles(invalidLogoSource);
  await panel.getByRole("alert").filter({ hasText: /不支持 SVG/ }).waitFor();
  check(await logoPreview.getAttribute("src") === "/smartisan/web/smartisan_hammer_footer.png", "rejected logo keeps previous default");
  await logoInput.setInputFiles(customLogoSource);
  await page.waitForFunction(() => document.querySelector(".site-publish-logo img")?.getAttribute("src")?.startsWith("/images/"), null, { timeout: 15_000 });
  const uploadedLogoSrc = await logoPreview.getAttribute("src");
  check(/^\/images\/[a-f0-9]{64}\.avif$/.test(uploadedLogoSrc ?? ""), "uploaded AVIF logo uses local image path");
  check(await panel.getByRole("button", { name: "恢复默认", exact: true }).isVisible(), "restore action appears for custom logo");
  check(await logoPreview.evaluate((image) => image.complete && image.naturalWidth > 0), "uploaded AVIF logo preview renders");
  await logoInput.setInputFiles(corruptLogoSource);
  await panel.getByRole("alert").filter({ hasText: /原 Logo 保持不变/ }).waitFor();
  check(await logoPreview.getAttribute("src") === uploadedLogoSrc, "undecodable upload preserves previous custom logo");
  await panel.getByRole("button", { name: "恢复默认" }).click();
  check(await logoPreview.getAttribute("src") === "/smartisan/web/smartisan_hammer_footer.png", "restore default logo works");
  check(await panel.getByRole("button", { name: "恢复默认", exact: true }).count() === 0, "restore action disappears after reset");
  await logoInput.setInputFiles(customLogoSource);
  await page.waitForFunction(() => document.querySelector(".site-publish-logo img")?.getAttribute("src")?.startsWith("/images/"), null, { timeout: 15_000 });
  check(await logoPreview.getAttribute("src") === uploadedLogoSrc, "re-upload reuses stable local logo path");
  check(await panel.getByRole("textbox", { name: /^站长名/ }).isVisible(), "author label reads as site owner name");
  await panel.getByRole("textbox", { name: /^网站标题/ }).fill("我的便签网站");
  const domainInput = panel.getByRole("textbox", { name: /^站点域名/ });
  check(await domainInput.inputValue() === "", "optional origin starts empty without example.com");
  if (!noOrigin) {
    await domainInput.fill(`http://127.0.0.1:${staticPort}`);
  }
  await rootInput.fill("/nested/blog");
  const normalizedAddressText = await panel.locator(".site-publish-address").innerText();
  if (noOrigin) {
    check(normalizedAddressText.includes("部署路径：/nested/blog/"), "basePath normalization adds the trailing slash");
  } else {
    check(normalizedAddressText.includes(`http://127.0.0.1:${staticPort}/nested/blog/`), "normalized basePath previews under the domain");
  }
  await rootInput.fill("/blog/");
  const replacedAddressText = await panel.locator(".site-publish-address").innerText();
  check(!replacedAddressText.includes("/notes/blog/") && replacedAddressText.includes("/blog/"), "custom basePath replaces the default /notes/");
  await rootInput.fill("/../invalid");
  check(await panel.getByText(/basePath 只能包含/).count() > 0, "invalid basePath explained");
  await rootInput.fill("/nested/blog/");
  const addressText = await panel.locator(".site-publish-address").innerText();
  if (noOrigin) {
    check(addressText.includes("部署路径：/nested/blog/"), "empty origin previews deployment basePath");
    check(!addressText.includes("example.com"), "empty origin preview has no fake domain");
  } else {
    check(addressText.includes(`http://127.0.0.1:${staticPort}/nested/blog/`), "filled origin previews final address");
  }
  await advanced.locator("summary").click();
  check(await advanced.evaluate((element) => element.open) === false, "advanced settings collapses again");
  await advanced.locator("summary").click();
  check(await domainInput.inputValue() === (noOrigin ? "" : `http://127.0.0.1:${staticPort}`), "collapsed advanced keeps domain value");
  check(await rootInput.inputValue() === "/nested/blog/", "collapsed advanced keeps basePath value");
  check(await panel.getByRole("textbox", { name: /^网站标题/ }).inputValue() === "我的便签网站", "collapsed advanced keeps site title");

  await panel.getByRole("button", { name: "添加分类", exact: true }).click();
  check(await panel.getByRole("textbox", { name: "新分类名称" }).isVisible(), "category add row expands on demand");
  await panel.getByRole("textbox", { name: "新分类名称" }).fill("生活");
  await panel.getByRole("textbox", { name: "分类路径（slug）" }).fill("life");
  const addRowLayout = await panel.locator(".site-publish-category-add").evaluate((add) => {
    const [name, slug] = add.querySelectorAll("input");
    const button = add.querySelector("button");
    const box = (element) => { const rect = element.getBoundingClientRect(); return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) }; };
    return { name: box(name), slug: box(slug), button: box(button) };
  });
  check(Math.abs(addRowLayout.name.right - addRowLayout.slug.left) <= 40 && addRowLayout.button.left > addRowLayout.slug.right, "new category row keeps name, slug and button on one line");
  check(Math.abs((addRowLayout.slug.top + addRowLayout.slug.bottom) / 2 - (addRowLayout.button.top + addRowLayout.button.bottom) / 2) <= 2, "new category button aligns with the inputs");
  await panel.getByRole("button", { name: "创建分类", exact: true }).click();
  check(await panel.locator(".site-publish-group").count() === 6, "new category appears as its own group");
  check(await panel.getByRole("textbox", { name: "新分类名称" }).count() === 0, "category add row closes after creation");
  const guidesGroup = panel.getByRole("article", { name: "做法分类" });
  const lifeGroup = panel.getByRole("article", { name: "生活分类" });
  check(await lifeGroup.getByRole("button", { name: "为「生活」添加便签" }).isVisible(), "new group offers its own add entry");

  await guidesGroup.getByRole("button", { name: "为「做法」添加便签" }).click();
  const guidesPicker = guidesGroup.locator(".site-publish-group-picker");
  check(await panel.locator(".site-publish-group-picker").count() === 1, "only the operated group expands its picker");
  check(await guidesPicker.getByRole("searchbox", { name: /搜索可添加到「做法」的便签/ }).isVisible(), "group picker has its own search");
  check((await guidesPicker.innerText()).includes("回收站不可发布") === false, "trash absent from picker");
  check((await guidesPicker.innerText()).includes("不公开的便签"), "all non-trash notes are available in the picker");
  check(await panel.locator(".site-publish-selected-list").count() === 0, "no separate selected table is rendered");
  await guidesPicker.getByRole("checkbox", { name: /示例网站发布/ }).check();
  await guidesPicker.getByRole("button", { name: "完成", exact: true }).click();
  check(await panel.locator(".site-publish-group-picker").count() === 0, "done closes the picker");
  check(await guidesGroup.locator(".site-publish-group-note").count() === 1, "selected note appears inside its category group");
  check(await guidesGroup.getByRole("button", { name: "从「做法」移除示例网站发布" }).isVisible(), "group note exposes an accessible remove action");

  await lifeGroup.getByRole("button", { name: "为「生活」添加便签" }).click();
  const lifePicker = lifeGroup.locator(".site-publish-group-picker");
  const lifeCheckbox = lifePicker.getByRole("checkbox", { name: /示例网站发布/ });
  check(await lifeCheckbox.isChecked() === false, "note assigned to another group is unchecked here");
  check((await lifePicker.innerText()).includes("原分类：做法"), "picker badges the original category");
  await lifeCheckbox.check();
  await lifePicker.getByRole("button", { name: "完成", exact: true }).click();
  check(await guidesGroup.locator(".site-publish-group-note").count() === 0, "moving a note clears the previous group");
  check(await lifeGroup.locator(".site-publish-group-note").count() === 1, "moved note appears in the target group");
  await lifeGroup.getByRole("button", { name: "从「生活」移除示例网站发布" }).click();
  check(await lifeGroup.locator(".site-publish-group-note").count() === 0, "small remove action empties the group");
  check(await panel.getByRole("button", { name: "生成网站 ZIP" }).isDisabled(), "export disabled after removing the only note");
  await lifeGroup.getByRole("button", { name: "为「生活」添加便签" }).click();
  await lifeGroup.getByRole("checkbox", { name: /示例网站发布/ }).check();
  await lifeGroup.getByRole("button", { name: "完成", exact: true }).click();
  check(await lifeGroup.locator(".site-publish-group-note").count() === 1, "note can be added back to the target group");

  await panel.getByRole("button", { name: "移除分类：生活" }).click();
  check(await panel.getByRole("alert").filter({ hasText: /还有 1 张已选便签/ }).isVisible(), "used category cannot disappear");
  check(await panel.getByText("网站样式", { exact: true }).count() === 0, "single theme hides the site style picker");
  const groupGridLayout = await panel.locator(".site-publish-group-grid").evaluate((grid) => {
    const boxes = Array.from(grid.children).map((element) => element.getBoundingClientRect());
    const firstTop = boxes[0].top;
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      sameRow: boxes.filter((box) => Math.abs(box.top - firstTop) <= 1).length,
    };
  });
  check(groupGridLayout.columns === 2 && groupGridLayout.sameRow === 2, "wide panel shows two category cards per row");
  check(await panel.locator(".site-publish-group-notes").first().evaluate((element) => getComputedStyle(element).overflowY === "visible"), "category note lists have no own scroll box");
  await page.screenshot({ path: path.join(temporary, "panel-desktop.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  check(await panel.getByRole("button", { name: "生成网站 ZIP" }).isVisible(), "mobile export action visible");
  check(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth), "mobile panel has no horizontal overflow");
  check(await panel.locator(".site-publish-body").evaluate((element) => element.scrollHeight > element.clientHeight), "mobile body scrolls independently of footer");
  check(await panel.locator(".site-publish-group-grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length === 1), "narrow panel stacks category cards in one column");
  check(await panel.locator(".site-publish-group-note").first().evaluate((row) => {
    const title = row.querySelector(".site-publish-note-text").getBoundingClientRect();
    const remove = row.querySelector("button").getBoundingClientRect();
    return remove.left > title.right - 1 && Math.abs((title.top + title.bottom) / 2 - (remove.top + remove.bottom) / 2) <= 12;
  }), "compact group row keeps the remove action beside the title");
  await page.screenshot({ path: path.join(temporary, "panel-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "生成网站 ZIP" }).click();
  const download = await downloadPromise;
  const zipPath = path.join(temporary, "notes-hugo-site.zip");
  await download.saveAs(zipPath);
  check(download.suggestedFilename() === "notes-hugo-site.zip", "real authenticated ZIP download");
  await execFileAsync("unzip", ["-q", zipPath, "-d", path.join(temporary, "extracted")]);
  const siteDirectory = path.join(temporary, "extracted/notes-hugo-site");
  publicDirectory = path.join(siteDirectory, "public");
  const staticBaseURL = `http://127.0.0.1:${staticPort}`;
  const hugoConfig = JSON.parse(await fs.readFile(path.join(siteDirectory, "hugo.json"), "utf8"));
  const expectedBaseURL = noOrigin ? "/nested/blog/" : `${staticBaseURL}/nested/blog/`;
  check(hugoConfig.baseURL === expectedBaseURL, `baseURL matches ${noOrigin ? "deployment basePath" : "domain"}`);
  const builtLogoPath = path.join(publicDirectory, "logo.png");
  const builtLogoMetadata = await sharp(builtLogoPath).metadata();
  check(builtLogoMetadata.width === 256 && builtLogoMetadata.height === 256 && builtLogoMetadata.format === "png" && builtLogoMetadata.hasAlpha === true, "custom logo exported as 256x256 transparent PNG");
  check((await fs.readFile(path.join(siteDirectory, "static/logo.png"))).equals(await fs.readFile(builtLogoPath)), "static source uses the same built logo");
  check(!(await fs.readFile(builtLogoPath)).equals(await fs.readFile(customLogoSource)), "custom logo is resized rather than copied as-is");
  const { data: logoPixels, info: logoInfo } = await sharp(builtLogoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  check(logoInfo.channels === 4 && logoPixels[3] === 0, "custom logo letterboxing stays transparent");
  const indexJSON = JSON.parse(await fs.readFile(path.join(publicDirectory, "index.json"), "utf8"));
  check(indexJSON.pages.length === 1 && !JSON.stringify(indexJSON).includes("PRIVATEONLYMARKER"), "export contains only selected note");
  const searchLink = indexJSON.pages[0].permalink;
  check(searchLink.startsWith("/nested/blog/life/") && !/^https?:/.test(searchLink), "search index uses relative basePath link");
  const publishedArticleURL = new URL(searchLink, staticBaseURL).toString();
  check(publishedArticleURL.startsWith(`${staticBaseURL}/nested/blog/life/`), "search index link resolves against static host");
  const homeHtml = await fs.readFile(path.join(publicDirectory, "index.html"), "utf8");
  const readme = await fs.readFile(path.join(siteDirectory, "README.md"), "utf8");
  const logoPath = "/nested/blog/logo.png";
  const logoAttribute = `(?:${logoPath}|"${logoPath}"|'${logoPath}')`;
  check(new RegExp(`<link[^>]+rel=(?:"icon"|'icon'|icon)[^>]+href=${logoAttribute}`).test(homeHtml), "favicon uses generated custom logo at basePath");
  check(new RegExp(`<img[^>]+src=${logoAttribute}[^>]*>`).test(homeHtml), "site brand uses generated custom logo at basePath");
  check(!JSON.stringify(hugoConfig).includes("logoPath") && !homeHtml.includes("/images/"), "generated site has no notes runtime logo dependency");
  check(readme.includes("public/") && readme.includes("/nested/blog/"), "README explains public deployment and basePath");
  check(!/rootpath/i.test(readme), "generated README uses basePath naming");
  const hasCanonical = /<link[^>]+rel=(?:"canonical"|'canonical'|canonical)(?:\s|>)/.test(homeHtml);
  if (noOrigin) {
    check(!hasCanonical && !homeHtml.includes("example.com") && !homeHtml.includes("localhost"), "empty origin omits canonical and fake hosts");
    check(!(await exists(path.join(publicDirectory, "index.xml"))) && !(await exists(path.join(publicDirectory, "sitemap.xml"))), "empty origin omits RSS and sitemap");
    check(!/Sitemap:/i.test(await fs.readFile(path.join(publicDirectory, "robots.txt"), "utf8")), "empty origin robots has no missing sitemap link");
    check(!readme.includes("https://example.com"), "empty origin README has no fake domain");
  } else {
    check(hasCanonical && homeHtml.includes(`${staticBaseURL}/nested/blog/`), "domain mode keeps canonical URL");
    check(await exists(path.join(publicDirectory, "index.xml")) && await exists(path.join(publicDirectory, "sitemap.xml")), "domain mode keeps RSS and sitemap");
  }
  await panel.getByRole("button", { name: "关闭网站发布面板" }).click();
  await panel.waitFor({ state: "detached" });
  check(await panel.count() === 0, "close button dismisses panel");
  await page.getByRole("button", { name: "账号：hugo-feedback" }).click();
  await page.getByRole("menuitem", { name: "发布为网站" }).click();
  await panel.getByText("已保存到账号", { exact: true }).waitFor();
  check(await panel.locator("details.site-publish-advanced").evaluate((element) => element.open) === false, "reopened panel collapses advanced settings");
  check(await panel.locator(".site-publish-group-note").count() === 1, "selected note survives reopening");
  await panel.locator("details.site-publish-advanced > summary").click();
  check(await panel.getByRole("textbox", { name: /^站点域名/ }).inputValue() === (noOrigin ? "" : staticBaseURL), "origin draft survives reopening");
  const reopenedAdvanced = panel.locator("details.site-publish-advanced");
  await reopenedAdvanced.locator("summary").click();
  await reopenedAdvanced.locator("summary").click();
  check(await panel.getByRole("textbox", { name: /^站点域名/ }).inputValue() === (noOrigin ? "" : staticBaseURL), "reopened advanced keeps values after collapse");
  check(await panel.locator(".site-publish-logo img").getAttribute("src") === uploadedLogoSrc, "custom logo survives reopening");
  await panel.getByRole("textbox", { name: /^网站标题/ }).press("Escape");
  await panel.waitFor({state:"detached"});
  check(await panel.count() === 0, "Escape closes panel");
  await page.reload();
  await page.getByRole("button", { name: "账号：hugo-feedback" }).click();
  await page.getByRole("menuitem", { name: "发布为网站" }).click();
  await panel.waitFor();
  await panel.getByText("已保存到账号", { exact: true }).waitFor();
  check(await panel.locator("details.site-publish-advanced").evaluate((element) => element.open) === false, "reloaded panel still defaults to collapsed advanced settings");
  check(await panel.getByRole("article", { name: "生活分类" }).locator(".site-publish-group-note").count() === 1, "category assignment survives page reload");
  await panel.locator("details.site-publish-advanced > summary").click();
  check(await panel.locator(".site-publish-logo img").getAttribute("src") === uploadedLogoSrc, "custom logo survives page reload");
  check(await panel.getByRole("textbox", { name: /^网站标题/ }).inputValue() === "我的便签网站", "site settings survive page reload");
  // A separate browser context has no localStorage or cookies from the first one.
  const otherContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const otherLogin = await otherContext.request.post(`${baseURL}/api/auth/login`, { data: { username: "hugo-feedback", password: "hugo-feedback-only-password" } });
  check(otherLogin.ok(), "second independent browser signs in to same account");
  const otherPage = await otherContext.newPage();
  await otherPage.goto(baseURL);
  await otherPage.getByRole("button", { name: "账号：hugo-feedback" }).click();
  await otherPage.getByRole("menuitem", { name: "发布为网站" }).click();
  const otherPanel = otherPage.getByRole("dialog", { name: "生成网站" });
  await otherPanel.getByText("已保存到账号", { exact: true }).waitFor();
  check(await otherPanel.locator("details.site-publish-advanced").evaluate((element) => element.open) === false, "fresh browser also starts with collapsed advanced settings");
  check(await otherPanel.getByRole("article", { name: "生活分类" }).locator(".site-publish-group-note").count() === 1, "fresh browser restores grouped selection and custom category");
  await otherPanel.locator("details.site-publish-advanced > summary").click();
  check(await otherPanel.locator(".site-publish-logo img").getAttribute("src") === uploadedLogoSrc, "fresh browser restores account logo");
  check(await otherPanel.getByRole("textbox", { name: /^部署子路径/ }).inputValue() === "/nested/blog/", "fresh browser restores deployment path");
  check(await otherPanel.getByRole("textbox", { name: /^站点域名/ }).inputValue() === (noOrigin ? "" : staticBaseURL), "fresh browser restores optional domain");
  await otherPanel.getByRole("textbox", { name: /^网站标题/ }).fill("来自另一浏览器的设置");
  await otherPanel.getByText("已保存到账号", { exact: true }).waitFor();
  await panel.getByRole("textbox", { name: /^网站简介/ }).fill("旧设备的修改");
  await panel.getByText("其他设备更新了设置，请选择保留哪份。", { exact: true }).waitFor();
  const storedConflict = await context.request.get(`${baseURL}/api/site-publishing/config`);
  check((await storedConflict.json()).draft.settings.title === "来自另一浏览器的设置", "stale browser cannot overwrite newer account settings");
  await panel.getByRole("button", { name: "使用账号设置", exact: true }).click();
  check(await panel.getByRole("textbox", { name: /^网站标题/ }).inputValue() === "来自另一浏览器的设置", "conflict resolution applies account settings explicitly");
  await otherContext.close();
  await panel.getByRole("textbox", { name: /^网站标题/ }).press("Escape");
  const workspace = await context.request.get(`${baseURL}/api/workspace`);
  check(JSON.stringify((await workspace.json()).workspace.notes) === JSON.stringify(notes), "export leaves notes and folders unchanged");
  await page.goto(`http://127.0.0.1:${staticPort}/nested/blog/`);
  await page.locator(".home-post-list a").click();
  await page.evaluate(() => document.fonts.ready);
  check(await page.locator("article img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), "published images load at subpath");
  check(await page.locator(".site-brand img").evaluate((image) => image.complete && image.naturalWidth === 256 && image.naturalHeight === 256), "published brand logo loads generated 256x256 image");
  await page.screenshot({ path: path.join(temporary, "website-desktop.png") });
  await page.goto(`http://127.0.0.1:${staticPort}/nested/blog/search/?q=图文`);
  await page.locator("#search-results a").first().waitFor();
  check((await page.locator("#search-results").innerText()).includes("示例网站发布"), "published static search works");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(publishedArticleURL);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "published mobile page has no horizontal overflow");
  await page.screenshot({ path: path.join(temporary, "website-mobile.png") });
  check(missingResources.length === 0, `all generated browser resources load: ${missingResources.join(", ")}`);
  check(consoleErrors.length === 0, `no browser errors: ${consoleErrors.join(", ")}`);
  const screenshots = ["menu.png", "panel-default-basepath.png", "panel-desktop.png", "panel-mobile.png", "website-desktop.png", "website-mobile.png"];
  let simulatedProviderReport = null;
  if (githubUi) {
    // 这一段只验证前端 UI 状态机。所有 GitHub 发布接口都在第一个浏览器上下文里
    // 由内存响应拦截，第二个上下文保持未配置；不会创建真实安装、仓库或提交。
    simulatedProviderReport = { provider: "in-memory Playwright route", liveGitHub: false, mode: "simulated" };
    const prefix = "simulated GitHub provider (not live github.com)";
    const consoleErrorsBeforeGithubUi = consoleErrors.length;
    const simulatedRepository = { id: 42, installationId: 77, owner: "octo", name: "notes-site", fullName: "octo/notes-site", defaultBranch: "main" };
    const simulated = {
      repository: null,
      job: null,
      nextPublishPhase: "queued",
      nextPublishMessage: "",
      calls: { status: 0, repositories: 0, repository: 0, publish: 0, unhandled: 0 },
      repositoryBodies: [],
      publishBodies: [],
      publishTargets: [],
    };
    const simulatedJob = (phase, overrides = {}) => ({ id: "ui-feedback-job", phase, message: "", startedAt: now, updatedAt: Date.now(), ...overrides });
    const simulatedStatus = () => ({ enabled: true, connected: true, localSiteEnabled: true, githubLogin: "ui-feedback", repository: simulated.repository, job: simulated.job });
    const realGitHubRequests = [];
    page.on("request", (request) => {
      const hostname = new URL(request.url()).hostname;
      if (hostname === "github.com" || hostname.endsWith(".github.com")) realGitHubRequests.push(request.url());
    });
    await context.route("**/api/site-publishing/github/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const method = request.method();
      const respond = (status, payload) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
      const readBody = () => { try { return JSON.parse(request.postData() ?? "{}"); } catch { return null; } };
      if (method === "GET" && pathname.endsWith("/api/site-publishing/github/status")) { simulated.calls.status += 1; return respond(200, simulatedStatus()); }
      if (method === "GET" && pathname.endsWith("/api/site-publishing/github/repositories")) { simulated.calls.repositories += 1; return respond(200, { repositories: [simulatedRepository] }); }
      if (method === "PUT" && pathname.endsWith("/api/site-publishing/github/repository")) {
        simulated.calls.repository += 1;
        const body = readBody();
        simulated.repositoryBodies.push(body);
        if (!body || body.repositoryId !== simulatedRepository.id || body.installationId !== simulatedRepository.installationId) return respond(400, { error: "simulated provider rejected an unverified repository" });
        simulated.repository = simulatedRepository;
        return respond(200, simulatedStatus());
      }
      if (method === "POST" && pathname.endsWith("/api/site-publishing/github/publish")) {
        simulated.calls.publish += 1;
        const body = readBody();
        simulated.publishBodies.push(body);
        simulated.publishTargets.push(request.headers()["x-notes-github-repository-id"]);
        const phase = simulated.nextPublishPhase;
        simulated.nextPublishPhase = "queued";
        simulated.job = simulatedJob(phase, phase === "failed" ? { message: simulated.nextPublishMessage } : {});
        return respond(202, { job: simulated.job });
      }
      // 授权/回调/断开等接口一律拒绝，避免流程落到真实 GitHub。
      simulated.calls.unhandled += 1;
      return respond(501, { error: `simulated provider has no handler for ${method} ${pathname}` });
    });
    const checkSimulatedSelection = (body, label) => {
      check(Boolean(body) && typeof body === "object", `${prefix}: ${label} sends a JSON export request`);
      check(Array.isArray(body?.notes) && body.notes.length === 1 && body.notes[0]?.id === "selected", `${prefix}: ${label} contains exactly the selected note`);
      check(Array.isArray(body?.notes) && body.notes.every((note) => !/PRIVATEONLYMARKER|TRASHONLYMARKER/.test(note.markdown)), `${prefix}: ${label} excludes unselected note bodies`);
      check(body?.settings?.basePath === "/nested/blog/", `${prefix}: ${label} keeps the saved deployment basePath`);
      check(Array.isArray(body?.categories) && body.categories.some((category) => category.slug === "life"), `${prefix}: ${label} keeps the custom category`);
    };
    const openPublishingPanel = async () => {
      await page.getByRole("button", { name: "账号：hugo-feedback" }).click();
      await page.getByRole("menuitem", { name: "发布为网站" }).click();
      await panel.waitFor();
      await panel.getByText("已保存到账号", { exact: true }).waitFor();
    };

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(baseURL);
    await openPublishingPanel();
    const githubDetails = panel.locator("details.site-publish-github");
    const githubSummary = githubDetails.locator("summary");
    await panel.locator('[data-site-publish-github="connected"]').waitFor();
    check(await githubDetails.evaluate((element) => element.open) === false, `${prefix}: GitHub Pages card starts collapsed`);
    check(await panel.getByText("已连接 GitHub：@ui-feedback", { exact: true }).isVisible() === false, `${prefix}: connected GitHub settings stay hidden while collapsed`);
    check(await githubSummary.isVisible(), `${prefix}: collapsed GitHub Pages summary stays visible`);
    const footer = panel.locator(".site-publish-footer");
    const publishButton = footer.getByRole("button", { name: "发布到 GitHub Pages" });
    const zipButton = footer.getByRole("button", { name: "生成网站 ZIP" });
    check(await publishButton.isVisible(), `${prefix}: footer publish action stays visible while the GitHub card is collapsed`);
    check(await publishButton.isDisabled(), `${prefix}: footer publish action waits for a repository`);
    await githubDetails.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(temporary, "github-collapsed-desktop.png") });
    screenshots.push("github-collapsed-desktop.png");

    await githubSummary.click();
    check(await githubDetails.evaluate((element) => element.open) === true, `${prefix}: GitHub Pages card expands on demand`);
    check(await panel.getByText("已连接 GitHub：@ui-feedback", { exact: true }).isVisible(), `${prefix}: connected feedback account is visibly simulated`);
    check(await panel.locator('[data-local-site-enabled="true"]').isVisible(), `${prefix}: configured account explains the simulated local /notes/ mirror`);
    const repositorySelect = panel.locator(".site-publish-github select");
    await repositorySelect.waitFor();
    await panel.locator('select option[value="42"]').waitFor({ state: "attached" });
    check(await repositorySelect.inputValue() === "", `${prefix}: no repository is bound initially`);
    await repositorySelect.selectOption({ label: "octo/notes-site" });
    await panel.getByText("已选择发布仓库：octo/notes-site", { exact: true }).waitFor();
    check(simulated.calls.repository === 1, `${prefix}: binding repository sends one PUT`);
    check(JSON.stringify(simulated.repositoryBodies[0]) === JSON.stringify({ repositoryId: 42, installationId: 77 }), `${prefix}: binding uses the verified repository and installation ids`);
    check(await repositorySelect.inputValue() === "42", `${prefix}: selected repository stays bound in the dropdown`);

    await githubSummary.press("Enter");
    check(await githubDetails.evaluate((element) => element.open) === false, `${prefix}: keyboard collapses the GitHub Pages card`);
    check(await repositorySelect.evaluate((element) => element.value) === "42", `${prefix}: collapsed card keeps the selected repository`);
    await githubSummary.press("Space");
    check(await githubDetails.evaluate((element) => element.open) === true, `${prefix}: keyboard expands the GitHub Pages card`);
    check(await repositorySelect.inputValue() === "42", `${prefix}: expanded card keeps the selected repository`);

    check(await publishButton.count() === 1, `${prefix}: footer renders exactly one publish action`);
    check(await panel.locator(".site-publish-github").getByRole("button", { name: "发布到 GitHub Pages" }).count() === 0, `${prefix}: repository card no longer holds the publish action`);
    const footerOrder = await footer.evaluate((element) => {
      const buttons = Array.from(element.querySelectorAll("button"));
      const publish = buttons.find((button) => button.textContent?.trim() === "发布到 GitHub Pages");
      const zip = buttons.find((button) => button.textContent?.trim() === "生成网站 ZIP");
      return Boolean(publish && zip && (publish.compareDocumentPosition(zip) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    check(footerOrder, `${prefix}: publish action is ordered before ZIP in the footer`);
    check(await publishButton.isEnabled(), `${prefix}: publish action enabled after repository selection`);
    check(await zipButton.isVisible(), `${prefix}: ZIP action stays beside the publish action`);
    await panel.locator("details.site-publish-advanced summary").click();
    const bodyScrolled = await panel.locator(".site-publish-body").evaluate((element) => { element.scrollTop = element.scrollHeight; return element.scrollTop; });
    check(bodyScrolled > 0, `${prefix}: panel body scrolls independently of the footer`);
    const desktopFooter = await footer.evaluate((element) => {
      const box = (button) => { const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; };
      const buttons = Array.from(element.querySelectorAll("button"));
      const publish = buttons.find((button) => button.textContent?.trim() === "发布到 GitHub Pages");
      const zip = buttons.find((button) => button.textContent?.trim() === "生成网站 ZIP");
      return { publish: box(publish), zip: box(zip), viewport: { width: window.innerWidth, height: window.innerHeight }, overflows: element.scrollWidth > element.clientWidth + 1 };
    });
    const desktopSameRow = Math.abs((desktopFooter.publish.top + desktopFooter.publish.bottom) / 2 - (desktopFooter.zip.top + desktopFooter.zip.bottom) / 2) <= 2;
    check(desktopFooter.publish.right <= desktopFooter.zip.left && desktopSameRow, `${prefix}: desktop footer keeps publish beside ZIP`);
    check(desktopFooter.publish.top >= 0 && desktopFooter.publish.left >= 0 && desktopFooter.zip.bottom <= desktopFooter.viewport.height && desktopFooter.zip.right <= desktopFooter.viewport.width, `${prefix}: desktop footer actions stay visible after scrolling the body`);
    check(!desktopFooter.overflows, `${prefix}: desktop footer actions fit without horizontal overflow`);
    await page.screenshot({ path: path.join(temporary, "footer-desktop.png") });
    screenshots.push("footer-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileFooter = await footer.evaluate((element) => {
      const box = (button) => { const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, visible: rect.width > 0 && rect.height > 0 }; };
      const buttons = Array.from(element.querySelectorAll("button"));
      const publish = buttons.find((button) => button.textContent?.trim() === "发布到 GitHub Pages");
      const zip = buttons.find((button) => button.textContent?.trim() === "生成网站 ZIP");
      return { publish: box(publish), zip: box(zip), viewport: { width: window.innerWidth, height: window.innerHeight }, overflows: element.scrollWidth > element.clientWidth + 1 };
    });
    const mobilePanelFits = await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    check(mobileFooter.publish.visible && mobileFooter.zip.visible, `${prefix}: mobile footer keeps both actions visible`);
    check(mobileFooter.publish.top >= 0 && mobileFooter.publish.bottom <= mobileFooter.viewport.height && mobileFooter.zip.top >= 0 && mobileFooter.zip.bottom <= mobileFooter.viewport.height, `${prefix}: mobile footer actions stay within the viewport height`);
    check(mobileFooter.publish.left >= 0 && mobileFooter.publish.right <= mobileFooter.viewport.width && mobileFooter.zip.left >= 0 && mobileFooter.zip.right <= mobileFooter.viewport.width, `${prefix}: mobile footer actions fit the viewport width`);
    check(!mobileFooter.overflows && mobilePanelFits, `${prefix}: mobile footer has no horizontal overflow`);
    await page.screenshot({ path: path.join(temporary, "footer-mobile.png") });
    screenshots.push("footer-mobile.png");
    await githubSummary.click();
    check(await githubDetails.evaluate((element) => element.open) === false, `${prefix}: GitHub Pages card collapses after mobile footer checks`);
    await githubDetails.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(temporary, "github-collapsed-mobile.png") });
    screenshots.push("github-collapsed-mobile.png");
    await page.setViewportSize({ width: 1440, height: 1000 });
    check(await githubDetails.evaluate((element) => element.open) === false, `${prefix}: GitHub Pages card stays collapsed before publishing`);
    await publishButton.click();
    const queuedJob = panel.locator('[data-github-publish-phase="queued"]');
    await queuedJob.waitFor({ state: "attached", timeout: 15_000 });
    check(simulated.calls.publish === 1, `${prefix}: first publish sends exactly one POST`);
    check(simulated.publishTargets[0] === "42", `${prefix}: publish confirms the repository shown in the panel`);
    checkSimulatedSelection(simulated.publishBodies[0], "first publish");
    check(await footer.getByRole("button", { name: "正在发布…" }).isDisabled(), `${prefix}: active job disables the footer publish action`);
    await githubSummary.click();
    check(await githubDetails.evaluate((element) => element.open) === true, `${prefix}: expanding the collapsed card shows the publish result`);
    await queuedJob.waitFor({ state: "visible", timeout: 15_000 });
    await page.screenshot({ path: path.join(temporary, "github-expanded.png") });
    screenshots.push("github-expanded.png");

    // 远程状态显式切换，只等待 4 秒轮询把新 phase 拉回界面。
    simulated.job = simulatedJob("deploying", { message: "网站已提交，正在等待 GitHub Pages 发布…", commitSha: "abc1234", commitUrl: "https://github.com/octo/notes-site/commit/abc1234", siteUrl: "https://octo.github.io/notes-site/", localSite: { phase: "building", url: "https://notes-ui.example.test/notes/", message: "GitHub Pages 已成功，正在构建模拟的本站镜像。" } });
    const deployingJob = panel.locator('[data-github-publish-phase="deploying"]');
    await deployingJob.waitFor({ timeout: 15_000 });
    check(await deployingJob.getAttribute("data-github-publish-live") === "false", `${prefix}: deploying phase never reports live before Pages succeeds`);
    check((await deployingJob.innerText()).includes("GitHub Pages 已上线，正在更新本站"), `${prefix}: local building after Pages success no longer claims Pages is still deploying`);
    check(await deployingJob.locator('[data-local-site-phase="building"]').isVisible(), `${prefix}: local mirror building is shown separately`);
    check(await deployingJob.getByRole("link", { name: "访问本站网站" }).count() === 0, `${prefix}: local mirror has no link before it succeeds`);
    check(await panel.getByText("已发布，站点已上线", { exact: true }).count() === 0, `${prefix}: no premature success message while deploying`);
    check(await panel.locator('.site-publish-github-links a[href="https://octo.github.io/notes-site/"]').isVisible(), `${prefix}: deploying phase exposes the commit and site links`);

    await panel.getByRole("button", { name: "关闭网站发布面板" }).click();
    await panel.waitFor({ state: "detached" });
    await openPublishingPanel();
    await panel.locator('[data-site-publish-github="connected"]').waitFor();
    check(await githubDetails.evaluate((element) => element.open) === false, `${prefix}: reopened panel starts with the GitHub Pages card collapsed`);
    check(await panel.getByText("已连接 GitHub：@ui-feedback", { exact: true }).isVisible() === false, `${prefix}: reopened panel hides GitHub settings until expanded`);
    const reopenedDeploying = panel.locator('[data-github-publish-phase="deploying"]');
    await reopenedDeploying.waitFor({ state: "attached" });
    check(await repositorySelect.evaluate((element) => element.value) === "42", `${prefix}: reopened panel restores the bound repository`);
    await githubSummary.click();
    await reopenedDeploying.waitFor();
    check(await reopenedDeploying.getAttribute("data-github-publish-live") === "false", `${prefix}: reopened panel restores the deploying job without claiming success`);

    simulated.job = simulatedJob("published", { message: "网站已发布。", commitSha: "abc1234", commitUrl: "https://github.com/octo/notes-site/commit/abc1234", siteUrl: "https://octo.github.io/notes-site/", localSite: { phase: "published", url: "https://notes-ui.example.test/notes/", message: "模拟的本站 /notes/ 镜像已更新。" } });
    const publishedJob = panel.locator('[data-github-publish-phase="published"]');
    await publishedJob.waitFor({ timeout: 15_000 });
    check(await publishedJob.getAttribute("data-github-publish-live") === "true", `${prefix}: published phase is the only live state`);
    const publishedLocal = publishedJob.locator('[data-local-site-phase="published"]');
    await publishedLocal.waitFor();
    check(await publishedLocal.getAttribute("data-local-site-live") === "true", `${prefix}: simulated local mirror reports its own success`);
    check(await publishedLocal.getByRole("link", { name: "访问本站网站" }).isVisible(), `${prefix}: local success exposes the separately labelled local link`);
    await publishedJob.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(temporary, "github-publishing-ui.png") });
    screenshots.push("github-publishing-ui.png");

    // GitHub 已发布但本站失败：必须分别展示，不能把本站失败伪装成成功或影响 GitHub 结果。
    simulated.job = simulatedJob("published", { message: "GitHub Pages 已发布；模拟的本站镜像更新失败。", commitSha: "abc1234", commitUrl: "https://github.com/octo/notes-site/commit/abc1234", siteUrl: "https://octo.github.io/notes-site/", localSite: { phase: "failed", url: "https://notes-ui.example.test/notes/", message: "模拟的本站构建失败，已有站点不会被替换。" } });
    // 终态任务不会继续轮询；关闭并重新打开面板，显式刷新已发布任务的最终本站状态。
    const statusCallsBeforeLocalFailureRefresh = simulated.calls.status;
    await panel.getByRole("button", { name: "关闭网站发布面板" }).click();
    await panel.waitFor({ state: "detached" });
    await openPublishingPanel();
    await panel.locator('[data-site-publish-github="connected"]').waitFor();
    check(await githubDetails.evaluate((element) => element.open) === false, `${prefix}: reopened panel starts collapsed before refreshing a terminal local failure`);
    await githubSummary.click();
    check(simulated.calls.status > statusCallsBeforeLocalFailureRefresh, `${prefix}: reopening explicitly refreshes the terminal job without polling`);
    check(await githubDetails.evaluate((element) => element.open) === true, `${prefix}: expanding the refreshed terminal job shows its final local failure`);
    const localFailed = panel.locator('[data-github-publish-phase="published"] [data-local-site-phase="failed"]');
    await localFailed.waitFor();
    check(await localFailed.getAttribute("data-local-site-live") === "false", `${prefix}: local failure is not marked live`);
    check((await localFailed.innerText()).includes("已有站点不会被替换"), `${prefix}: local failure says the existing site is not replaced`);
    check(await localFailed.getByRole("link", { name: "访问本站网站" }).count() === 0, `${prefix}: local failure hides the local success link`);
    check(await panel.locator('.site-publish-github-links a[href="https://octo.github.io/notes-site/"]').isVisible(), `${prefix}: local failure keeps the separate GitHub Pages link`);

    simulated.nextPublishPhase = "failed";
    simulated.nextPublishMessage = "模拟的部署失败：GitHub Pages 构建未通过。";
    const retryButton = panel.getByRole("button", { name: "发布到 GitHub Pages" });
    check(await retryButton.isEnabled(), `${prefix}: published job re-enables the publish action`);
    await retryButton.click();
    const failedJob = panel.locator('[data-github-publish-phase="failed"]');
    await failedJob.waitFor({ timeout: 15_000 });
    check((await failedJob.innerText()).includes("模拟的部署失败"), `${prefix}: failed publish shows the provider message`);
    check(await failedJob.getAttribute("data-github-publish-live") === "false", `${prefix}: failed publish is not live`);
    check(simulated.calls.publish === 2, `${prefix}: second publish sends exactly one additional POST`);
    checkSimulatedSelection(simulated.publishBodies[1], "second publish");
    check(await panel.getByRole("button", { name: "发布到 GitHub Pages" }).isEnabled(), `${prefix}: failed publish re-enables the retry button`);
    check(realGitHubRequests.length === 0, `${prefix}: no request reached github.com`);
    check(new URL(page.url()).origin === baseURL, `${prefix}: no navigation left the Notes app`);
    check(simulated.calls.unhandled === 0, `${prefix}: no real GitHub endpoint was attempted`);
    check(consoleErrors.length === consoleErrorsBeforeGithubUi, `${prefix}: no new browser errors during the simulated flow`);
    // OAuth 返回的新浏览器没有本机缓存，必须等账号工作区恢复后再清理发布选择。
    const beforeCallback = await (await context.request.get(`${baseURL}/api/site-publishing/config`)).json();
    const callbackContext = await browser.newContext({ storageState: { cookies: await context.cookies(), origins: [] } });
    let releaseWorkspace;
    let enteredWorkspace;
    const workspaceGate = new Promise((resolve) => { releaseWorkspace = resolve; });
    const workspaceEntered = new Promise((resolve) => { enteredWorkspace = resolve; });
    let earlyConfigurationReads = 0;
    try {
      await callbackContext.route("**/api/workspace", async (route) => {
        if (route.request().method() === "GET") { enteredWorkspace(); await workspaceGate; }
        await route.continue();
      });
      const callbackPage = await callbackContext.newPage();
      callbackPage.on("request", (request) => { if (request.url().endsWith("/api/site-publishing/config")) earlyConfigurationReads++; });
      await callbackPage.goto(`${baseURL}/?keep=1&githubPublish=connected#note=selected&view=preview`);
      await workspaceEntered;
      check(await callbackPage.getByRole("dialog", { name: "生成网站" }).count() === 0, `${prefix}: OAuth return waits for the account workspace`);
      check(earlyConfigurationReads === 0, `${prefix}: slow workspace does not load or prune saved publication selections early`);
      releaseWorkspace();
      const callbackPanel = callbackPage.getByRole("dialog", { name: "生成网站" });
      await callbackPanel.waitFor();
      await callbackPanel.getByText("已保存到账号", { exact: true }).waitFor();
      check(new URL(callbackPage.url()).searchParams.get("keep") === "1" && !new URL(callbackPage.url()).searchParams.has("githubPublish"), `${prefix}: OAuth consumes only its return parameter`);
      const afterCallback = await (await callbackContext.request.get(`${baseURL}/api/site-publishing/config`)).json();
      check(JSON.stringify(afterCallback.draft.selections) === JSON.stringify(beforeCallback.draft.selections), `${prefix}: OAuth return restores selections without empty-workspace data loss`);
    } finally { releaseWorkspace(); await callbackContext.close(); }
    simulatedProviderReport = { provider: "in-memory Playwright route", liveGitHub: false, mode: "simulated", calls: simulated.calls, assertions: assertions.filter((name) => name.startsWith(prefix)).length };
  }

  const report = { success: true, noOrigin, assertions, screenshots };
  if (simulatedProviderReport) report.githubUi = simulatedProviderReport;
  await fs.writeFile(path.join(temporary, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: true, noOrigin, githubUi, assertions: assertions.length, artifacts: temporary }, null, 2));
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    await failedPage.screenshot({ path: path.join(temporary, "failure.png") }).catch(() => {});
    await fs.writeFile(path.join(temporary, "failure.txt"), await failedPage.locator("body").innerText()).catch(() => {});
  }
  console.error(error);
  console.error(`Artifacts: ${temporary}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit"); child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
    await stopped; clearTimeout(timeout);
  }
  await stop(staticServer);
}
