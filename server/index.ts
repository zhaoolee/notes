import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDeflate, inflateSync } from "node:zlib";
import multer, { MulterError } from "multer";
import { chromium, type Browser, type Locator, type Page } from "playwright";

type ThemeId = "default" | "smartisan-dark";

interface ExportRequestBody {
  markdown?: string;
  markdownPath?: string;
  theme?: string;
  filename?: string;
  footerBrand?: string;
  footerVia?: string;
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

interface StoredExport {
  filename: string;
  path: string;
  url: string;
}

interface FooterConfig {
  brand?: string;
  via?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const imagesDir = process.env.IMAGE_STORAGE_DIR || path.join(rootDir, "storage", "images");
const port = Number(process.env.PORT || 3001);
const supportedThemes = new Set<ThemeId>(["default", "smartisan-dark"]);
const maxImageSizeBytes = 20 * 1024 * 1024;
const exportDeviceScaleFactor = 3;
const maxSafeScreenshotDimension = 30_000;
const maxScreenshotChunkHeight = Math.min(
  3_000,
  Math.floor(maxSafeScreenshotDimension / exportDeviceScaleFactor),
);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImageSizeBytes,
  },
});

let browserPromise: Promise<Browser> | undefined;

interface PngImage {
  width: number;
  height: number;
  colorType: number;
  channels: number;
  data: Buffer;
}

interface PngMetadata {
  width: number;
  height: number;
  colorType: number;
  channels: number;
}

function buildRenderUrl(baseUrl: string, theme: ThemeId, footer?: FooterConfig): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("renderMode", "playwright");
  url.searchParams.set("theme", theme);

  if (footer?.brand != null) {
    url.searchParams.set("footerBrand", footer.brand);
  }

  if (footer?.via != null) {
    url.searchParams.set("footerVia", footer.via);
  }

  return url.toString();
}

function getRenderUrl(request: Request, theme: ThemeId, footer?: FooterConfig): string {
  if (process.env.EXPORT_APP_URL) {
    return buildRenderUrl(process.env.EXPORT_APP_URL, theme, footer);
  }

  const baseUrl = getPublicBaseUrl(request);
  return buildRenderUrl(baseUrl, theme, footer);
}

function getPublicBaseUrl(request: Request): string {
  const protocol = request.get("x-forwarded-proto") || request.protocol || "http";
  const host = request.get("x-forwarded-host") || request.get("host");
  return `${protocol}://${host}`;
}

function applyCorsHeaders(request: Request, response: Response): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    request.get("access-control-request-headers") || "Content-Type, Authorization",
  );
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Disposition, X-Export-Path, X-Export-Url",
  );
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

function normalizeFooterText(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  return input.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 80);
}

function resolveFooterConfig(body: ExportRequestBody): FooterConfig {
  return {
    brand: normalizeFooterText(body.footerBrand),
    via: normalizeFooterText(body.footerVia),
  };
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

function getPngChannels(colorType: number): number {
  switch (colorType) {
    case 2:
      return 3;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type ${colorType}`);
  }
}

const crc32Table = new Uint32Array(256);

for (let index = 0; index < crc32Table.length; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  crc32Table[index] = value >>> 0;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function readPngMetadata(buffer: Buffer): PngMetadata {
  const signature = buffer.subarray(0, 8);

  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("Invalid PNG signature");
  }

  let offset = 8;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];

      if (bitDepth !== 8) {
        throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
      }

      return {
        width,
        height,
        colorType,
        channels: getPngChannels(colorType),
      };
    }

    offset += 12 + length;
  }

  throw new Error("Missing PNG header");
}

function decodePng(buffer: Buffer): PngImage {
  const metadata = readPngMetadata(buffer);
  let offset = 8;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  const rowLength = metadata.width * metadata.channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const data = Buffer.alloc(rowLength * metadata.height);
  let sourceOffset = 0;
  let previousRow = Buffer.alloc(rowLength);

  for (let y = 0; y < metadata.height; y += 1) {
    const filter = raw[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.from(raw.subarray(sourceOffset, sourceOffset + rowLength));
    sourceOffset += rowLength;

    for (let x = 0; x < rowLength; x += 1) {
      const left = x >= metadata.channels ? row[x - metadata.channels] : 0;
      const up = previousRow[x] || 0;
      const upLeft = x >= metadata.channels ? previousRow[x - metadata.channels] || 0 : 0;

      switch (filter) {
        case 0:
          break;
        case 1:
          row[x] = (row[x] + left) & 0xff;
          break;
        case 2:
          row[x] = (row[x] + up) & 0xff;
          break;
        case 3:
          row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4: {
          const predictor = left + up - upLeft;
          const leftDistance = Math.abs(predictor - left);
          const upDistance = Math.abs(predictor - up);
          const upLeftDistance = Math.abs(predictor - upLeft);
          const paeth =
            leftDistance <= upDistance && leftDistance <= upLeftDistance
              ? left
              : upDistance <= upLeftDistance
                ? up
                : upLeft;

          row[x] = (row[x] + paeth) & 0xff;
          break;
        }
        default:
          throw new Error(`Unsupported PNG filter ${filter}`);
      }
    }

    row.copy(data, y * rowLength);
    previousRow = row;
  }

  return { ...metadata, data };
}

function createPngChunk(type: string, data: Buffer<ArrayBufferLike> = Buffer.alloc(0)): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);

  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);

  return chunk;
}

async function deflatePngRows(chunks: Buffer[], metadata: PngMetadata): Promise<Buffer> {
  const deflater = createDeflate();
  const compressedChunks: Buffer[] = [];

  deflater.on("data", (chunk: Buffer) => {
    compressedChunks.push(chunk);
  });

  for (const chunk of chunks) {
    const image = decodePng(chunk);
    const rowLength = image.width * image.channels;

    if (
      image.width !== metadata.width ||
      image.colorType !== metadata.colorType ||
      image.channels !== metadata.channels
    ) {
      throw new Error("PNG chunks have incompatible dimensions");
    }

    for (let y = 0; y < image.height; y += 1) {
      const row = Buffer.alloc(rowLength + 1);

      row[0] = 0;
      image.data.copy(row, 1, y * rowLength, (y + 1) * rowLength);

      if (!deflater.write(row)) {
        await once(deflater, "drain");
      }
    }
  }

  deflater.end();
  await once(deflater, "end");

  return Buffer.concat(compressedChunks);
}

async function stitchPngChunks(chunks: Buffer[]): Promise<Buffer> {
  const metadata = chunks.map((chunk) => readPngMetadata(chunk));
  const [firstMetadata] = metadata;

  if (!firstMetadata) {
    throw new Error("No PNG chunks to stitch");
  }

  const totalHeight = metadata.reduce((sum, image) => sum + image.height, 0);

  for (const image of metadata) {
    if (
      image.width !== firstMetadata.width ||
      image.colorType !== firstMetadata.colorType ||
      image.channels !== firstMetadata.channels
    ) {
      throw new Error("PNG chunks have incompatible dimensions");
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(firstMetadata.width, 0);
  header.writeUInt32BE(totalHeight, 4);
  header[8] = 8;
  header[9] = firstMetadata.colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createPngChunk("IHDR", header),
    createPngChunk("IDAT", await deflatePngRows(chunks, firstMetadata)),
    createPngChunk("IEND"),
  ]);
}

async function screenshotNoteSheet(noteSheet: Locator): Promise<Buffer> {
  const page = noteSheet.page();
  const box = await noteSheet.boundingBox();

  if (!box?.width || !box.height) {
    throw new Error("Unable to measure note sheet for export");
  }

  if (
    box.height * exportDeviceScaleFactor <= maxSafeScreenshotDimension &&
    box.width * exportDeviceScaleFactor <= maxSafeScreenshotDimension
  ) {
    return await noteSheet.screenshot({
      animations: "disabled",
      scale: "device",
      type: "png",
    });
  }

  const chunks: Buffer[] = [];
  const chunkHeight = Math.max(1, maxScreenshotChunkHeight - 1);
  let currentOffset = 0;

  while (currentOffset < box.height) {
    const currentHeight = Math.min(chunkHeight, box.height - currentOffset);
    await page.setViewportSize({
      width: 1280,
      height: Math.max(1, Math.ceil(currentHeight)),
    });
    await page.evaluate((scrollTop) => {
      window.scrollTo(0, scrollTop);
    }, box.y + currentOffset);
    await page.waitForTimeout(80);

    const scrollY = await page.evaluate(() => window.scrollY);
    const clipY = box.y + currentOffset - scrollY;

    chunks.push(
      await page.screenshot({
        animations: "disabled",
        clip: {
          x: box.x,
          y: Math.max(0, clipY),
          width: box.width,
          height: currentHeight,
        },
        scale: "device",
        type: "png",
      }),
    );

    currentOffset += currentHeight;
  }

  return stitchPngChunks(chunks);
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

async function resolveAvailableExportFilename(filename: string): Promise<string> {
  await ensureImagesDir();

  const parsed = path.parse(filename);
  let attempt = 0;

  while (true) {
    const candidate =
      attempt === 0
        ? filename
        : `${parsed.name}-${attempt + 1}${parsed.ext}`;

    try {
      await fs.access(path.join(imagesDir, candidate));
      attempt += 1;
    } catch {
      return candidate;
    }
  }
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

async function persistExport(
  request: Request,
  filename: string,
  pngBuffer: Buffer,
): Promise<StoredExport> {
  const storedFilename = await resolveAvailableExportFilename(filename);
  const filePath = path.join(imagesDir, storedFilename);

  await fs.writeFile(filePath, pngBuffer);

  const publicPath = `/images/${storedFilename}`;

  return {
    filename: storedFilename,
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
    deviceScaleFactor: exportDeviceScaleFactor,
    viewport: { width: 1280, height: 960 },
  });

  try {
    await page.goto(renderUrl, {
      waitUntil: "domcontentloaded",
    });

    const editor = page.locator("#markdown-editor");
    await editor.waitFor();
    await editor.fill(markdown);
    await waitForAssets(page);

    const noteSheet = page.locator(".note-sheet");
    await noteSheet.waitFor();
    await waitForStableHeight(noteSheet);
    return await screenshotNoteSheet(noteSheet);
  } finally {
    await page.close();
  }
}

const app = express();

app.use((request: Request, response: Response, next: NextFunction) => {
  applyCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

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
      const renderUrl = getRenderUrl(request, theme, resolveFooterConfig(body));
      const markdown = normalizeRenderableImageUrls(
        await resolveMarkdown(body),
        request,
        renderUrl,
      );
      const requestedFilename = resolveExportFilename(body.filename);

      const pngBuffer = await renderNotePng(markdown, renderUrl);
      const storedExport = await persistExport(request, requestedFilename, pngBuffer);

      response.setHeader("Content-Type", "image/png");
      response.setHeader("Content-Disposition", `inline; filename="${storedExport.filename}"`);
      response.setHeader("X-Export-Path", storedExport.path);
      response.setHeader("X-Export-Url", storedExport.url);
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
