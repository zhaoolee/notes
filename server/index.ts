import express, { type Request, type Response } from "express";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer, { MulterError } from "multer";
import { chromium, type Browser, type Locator, type Page } from "playwright";

type ThemeId = "default" | "smartisan-dark";

interface ExportRequestBody {
  markdown?: string;
  markdownPath?: string;
  theme?: string;
  filename?: string;
}

interface ImageImportRequestBody {
  sourceUrl?: string;
}

interface StoredImage {
  hash: string;
  extension: string;
  path: string;
  url: string;
}

interface ImageSource {
  buffer: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const imagesDir = process.env.IMAGE_STORAGE_DIR || path.join(rootDir, "storage", "images");
const port = Number(process.env.PORT || 3001);
const supportedThemes = new Set<ThemeId>(["default", "smartisan-dark"]);
const maxImageSizeBytes = 20 * 1024 * 1024;
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImageSizeBytes,
  },
});

let browserPromise: Promise<Browser> | undefined;

function buildRenderUrl(baseUrl: string, theme: ThemeId): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("renderMode", "playwright");
  url.searchParams.set("theme", theme);
  return url.toString();
}

function getRenderUrl(request: Request, theme: ThemeId): string {
  if (process.env.EXPORT_APP_URL) {
    return buildRenderUrl(process.env.EXPORT_APP_URL, theme);
  }

  const baseUrl = getPublicBaseUrl(request);
  return buildRenderUrl(baseUrl, theme);
}

function getPublicBaseUrl(request: Request): string {
  const protocol = request.get("x-forwarded-proto") || request.protocol || "http";
  const host = request.get("x-forwarded-host") || request.get("host");
  return `${protocol}://${host}`;
}

function normalizeRenderableImageUrls(
  markdown: string,
  request: Request,
  renderUrl: string,
): string {
  const knownHosts = new Set<string>(["127.0.0.1", "localhost", "::1", "frontend", "backend"]);

  try {
    knownHosts.add(new URL(renderUrl).hostname.toLowerCase());
  } catch {
    // Ignore invalid render URL and keep built-in host allowlist.
  }

  try {
    knownHosts.add(new URL(getPublicBaseUrl(request)).hostname.toLowerCase());
  } catch {
    // Ignore invalid public base URL and keep built-in host allowlist.
  }

  return markdown.replace(/https?:\/\/[^\s<>)"'`]+/g, (value) => {
    try {
      const url = new URL(value);

      if (!url.pathname.startsWith("/images/")) {
        return value;
      }

      if (!knownHosts.has(url.hostname.toLowerCase())) {
        return value;
      }

      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return value;
    }
  });
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }

  return browserPromise;
}

async function resolveMarkdown(body: ExportRequestBody): Promise<string> {
  if (typeof body.markdown === "string") {
    return body.markdown;
  }

  if (typeof body.markdownPath === "string" && body.markdownPath.trim()) {
    return fs.readFile(body.markdownPath, "utf8");
  }

  throw new Error("Missing markdown or markdownPath");
}

function resolveTheme(body: ExportRequestBody): ThemeId {
  if (typeof body.theme === "string" && supportedThemes.has(body.theme as ThemeId)) {
    return body.theme as ThemeId;
  }

  return "default";
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function buildFallbackFilename(): string {
  const now = new Date();
  const formatted = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
    padDatePart(now.getHours()),
    padDatePart(now.getMinutes()),
    padDatePart(now.getSeconds()),
  ].join("-");

  return `${formatted}-${Date.now()}.png`;
}

function resolveExportFilename(input: unknown): string {
  if (typeof input !== "string") {
    return buildFallbackFilename();
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return buildFallbackFilename();
  }

  if (
    /[\u0000-\u001F\u007F]/.test(trimmed) ||
    /[^\x20-\x7E]/.test(trimmed) ||
    /[\\/:*?"<>|]/.test(trimmed)
  ) {
    return buildFallbackFilename();
  }

  return /\.png$/i.test(trimmed) ? trimmed : `${trimmed}.png`;
}

async function waitForAssets(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;

    const images = Array.from(document.images);
    await Promise.all(
      images.map((image) => {
        if (image.complete) {
          return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      }),
    );
  });
}

async function waitForStableHeight(locator: Locator): Promise<void> {
  let previousHeight = -1;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const box = await locator.boundingBox();
    const currentHeight = Math.ceil(box?.height || 0);

    if (currentHeight > 0 && currentHeight === previousHeight) {
      return;
    }

    previousHeight = currentHeight;
    await locator.page().waitForTimeout(120);
  }
}

async function hasDistIndex(): Promise<boolean> {
  try {
    await fs.access(path.join(distDir, "index.html"));
    return true;
  } catch {
    return false;
  }
}

async function ensureImagesDir(): Promise<void> {
  await fs.mkdir(imagesDir, { recursive: true });
}

function resolveSourceUrl(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) {
    return null;
  }

  try {
    const url = new URL(input.trim());

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function detectImageFormat(
  buffer: Buffer,
  mimeType?: string | null,
  filename?: string | null,
): string | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString("ascii");

    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
      return "gif";
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") {
    return "bmp";
  }

  const sample = buffer.subarray(0, 512).toString("utf8").trimStart();

  if (sample.startsWith("<?xml") || sample.startsWith("<svg")) {
    if (/<svg[\s>]/i.test(sample)) {
      return "svg";
    }
  }

  const normalizedMime = mimeType?.split(";")[0].trim().toLowerCase();

  switch (normalizedMime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      break;
  }

  const extension = filename ? path.extname(filename).replace(".", "").toLowerCase() : "";

  switch (extension) {
    case "png":
    case "jpg":
    case "jpeg":
      return extension === "jpeg" ? "jpg" : extension;
    case "gif":
    case "webp":
    case "bmp":
    case "svg":
      return extension;
    default:
      return null;
  }
}

async function downloadImageFromUrl(sourceUrl: string): Promise<ImageSource> {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`图片下载失败（${response.status} ${response.statusText || ""}）`.trim());
  }

  const contentLength = Number(response.headers.get("content-length") || "0");

  if (contentLength > maxImageSizeBytes) {
    throw new Error(`图片过大，单张图片不能超过 ${Math.floor(maxImageSizeBytes / 1024 / 1024)}MB。`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > maxImageSizeBytes) {
    throw new Error(`图片过大，单张图片不能超过 ${Math.floor(maxImageSizeBytes / 1024 / 1024)}MB。`);
  }

  const filename = path.basename(new URL(response.url).pathname) || "remote-image";

  return {
    buffer,
    mimeType: response.headers.get("content-type"),
    filename,
  };
}

async function persistImage(
  request: Request,
  source: ImageSource,
): Promise<StoredImage> {
  if (!source.buffer.length) {
    throw new Error("图片内容为空。");
  }

  const extension = detectImageFormat(source.buffer, source.mimeType, source.filename);

  if (!extension) {
    throw new Error("暂不支持该图片格式。");
  }

  await ensureImagesDir();

  const hash = createHash("sha256").update(source.buffer).digest("hex");
  const filename = `${hash}.${extension}`;
  const filePath = path.join(imagesDir, filename);

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, source.buffer);
  }

  const publicPath = `/images/${filename}`;

  return {
    hash,
    extension,
    path: publicPath,
    url: `${getPublicBaseUrl(request)}${publicPath}`,
  };
}

function runImageUpload(request: Request, response: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    imageUpload.single("image")(request, response, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function renderNotePng(markdown: string, renderUrl: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage({
    deviceScaleFactor: 3,
    viewport: { width: 1280, height: 960 },
  });

  try {
    await page.goto(renderUrl, {
      waitUntil: "networkidle",
    });

    const editor = page.locator("#markdown-editor");
    await editor.waitFor();
    await editor.fill(markdown);
    await waitForAssets(page);

    const noteSheet = page.locator(".note-sheet");
    await noteSheet.waitFor();
    await waitForStableHeight(noteSheet);

    return await noteSheet.screenshot({
      animations: "disabled",
      scale: "device",
      type: "png",
    });
  } finally {
    await page.close();
  }
}

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use("/images", express.static(imagesDir, { fallthrough: false, immutable: true, maxAge: "1y" }));

app.post(
  "/api/export",
  async (
    request: Request<Record<string, never>, unknown, ExportRequestBody>,
    response: Response,
  ) => {
    try {
      const body = request.body || {};
      const theme = resolveTheme(body);
      const renderUrl = getRenderUrl(request, theme);
      const markdown = normalizeRenderableImageUrls(
        await resolveMarkdown(body),
        request,
        renderUrl,
      );
      const filename = resolveExportFilename(body.filename);

      const pngBuffer = await renderNotePng(markdown, renderUrl);

      response.setHeader("Content-Type", "image/png");
      response.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      response.send(pngBuffer);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export note image";
      const isBrowserInstallError =
        message.includes("Executable doesn't exist") ||
        message.includes("Please run the following command");

      console.error("Export request failed:", error);

      response.status(500).json({
        error: message,
        hint: isBrowserInstallError
          ? "Run `npx playwright install chromium` on this machine."
          : undefined,
      });
    }
  },
);

app.get("/api/health", (_request: Request, response: Response) => {
  response.json({ ok: true });
});

app.post(
  "/api/images/import",
  async (
    request: Request<Record<string, never>, unknown, ImageImportRequestBody>,
    response: Response,
  ) => {
    try {
      await runImageUpload(request, response);

      const uploadedFile = request.file;

      if (uploadedFile?.buffer) {
        response.json(
          await persistImage(request, {
            buffer: uploadedFile.buffer,
            mimeType: uploadedFile.mimetype,
            filename: uploadedFile.originalname,
          }),
        );
        return;
      }

      const sourceUrl = resolveSourceUrl(request.body?.sourceUrl);

      if (!sourceUrl) {
        response.status(400).json({
          error: "请拖入图片文件，或粘贴一个可访问的图片 URL。",
        });
        return;
      }

      const downloadedImage = await downloadImageFromUrl(sourceUrl);
      response.json(await persistImage(request, downloadedImage));
    } catch (error) {
      if (error instanceof MulterError && error.code === "LIMIT_FILE_SIZE") {
        response.status(413).json({
          error: `图片过大，单张图片不能超过 ${Math.floor(maxImageSizeBytes / 1024 / 1024)}MB。`,
        });
        return;
      }

      const message = error instanceof Error ? error.message : "图片导入失败";

      console.error("Image import failed:", error);

      response.status(400).json({
        error: message,
      });
    }
  },
);

if (await hasDistIndex()) {
  app.use(express.static(distDir));

  app.get("/{*any}", (_request: Request, response: Response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
}

const server = app.listen(port, () => {
  console.log(`Backend listening on http://127.0.0.1:${port}`);
});

async function closeBrowser(): Promise<void> {
  if (!browserPromise) {
    return;
  }

  const browser = await browserPromise;
  await browser.close();
  browserPromise = undefined;
}

async function shutdown(exitCode: number): Promise<void> {
  server.close(async () => {
    await closeBrowser();
    process.exit(exitCode);
  });
}

process.on("SIGINT", () => {
  void shutdown(130);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});
