import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { SITE_LOGO_MAX_BYTES } from "../../src/features/site-publishing/logo.js";
import { getSiteNoteTitle, normalizeSiteSettings, validateSiteCategories, type SiteExportRequest } from "../../src/features/site-publishing/model.js";
import { localizeSiteMarkdown, removeDuplicateSiteTitle } from "./markdown.js";
import { getSiteThemeFiles } from "./theme.js";

export interface SiteZipEntry { path: string; data: Buffer; mode?: number }
export interface SiteBuildOptions {
  rootDirectory: string;
  readImage: (source: string, signal: AbortSignal) => Promise<{ buffer: Buffer; extension: string }>;
  signal: AbortSignal;
  hugoBinary?: string;
}
const execFileAsync = promisify(execFile);
const MAX_SITE_BYTES = 80 * 1024 * 1024;
const SITE_LOGO_SIZE = 256;

/**
 * 自定义 Logo 只从本机图片目录读取，统一转成 256×256 透明背景 PNG。
 * 失败时明确报错，不能悄悄回退到默认图标，否则用户会误以为配置已生效。
 */
async function buildSiteLogo(logoPath: string, options: SiteBuildOptions): Promise<Buffer> {
  try {
    const image = await options.readImage(logoPath, options.signal);
    if (image.buffer.length > SITE_LOGO_MAX_BYTES) throw new Error("图片不能超过 2MB");
    return await sharp(image.buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(SITE_LOGO_SIZE, SITE_LOGO_SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new Error(
      `网站 Logo 处理失败：${error instanceof Error ? error.message : "图片无法读取或解码。"} 请重新上传，或恢复默认 Logo。`,
      { cause: error },
    );
  }
}

export function validateSiteExportRequest(value: unknown): SiteExportRequest {
  if (!value || typeof value !== "object") throw new Error("网站导出数据不正确。");
  const input = value as SiteExportRequest;
  const settings = normalizeSiteSettings(input.settings);
  const categories = validateSiteCategories(input.categories);
  const ids = new Set<string>();
  const categoryIds = new Set(categories.map((category) => category.id));
  if (!Array.isArray(input.notes) || !input.notes.length) throw new Error("请选择至少一张便签生成网站。");
  let markdownBytes = 0;
  const notes = input.notes.map((note) => {
    if (!note || typeof note.id !== "string" || !note.id || note.id.length > 200 || ids.has(note.id) || typeof note.markdown !== "string" || note.markdown.includes("\0") || note.deletedAt !== null || !categoryIds.has(note.categoryId)) throw new Error("便签重复、已删除或分类无效，请重新选择。");
    for (const time of [note.createdAt, note.updatedAt]) {
      if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time > Date.now() + 300_000) throw new Error("便签时间无效，无法生成网站。");
    }
    markdownBytes += Buffer.byteLength(note.markdown);
    if (Buffer.byteLength(note.markdown) > 512 * 1024 || markdownBytes > 5 * 1024 * 1024) throw new Error("所选便签正文过大，请减少导出数量。");
    ids.add(note.id);
    return { id: note.id, markdown: note.markdown, categoryId: note.categoryId, createdAt: note.createdAt, updatedAt: note.updatedAt, deletedAt: null };
  });
  return { settings, categories, notes };
}

function frontMatter(metadata: Record<string, unknown>, body = ""): string {
  return `${JSON.stringify(metadata, null, 2)}\n\n${body}\n`;
}

function githubWorkflow(): string {
  return `name: Publish Hugo website
on:
  push:
    branches: [main, master]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - name: Install Hugo
        env:
          HUGO_VERSION: 0.162.1
        run: |
          curl -fSL -o hugo.tar.gz "https://github.com/gohugoio/hugo/releases/download/v\${HUGO_VERSION}/hugo_extended_\${HUGO_VERSION}_linux-amd64.tar.gz"
          curl -fSL -o checksums.txt "https://github.com/gohugoio/hugo/releases/download/v\${HUGO_VERSION}/hugo_\${HUGO_VERSION}_checksums.txt"
          grep " hugo_extended_\${HUGO_VERSION}_linux-amd64.tar.gz$" checksums.txt | sed 's@hugo_extended_[^ ]*linux-amd64.tar.gz@hugo.tar.gz@' | sha256sum -c -
          tar -xzf hugo.tar.gz hugo
          sudo mv hugo /usr/local/bin/hugo
      - run: hugo --gc --minify
      - uses: actions/upload-pages-artifact@v4
        with:
          path: public
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
`;
}

export async function buildSiteEntries(request: SiteExportRequest, options: SiteBuildOptions): Promise<SiteZipEntry[]> {
  const { settings, categories, notes } = request;
  const hasDomain = settings.origin.length > 0;
  const baseURL = hasDomain ? `${settings.origin}${settings.basePath}` : settings.basePath;
  const siteAddress = hasDomain ? baseURL : `${settings.basePath}（沿用当前网站域名）`;
  const deploymentDescription = hasDomain
    ? `将 public/ 内的全部文件部署到网站的 ${settings.basePath} 路径。例如当前配置 ${settings.basePath} 时，public/index.html 应能从 ${baseURL} 访问。不要把整个 ZIP 作为 public/ 再多嵌套一层。静态文件不依赖 notes 后端。`
    : `将 public/ 内的全部文件部署到当前网站域名的 ${settings.basePath} 路径。例如当前配置 ${settings.basePath} 时，public/index.html 应能从当前网站域名的 ${settings.basePath} 访问。未填写站点域名，因此不生成 canonical、RSS 或 sitemap。不要把整个 ZIP 作为 public/ 再多嵌套一层。静态文件不依赖 notes 后端。`;
  const files = new Map<string, Buffer>();
  let totalBytes = 0;
  const add = (filename: string, data: string | Buffer) => {
    const buffer = typeof data === "string" ? Buffer.from(data) : data;
    totalBytes += buffer.length;
    if (totalBytes > MAX_SITE_BYTES || files.size >= 5000) throw new Error("网站内容超过 80MB 或文件过多，请减少便签或图片。");
    files.set(filename, buffer);
  };
  for (const [filename, source] of Object.entries(getSiteThemeFiles())) add(filename, source);
  add("hugo.json", JSON.stringify({
    baseURL, title: settings.title, locale: "zh-CN", defaultContentLanguage: "zh", hasCJKLanguage: true,
    enableRobotsTXT: true, summaryLength: 120, timeZone: "Asia/Taipei",
    params: { description: settings.description, author: settings.author, notesTheme: settings.themeId, notesHasDomain: hasDomain },
    outputs: { home: hasDomain ? ["HTML", "RSS", "JSON"] : ["HTML", "JSON"] },
    ...(hasDomain ? {} : { disableKinds: ["RSS", "sitemap"] }),
    markup: { goldmark: { renderer: { unsafe: false } }, highlight: { noClasses: false }, tableOfContents: { startLevel: 2, endLevel: 3 } },
    security: { enableInlineShortcodes: false, exec: { allow: [] }, funcs: { getenv: [] }, http: { urls: [] } },
    menu: { main: categories.map((category, index) => ({ name: category.name, pageRef: category.slug, weight: (index + 1) * 10 })) },
  }, null, 2));
  // 首页简介只作为 description 元数据；模板已在标题下渲染 home-description，
  // 若同时写进正文，.Content 会把同一段简介再显示一次。
  add("content/_index.md", frontMatter({ title: settings.title, description: settings.description }));
  add("content/search/_index.md", frontMatter({ title: "搜索", layout: "search", sitemap: { disable: true } }));
  for (const category of categories) add(`content/${category.slug}/_index.md`, frontMatter({ title: category.name }));
  const loadedImages = new Map<string, { buffer: Buffer; extension: string }>();
  let loadedImageBytes = 0;
  for (const note of notes) {
    options.signal.throwIfAborted();
    const category = categories.find((candidate) => candidate.id === note.categoryId)!;
    const publicationId = `p-${createHash("sha256").update(note.id).digest("hex").slice(0, 24)}`;
    const directory = `content/${category.slug}/${publicationId}`;
    let body: string;
    try {
      body = await localizeSiteMarkdown(removeDuplicateSiteTitle(note.markdown, getSiteNoteTitle(note.markdown)), async (source) => {
        options.signal.throwIfAborted();
        let image = loadedImages.get(source);
        if (!image) {
          if (loadedImages.size >= 400) throw new Error("网站最多支持 400 张不同图片。");
          image = await options.readImage(source, options.signal);
          loadedImageBytes += image.buffer.length;
          if (loadedImageBytes > 40 * 1024 * 1024) throw new Error("所选图片超过 40MB，请减少导出数量。");
          loadedImages.set(source, image);
        }
        const filename = `index.assets/${createHash("sha256").update(image.buffer).digest("hex")}.${image.extension}`;
        if (!files.has(`${directory}/${filename}`)) add(`${directory}/${filename}`, image.buffer);
        return filename;
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw new Error(`便签「${getSiteNoteTitle(note.markdown).slice(0, 60)}」无法导出：${error instanceof Error ? error.message : "图片处理失败。"}`);
    }
    add(`${directory}/index.md`, frontMatter({ title: getSiteNoteTitle(note.markdown), date: new Date(Math.min(note.createdAt, Date.now())).toISOString(), lastmod: new Date(Math.min(note.updatedAt, Date.now())).toISOString(), draft: false, categories: [category.name] }, body));
  }
  add("static/assets/bg.jpg", await fs.readFile(path.join(options.rootDirectory, "public", "bg.jpg")));
  add(
    "static/logo.png",
    settings.logoPath
      ? await buildSiteLogo(settings.logoPath, options)
      : await fs.readFile(path.join(options.rootDirectory, "public", "smartisan", "web", "smartisan_hammer_footer.png")),
  );
  add("static/.nojekyll", "");
  add(".github/workflows/pages.yml", githubWorkflow());
  add(".gitignore", "/public/\n/resources/\n/.hugo_build.lock\n");
  add("README.md", `# ${settings.title.replace(/[\r\n]/g, " ")}\n\n使用 notes 生成的 Hugo 网站，样式：经典便签博客。\n\n站点地址：${siteAddress}\n\n## 直接部署静态文件\n\n${deploymentDescription}\n\n## 修改后重新构建\n\n安装 Hugo Extended 0.162.1 或兼容版本，在本目录运行 hugo。运行 hugo server 可本地预览。站点域名或子路径变化时，先修改 hugo.json 的 baseURL（未填写域名时它是部署根路径）并重新构建，不能只移动旧的 public/。文章与图片位于 content/<栏目>/<文章ID>/。\n\n## GitHub Pages\n\n将源码提交到独立仓库，在 Settings → Pages 中将 Source 设置为 GitHub Actions。包内工作流会构建并发布。项目站点 basePath 通常应为 /仓库名/，自定义域名按实际路径配置。上传文件时请包含隐藏的 .github/ 目录。已有网站的子路径部署需要由现有主机或主站发布流程合并 public/，不能直接用本包覆盖主站。\n\n## 内容与模板\n\n仅导出本次勾选的便签。原始 HTML 以文字保留；Hugo shortcode 按原文展示，不执行。网站分类独立于便签文件夹。搜索使用本地索引，无需外部服务。模板参考 https://github.com/zhaoolee/zhaoolee.github.io，个人统计、广告与域名未携带。\n`);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "notes-hugo-build-"));
  try {
    for (const [filename, data] of files) {
      const destination = path.join(temporary, filename);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, data);
    }
    options.signal.throwIfAborted();
    try {
      await execFileAsync(options.hugoBinary ?? process.env.HUGO_BIN ?? "hugo", ["--source", temporary, "--destination", path.join(temporary, "public"), "--gc", "--minify"], {
        cwd: temporary, timeout: 60_000, maxBuffer: 512 * 1024, signal: options.signal,
        env: { PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary, HUGO_CACHEDIR: path.join(temporary, ".cache"), HUGO_ENVIRONMENT: "production" },
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("服务端未安装 Hugo，请安装 Hugo Extended 0.162.1 后重试，或更新服务镜像。");
      throw new Error("Hugo 网站构建失败，请检查便签内容或联系管理员查看运行环境。", { cause: error });
    }
    async function collect(directory: string, prefix: string): Promise<void> {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        options.signal.throwIfAborted();
        const filename = path.join(directory, entry.name);
        const relative = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await collect(filename, relative);
        else if (entry.isFile()) add(relative, await fs.readFile(filename));
      }
    }
    await collect(path.join(temporary, "public"), "public");
    return Array.from(files, ([filename, data]) => ({ path: `notes-hugo-site/${filename}`, data }));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
