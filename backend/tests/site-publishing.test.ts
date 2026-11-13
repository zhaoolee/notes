import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { load } from "cheerio";
import sharp from "sharp";
import { createSitePublishDraft, buildSiteExportRequest, normalizeBasePath, validateSiteCategories } from "../../src/features/site-publishing/model.js";
import { buildSiteEntries, validateSiteExportRequest } from "../../server/site-publishing/build.js";
import { localizeSiteMarkdown, removeDuplicateSiteTitle } from "../../server/site-publishing/markdown.js";
import { createSiteImageReader, isAllowedSiteImageDnsAddress, isPublicSiteImageAddress, validateRemoteSiteImageUrl } from "../../server/site-publishing/assets.js";

const countOccurrences = (text: string, needle: string) => text.split(needle).length - 1;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=", "base64");
const customLogoPath = `/images/${"b".repeat(64)}.png`;
const note = { id: "selected-one", markdown: "## 完整标题\n\n公开正文", createdAt: 1_600_000_000_000, updatedAt: 1_600_000_100_000, normalOrder: 0, pinnedAt: null, folderId: null, isStarred: false, deletedAt: null };

test("网站导出验证 basePath、保留分类路径、回收站和显式选择", () => {
  assert.equal(normalizeBasePath(" nested/blog "), "/nested/blog/");
  assert.equal(normalizeBasePath("/"), "/");
  for (const value of ["/../secret", "//example.test/a?x", "/a\\b", "/%2e%2e/", "https://evil.test"]) assert.throws(() => normalizeBasePath(value));
  const draft = createSitePublishDraft("https://example.test");
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  assert.equal(buildSiteExportRequest(draft, [note, { ...note, id: "private", markdown: "PRIVATEONLY" }]).notes.length, 1);
  assert.throws(() => buildSiteExportRequest(draft, [{ ...note, deletedAt: Date.now() }]));
  assert.throws(() => validateSiteCategories([{ id: "bad", name: "搜索", slug: "search" }]));
  const request = buildSiteExportRequest(draft, [note]);
  assert.throws(() => validateSiteExportRequest({ ...request, notes: [{ ...request.notes[0], deletedAt: Date.now() }] }));
  assert.throws(() => validateSiteExportRequest({ ...request, notes: [request.notes[0], request.notes[0]] }));
  assert.throws(() => validateSiteExportRequest({ ...request, settings: { ...request.settings, themeId: "unknown" } }));
});

test("后端设置校验兼容旧客户端 rootPath，正规输出只含 basePath", () => {
  const draft = createSitePublishDraft("https://example.test");
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  const request = buildSiteExportRequest(draft, [note]);
  const { basePath: _basePath, ...legacySettings } = request.settings;
  const legacy = { ...legacySettings, rootPath: "/legacy/blog" };

  const accepted = validateSiteExportRequest({ ...request, settings: legacy });
  assert.equal(accepted.settings.basePath, "/legacy/blog/");
  assert.equal("rootPath" in accepted.settings, false);

  // basePath 显式存在时优先，即使为空串或非法值；非法值仍报错而不是悄悄迁移。
  const preferred = validateSiteExportRequest({
    ...request,
    settings: { ...request.settings, basePath: "/new/blog/", rootPath: "/legacy/blog" },
  });
  assert.equal(preferred.settings.basePath, "/new/blog/");
  assert.throws(
    () => validateSiteExportRequest({ ...request, settings: { ...request.settings, basePath: "blog?next=1", rootPath: "/legacy/blog" } }),
    /basePath 只能包含/,
  );
  assert.throws(() => validateSiteExportRequest({ ...request, settings: { ...legacySettings, rootPath: "/a\\b" } }), /basePath 只能包含/);
});

test("网站 Logo 设置兼容旧请求，只接受本机图片导入路径", () => {
  const draft = createSitePublishDraft("https://example.test");
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  const request = buildSiteExportRequest(draft, [note]);
  const { logoPath: _logoPath, ...legacySettings } = request.settings;

  const legacy = validateSiteExportRequest({ ...request, settings: legacySettings });
  assert.equal(legacy.settings.logoPath, "");

  const accepted = validateSiteExportRequest({
    ...request,
    settings: { ...request.settings, logoPath: customLogoPath },
  });
  assert.equal(accepted.settings.logoPath, customLogoPath);

  for (const logoPath of [
    null,
    1,
    "https://example.test/logo.png",
    "data:image/png;base64,AAAA",
    "/images/../secret.png",
    "/images/logo.png",
    `/images/${"b".repeat(64)}.svg`,
    `${customLogoPath}?v=1`,
  ]) {
    assert.throws(
      () => validateSiteExportRequest({
        ...request,
        settings: { ...request.settings, logoPath },
      }),
      /网站 Logo/,
      String(logoPath),
    );
  }
});

test("网站图片转换处理括号与引用式图片，不改写普通链接或代码块", async () => {
  assert.equal(removeDuplicateSiteTitle("## 标题\n\n## 章节\n正文", "标题"), "## 章节\n正文");
  assert.equal(removeDuplicateSiteTitle("普通开头\n\n## 章节", "普通开头"), "普通开头\n\n## 章节");
  assert.equal(removeDuplicateSiteTitle("## 第一节\n正文", "自定义文章标题"), "## 第一节\n正文");
  const sources: string[] = [];
  const markdown = ["![图](https://example.test/a(b).png)", "", "![引用][image]", "", "[image]: /images/example.png", "", "[普通链接](/images/example.png)", "", "```md", "![代码图片](/images/private.png)", "```", "", "`![行内代码](/images/inline.png)`", "", "<script>alert(1)</script>"].join("\n");
  const result = await localizeSiteMarkdown(markdown, async (source) => { sources.push(source); return `index.assets/${sources.length}.png`; });
  assert.deepEqual(sources, ["https://example.test/a(b).png", "/images/example.png"]);
  assert.match(result, /!\[图\]\(<index.assets\/1.png>\)/);
  assert.match(result, /!\[引用\]\(<index.assets\/2.png>\)/);
  assert.match(result, /\[普通链接\]\(\/images\/example.png\)/);
  assert.match(result, /!\[代码图片\]\(\/images\/private.png\)/);
  assert.match(result, /!\[行内代码\]\(\/images\/inline.png\)/);
  assert.match(result, /&lt;script&gt;/);
  assert.doesNotMatch(result, /<script>/);
});

test("网站图片读取拒绝内网、跨目录和符号链接，仅保存真实图像", async (context) => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "198.18.0.1", "fc00::1"]) assert.equal(isPublicSiteImageAddress(address), false, address);
  assert.equal(isPublicSiteImageAddress("1.1.1.1"), true);
  assert.equal(isAllowedSiteImageDnsAddress("raw.githubusercontent.com", "198.18.0.81"), true);
  assert.equal(isAllowedSiteImageDnsAddress("198.18.0.81", "198.18.0.81"), false);
  assert.equal(isAllowedSiteImageDnsAddress("public.test", "127.0.0.1"), false);
  for (const url of ["http://example.test/a.png", "https://127.0.0.1/a.png", "file:///etc/passwd", "https://localhost/a.png", "https://user:pass@example.test/a", "https://example.test:9000/a"]) assert.throws(() => validateRemoteSiteImageUrl(url));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "site-images-test-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const imagesDirectory = path.join(temporary, "images");
  const publicDirectory = path.join(temporary, "public");
  await fs.mkdir(imagesDirectory); await fs.mkdir(publicDirectory);
  await fs.writeFile(path.join(imagesDirectory, "pixel.png"), png);
  const avif = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 20, g: 90, b: 140, alpha: 1 } } }).avif().toBuffer();
  await fs.writeFile(path.join(imagesDirectory, "pixel.avif"), avif);
  await fs.writeFile(path.join(temporary, "private.png"), png);
  await fs.writeFile(path.join(publicDirectory, "fake.png"), "PRIVATE_SECRET_TEXT");
  await fs.symlink(path.join(temporary, "private.png"), path.join(imagesDirectory, "outside.png"));
  const readImage = createSiteImageReader({ imagesDirectory, publicDirectory, publicOrigin: "https://notes.example.test" });
  const signal = new AbortController().signal;
  assert.deepEqual((await readImage("https://notes.example.test/images/pixel.png?v=1", signal)).buffer, png);
  assert.equal((await readImage(`data:image/png;base64,${png.toString("base64")}`, signal)).extension, "png");
  const avifRead = await readImage("/images/pixel.avif", signal);
  assert.equal(avifRead.extension, "avif");
  assert.deepEqual(avifRead.buffer, avif);
  for (const source of ["/images/outside.png", "/images/%2e%2e%2fprivate.png", "/../private.png", "file:///etc/passwd", "./private.png", "/fake.png", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="]) await assert.rejects(() => readImage(source, signal), source);
});

test("默认 Logo 保持锤子图标，导出不依赖 notes 的 /images/ 运行时路径", async () => {
  const draft = createSitePublishDraft();
  // 顺带覆盖空简介：首页不渲染 home-description，正文也不写入简介。
  draft.settings.description = "";
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  const request = validateSiteExportRequest(buildSiteExportRequest(draft, [note]));
  let reads = 0;
  const entries = await buildSiteEntries(request, {
    rootDirectory: process.cwd(),
    signal: new AbortController().signal,
    readImage: async () => { reads += 1; return { buffer: png, extension: "png" }; },
  });
  assert.equal(reads, 0);
  const files = new Map(entries.map((entry) => [entry.path.replace(/^notes-hugo-site\//, ""), entry.data]));
  const defaultLogo = await fs.readFile(path.join(process.cwd(), "public", "smartisan", "web", "smartisan_hammer_footer.png"));
  assert.deepEqual(files.get("static/logo.png"), defaultLogo);
  assert.deepEqual(files.get("public/logo.png"), defaultLogo);
  assert.doesNotMatch(files.get("hugo.json")!.toString(), /logoPath|\/images\//);
  // 空简介：首页不生成 home-description，正文也不写入空段落。
  const homePage = load(files.get("public/index.html")!.toString());
  assert.equal(homePage(".home-description").length, 0);
  assert.equal(homePage(".reader-sheet .article-content").length, 0);
  assert.equal(homePage("meta[name=description]").attr("content"), "");
});

test("默认草稿用空域名生成 /notes/ 站点，配置、资源、导航与搜索链接一致", async () => {
  const draft = createSitePublishDraft();
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  const request = validateSiteExportRequest(buildSiteExportRequest(draft, [note]));
  assert.equal(request.settings.basePath, "/notes/");
  const entries = await buildSiteEntries(request, {
    rootDirectory: process.cwd(),
    signal: new AbortController().signal,
    readImage: async () => ({ buffer: png, extension: "png" }),
  });
  const files = new Map(entries.map((entry) => [entry.path.replace(/^notes-hugo-site\//, ""), entry.data]));
  const config = JSON.parse(files.get("hugo.json")!.toString());
  assert.equal(config.baseURL, "/notes/");
  const home = load(files.get("public/index.html")!.toString());
  assert.equal(home("link[rel=canonical]").length, 0);
  assert.equal(home(".site-brand").attr("href"), "/notes/");
  assert.equal(home(".site-brand img").attr("src"), "/notes/logo.png");
  assert.equal(home("form.sidebar-search-form").attr("action"), "/notes/search/");
  const articleHref = home(".home-post-list a").attr("href")!;
  assert.ok(articleHref.startsWith("/notes/"), articleHref);
  const search = JSON.parse(files.get("public/index.json")!.toString()) as { pages: Array<{ permalink: string }> };
  assert.equal(search.pages.length, 1);
  assert.ok(search.pages[0].permalink.startsWith("/notes/"), search.pages[0].permalink);
  const relative = decodeURIComponent(search.pages[0].permalink.slice("/notes/".length));
  assert.ok(files.has(`public/${relative}${relative.endsWith("/") ? "index.html" : "/index.html"}`), search.pages[0].permalink);
});

test("自定义 Logo 损坏或超过 2MB 时明确失败，不静默回退默认图标", async () => {
  const draft = createSitePublishDraft();
  draft.settings.logoPath = customLogoPath;
  draft.selections = [{ noteId: note.id, categoryId: "guides" }];
  const request = validateSiteExportRequest(buildSiteExportRequest(draft, [note]));
  const signal = new AbortController().signal;

  await assert.rejects(
    () => buildSiteEntries(request, {
      rootDirectory: process.cwd(),
      signal,
      readImage: async () => { throw new Error("图片无法解码。"); },
    }),
    /网站 Logo 处理失败：图片无法解码。/,
  );
  await assert.rejects(
    () => buildSiteEntries(request, {
      rootDirectory: process.cwd(),
      signal,
      readImage: async () => ({ buffer: Buffer.alloc(2 * 1024 * 1024 + 1), extension: "png" }),
    }),
    /网站 Logo 处理失败：图片不能超过 2MB/,
  );
});

test("可选站点域名：空白规范化为空串，非法非空域名仍拒绝导出", () => {
  for (const origin of ["", "   "]) {
    const draft = createSitePublishDraft(origin);
    draft.selections = [{ noteId: note.id, categoryId: "guides" }];
    const request = buildSiteExportRequest(draft, [note]);
    assert.equal(request.settings.origin, "");
  }

  for (const origin of ["example.test", "ftp://example.test", "https://example.test/blog/", "https://user:pass@example.test", "https://example.test?next=1"]) {
    const draft = createSitePublishDraft(origin);
    draft.selections = [{ noteId: note.id, categoryId: "guides" }];
    assert.throws(() => buildSiteExportRequest(draft, [note]), /站点域名|完整的站点域名/, origin);
  }
});

test("真实 Hugo 构建有/无域名与根/嵌套路径，所有站内资源可解析且只收录选中便签", async () => {
  const customLogo = await sharp({
    create: {
      width: 320,
      height: 120,
      channels: 4,
      background: { r: 198, g: 72, b: 58, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  for (const origin of ["", "https://example.test"]) {
    for (const basePath of ["/", "/nested/blog/"]) {
      const hasDomain = origin.length > 0;
      const staticOrigin = hasDomain ? origin : "https://static-host.test";
      const expectedBaseURL = hasDomain ? `${origin}${basePath}` : basePath;
      const draft = createSitePublishDraft(origin);
      draft.settings.basePath = basePath;
      draft.settings.title = "测试网站 <script>";
      draft.settings.description = "网站介绍";
      draft.settings.logoPath = customLogoPath;
      draft.categories.push({ id: "life", name: "生活与旅行", slug: "life" });
      draft.selections = [{ noteId: note.id, categoryId: "life" }];
      const markdown = ["## 标题" + "长".repeat(45), "", "公开正文与表格", "", "| 项目 | 状态 |", "| --- | --- |", "| 网站 | 完成 |", "", "- [x] 已选", "", "![原图](/images/local.png)", "![相同图片][same]", "", "[same]: /images/local.png", "", "{{< nonexistent >}}", "", "```go", "{{% another-nonexistent %}}", "```"].join("\n");
      const request = validateSiteExportRequest(buildSiteExportRequest(draft, [{ ...note, markdown }, { ...note, id: "private", markdown: "PRIVATEONLYMARKER" }, { ...note, id: "trashed", markdown: "TRASHONLYMARKER", deletedAt: Date.now() }]));
      let reads = 0;
      const entries = await buildSiteEntries(request, { rootDirectory: process.cwd(), signal: new AbortController().signal, readImage: async (source) => { if (source === customLogoPath) return { buffer: customLogo, extension: "png" }; reads += 1; return { buffer: png, extension: "png" }; } });
      assert.equal(reads, 1);
      const files = new Map(entries.map((entry) => [entry.path.replace(/^notes-hugo-site\//, ""), entry.data]));
      assert.ok(files.has("hugo.json")); assert.ok(files.has(".github/workflows/pages.yml")); assert.ok(files.has("README.md"));
      const config = JSON.parse(files.get("hugo.json")!.toString());
      assert.equal(config.baseURL, expectedBaseURL);
      assert.equal(config.params.notesHasDomain, hasDomain);
      assert.equal(config.outputs.home.includes("RSS"), hasDomain);
      assert.equal(config.outputs.home.includes("JSON"), true);
      const articlePath = Array.from(files.keys()).find((key) => /^public\/life\/p-[a-f0-9]+\/index.html$/.test(key))!;
      assert.ok(articlePath);
      const $ = load(files.get(articlePath)!.toString());
      assert.equal($("article h1").text(), "标题" + "长".repeat(45));
      assert.ok($(".reader-sheet").length); assert.ok($(".sidebar").length); assert.ok($(".article-toc").length);
      const homePage = load(files.get("public/index.html")!.toString());
      // 首页简介只显示一次：标题下的 home-description 保留，.Content 不再重复简介。
      assert.equal(homePage(".home-description").length, 1, "home-description");
      assert.equal(homePage(".home-description").first().text().trim(), "网站介绍");
      assert.equal(countOccurrences(homePage(".reader-sheet").first().text(), "网站介绍"), 1);
      assert.equal(homePage("meta[name=description]").attr("content"), "网站介绍");
      const iconHref = homePage("link[rel=icon]").attr("href")!;
      assert.ok(iconHref.startsWith(basePath) && iconHref.endsWith("logo.png"), iconHref);
      const brandSrc = homePage(".site-brand img").attr("src")!;
      assert.ok(brandSrc.startsWith(basePath) && brandSrc.endsWith("logo.png"), brandSrc);
      const builtLogo = files.get("public/logo.png");
      assert.ok(builtLogo);
      assert.equal(files.get("static/logo.png")!.equals(builtLogo), true);
      const logoMetadata = await sharp(builtLogo).metadata();
      assert.equal(logoMetadata.width, 256);
      assert.equal(logoMetadata.height, 256);
      assert.equal(logoMetadata.format, "png");
      assert.equal(logoMetadata.hasAlpha, true);
      const { data: logoPixels, info: logoInfo } = await sharp(builtLogo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(logoInfo.channels, 4);
      assert.equal(logoPixels[3], 0);
      assert.doesNotMatch(files.get("hugo.json")!.toString(), /logoPath|\/images\//);
      assert.doesNotMatch(files.get("public/index.html")!.toString(), /\/images\//);
      assert.ok($("table").length); assert.ok($("input[type=checkbox][checked]").length);
      assert.match($("article").text(), /{{< nonexistent >}}/);
      assert.match($("article pre").text(), /{{% another-nonexistent %}}/);
      assert.equal($("script:not([src])").length, 0);
      if (hasDomain) {
        assert.equal($("link[rel=canonical]").attr("href"), `${origin}${basePath}life/${articlePath.split("/")[2]}/`);
      } else {
        assert.equal($("link[rel=canonical]").length, 0);
      }
      const images = $("article img").toArray(); assert.equal(images.length, 2);
      for (const image of images) {
        const source = $(image).attr("src")!;
        assert.ok(source.startsWith(`${basePath}life/`));
        assert.deepEqual(files.get(`public/${decodeURIComponent(source.slice(basePath.length))}`), png);
      }
      // 用构建出的真实 HTML 和静态 host 解析链接，而不是只匹配模板源码。
      for (const [filename, bytes] of files) {
        if (!filename.startsWith("public/") || !filename.endsWith(".html")) continue;
        const html = load(bytes.toString());
        if (!hasDomain) assert.equal(html("link[rel=canonical]").length, 0, filename);
        const pageURL = `${staticOrigin}${basePath}${filename.slice("public/".length).replace(/index.html$/, "")}`;
        html("[href], [src], form[action]").each((_index, element) => {
          const target = html(element).attr("href") ?? html(element).attr("src") ?? html(element).attr("action");
          if (!target || target.startsWith("#")) return;
          const url = new URL(target, pageURL);
          if (url.origin !== staticOrigin) return;
          assert.ok(url.pathname.startsWith(basePath), `${filename}: ${target}`);
          const relative = decodeURIComponent(url.pathname.slice(basePath.length));
          const filepath = `public/${relative}${relative.endsWith("/") || !relative ? "index.html" : ""}`;
          assert.ok(files.has(filepath), `${filename} refers to missing ${filepath}`);
        });
      }
      const cssEntry = Array.from(files).find(([key]) => /^public\/css\/.*\.css$/.test(key))!;
      assert.ok(cssEntry);
      const cssURL = `${staticOrigin}${basePath}${cssEntry[0].slice("public/".length)}`;
      let cssFontCount = 0;
      for (const match of cssEntry[1].toString().matchAll(/url\(["']?([^\)"']+)/g)) {
        const url = new URL(match[1], cssURL);
        if (url.protocol === "data:") continue;
        assert.ok(url.pathname.startsWith(basePath), match[1]);
        if (url.pathname.endsWith(".woff2")) cssFontCount += 1;
        assert.ok(files.has(`public/${url.pathname.slice(basePath.length)}`), url.pathname);
      }
      assert.ok(cssFontCount >= 3);
      const search = JSON.parse(files.get("public/index.json")!.toString());
      assert.equal(search.pages.length, 1); assert.match(JSON.stringify(search), /公开正文/);
      for (const page of search.pages as Array<{ permalink: string }>) {
        assert.ok(page.permalink.startsWith(basePath), page.permalink);
        assert.doesNotMatch(page.permalink, /^https?:|example\.test|localhost|static-host\.test/);
        const relative = decodeURIComponent(page.permalink.slice(basePath.length));
        assert.ok(files.has(`public/${relative}${relative.endsWith("/") ? "index.html" : "/index.html"}`), `search link missing: ${page.permalink}`);
      }
      const robots = files.get("public/robots.txt")!.toString();
      if (hasDomain) {
        assert.match(files.get("public/index.xml")!.toString(), /example\.test/);
        const sitemap = files.get("public/sitemap.xml")!.toString();
        assert.match(sitemap, /example\.test/);
        assert.match(robots, new RegExp(`Sitemap:\\s*${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}sitemap\\.xml`));
      } else {
        assert.equal(files.has("public/index.xml"), false);
        assert.equal(files.has("public/sitemap.xml"), false);
        assert.doesNotMatch(robots, /Sitemap:/i);
        for (const [filename, bytes] of files) {
          if (!filename.startsWith("public/") || !/\.(?:html|json|xml|txt|js|css)$/.test(filename)) continue;
          assert.doesNotMatch(bytes.toString(), /https?:\/\/(?:example\.test|localhost|127\.0\.0\.1|static-host\.test)/i, filename);
        }
      }
      const readme = files.get("README.md")!.toString();
      assert.match(readme, /public\//);
      assert.match(readme, /content\/<栏目>\/<文章ID>\//);
      assert.doesNotMatch(readme, /rootpath/i);
      if (hasDomain) {
        assert.ok(readme.includes(expectedBaseURL));
      } else {
        assert.match(readme, /当前网站域名/);
        assert.doesNotMatch(readme, /https:\/\/example\.com/);
        assert.ok(readme.includes(basePath));
      }
      assert.equal(Array.from(files.keys()).filter((key) => key.startsWith("content/") && key.includes("index.assets/")).length, 1);
      for (const [filename, bytes] of files) {
        if (/\.(?:md|json|html|xml)$/.test(filename)) assert.doesNotMatch(bytes.toString(), /PRIVATEONLYMARKER|TRASHONLYMARKER/);
      }
    }
  }
});
