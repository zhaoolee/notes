import express, { type NextFunction, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDeflate, deflateRawSync, inflateSync } from "node:zlib";
import multer, { MulterError } from "multer";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteSheet } from "../src/components/NoteSheet.js";
import { splitSections } from "../src/lib/markdown.js";

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

interface ArchiveRequestBody {
  markdown?: string;
  markdownPath?: string;
  footerBrand?: string;
  footerVia?: string;
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

interface ArchiveImage {
  source: string;
  filename: string;
  buffer: Buffer;
}

interface ZipEntry {
  path: string;
  data: Buffer;
}

interface ArchiveFont {
  sourceName: string;
  outputName: string;
  weight: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir =
  path.basename(__dirname) === "server" && path.basename(path.dirname(__dirname)) === "dist-server"
    ? path.resolve(__dirname, "..", "..")
    : path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");
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
const execFileAsync = promisify(execFile);
const archiveFonts: ArchiveFont[] = [
  {
    sourceName: "OPPOSans-R.ttf",
    outputName: "OPPOSans-R-subset.woff2",
    weight: 400,
  },
  {
    sourceName: "OPPOSans-M.ttf",
    outputName: "OPPOSans-M-subset.woff2",
    weight: 500,
  },
  {
    sourceName: "OPPOSans-B.ttf",
    outputName: "OPPOSans-B-subset.woff2",
    weight: 700,
  },
];

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

async function resolveMarkdown(body: ExportRequestBody | ArchiveRequestBody): Promise<string> {
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

function buildArchiveBasename(markdown: string): string {
  const now = new Date();
  const formatted = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
    padDatePart(now.getHours()),
    padDatePart(now.getMinutes()),
    padDatePart(now.getSeconds()),
  ].join("-");
  const hash = createHash("sha256").update(markdown).digest("hex");

  return `${formatted}-${hash}`;
}

function sanitizeArchiveFilename(value: string, fallback: string): string {
  const parsed = path.parse(value.split(/[?#]/, 1)[0]);
  const extension = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
  const name = parsed.name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);

  return `${name || fallback}${extension}`;
}

function getDataUrlImage(source: string): ImageSource | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(source);

  if (!match) {
    return null;
  }

  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType: match[1],
    filename: "embedded-image",
  };
}

async function readRootRelativeArchiveImage(source: string): Promise<ImageSource | null> {
  let pathname = "";

  try {
    pathname = decodeURIComponent(new URL(source, "http://archive.local").pathname);
  } catch {
    return null;
  }

  if (pathname.startsWith("/images/")) {
    const filename = path.basename(pathname);
    const filePath = path.join(imagesDir, filename);

    return {
      buffer: await fs.readFile(filePath),
      filename,
    };
  }

  const filePath = path.resolve(publicDir, `.${pathname}`);

  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    return null;
  }

  return {
    buffer: await fs.readFile(filePath),
    filename: path.basename(pathname),
  };
}

async function readRelativeArchiveImage(source: string): Promise<ImageSource | null> {
  const [pathname] = source.split(/[?#]/, 1);
  const filePath = path.resolve(rootDir, pathname);

  if (!filePath.startsWith(`${rootDir}${path.sep}`)) {
    return null;
  }

  return {
    buffer: await fs.readFile(filePath),
    filename: path.basename(pathname),
  };
}

async function resolveArchiveImage(source: string): Promise<ImageSource | null> {
  const dataImage = getDataUrlImage(source);

  if (dataImage) {
    return dataImage;
  }

  if (/^https?:\/\//i.test(source)) {
    return downloadImageFromUrl(source);
  }

  if (source.startsWith("/")) {
    return readRootRelativeArchiveImage(source);
  }

  return readRelativeArchiveImage(source);
}

function collectMarkdownImageSources(markdown: string): string[] {
  const sources: string[] = [];
  const markdownImagePattern = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
  const htmlImagePattern = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;

  for (const match of markdown.matchAll(markdownImagePattern)) {
    sources.push(match[1]);
  }

  for (const match of markdown.matchAll(htmlImagePattern)) {
    sources.push(match[2]);
  }

  return Array.from(new Set(sources));
}

function replaceAll(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function buildArchiveFontFaceCss(fonts: ArchiveFont[]): string {
  return fonts
    .map(
      (font) => `      @font-face {
        font-family: "OPPOSansArchive";
        src: url("./html.assets/fonts/${font.outputName}") format("woff2");
        font-weight: ${font.weight};
        font-style: normal;
        font-display: swap;
      }
`,
    )
    .join("\n");
}

function renderArchiveNoteSheet(markdown: string, footer: FooterConfig): string {
  const footerBrand = footer.brand ?? "由锤子便签发送";
  const footerVia = footer.via ?? "via Smartisan Notes";

  return renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections(markdown),
      footerBrand: createElement("span", { className: "sheet-footer-brand" }, footerBrand),
      footerVia: createElement("span", { className: "sheet-footer-via" }, footerVia),
    }),
  );
}

function buildArchiveIndexHtml(
  markdown: string,
  footer: FooterConfig,
  fonts: ArchiveFont[],
): string {
  const noteSheetHtml = renderArchiveNoteSheet(markdown, footer);
  const fontFaceCss = buildArchiveFontFaceCss(fonts);
  const fontFamilyPrefix = fonts.length ? `"OPPOSansArchive", ` : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>便签归档预览</title>
    <style>
${fontFaceCss}
      :root {
        --paper: #fefcf6;
        --sheet-surface: #fefcf6;
        --sheet-shadow: 0 24px 42px rgba(89, 65, 34, 0.12);
        --note-frame: rgba(237, 233, 225, 0.92);
        --note-heading: rgba(70, 53, 38, 0.96);
        --note-copy: rgba(106, 86, 67, 0.92);
        --note-link: #ac9070;
        --note-code-bg: rgba(125, 78, 32, 0.08);
        --note-pre-bg: rgba(243, 236, 225, 0.9);
        --note-pre-text: rgba(97, 79, 61, 0.94);
        --note-quote: #c0b5a7;
        --note-quote-mark: #ded4c8;
        --note-table-border: rgba(220, 209, 191, 0.88);
        --note-table-head-bg: rgba(243, 236, 225, 0.65);
        --note-hr: rgba(220, 209, 191, 0.8);
        --footer-copy: #d7cec1;
        --footer-via: #ded6cb;
        --footer-icon: #d9d0c3;
        --note-font: ${fontFamilyPrefix}"Noto Sans SC", "PingFang SC", "Hiragino Sans GB",
          "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
        --note-scale: 2;
        --note-sheet-width: calc(330px * var(--note-scale));
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        min-height: 100%;
        margin: 0;
      }

      body {
        padding: 36px 18px;
        color: var(--note-copy);
        font-family: var(--note-font);
        background:
          url("./html.assets/bg.jpg") left top / 420px auto repeat,
          #efe6d6;
        background-attachment: fixed;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      .preview-stage {
        width: var(--note-sheet-width);
        max-width: 100%;
        margin: 0 auto;
      }

      .note-sheet {
        position: relative;
        align-self: flex-start;
        width: var(--note-sheet-width);
        max-width: 100%;
        margin: 0;
        padding:
          calc(18px * var(--note-scale))
          calc(18px * var(--note-scale))
          calc(24px * var(--note-scale));
        border-radius: 0;
        border: 0;
        background: var(--sheet-surface);
        box-shadow: var(--sheet-shadow);
        font-family: var(--note-font);
        overflow: hidden;
      }

      .sheet-frame {
        position: absolute;
        pointer-events: none;
        border: 1px solid var(--note-frame);
      }

      .sheet-frame-outer {
        inset:
          calc(14px * var(--note-scale))
          calc(8px * var(--note-scale))
          calc(54px * var(--note-scale));
      }

      .sheet-frame-inner {
        inset:
          calc(18px * var(--note-scale))
          calc(12px * var(--note-scale))
          calc(58px * var(--note-scale));
      }

      .sheet-corner {
        position: absolute;
        width: calc(3px * var(--note-scale));
        height: calc(3px * var(--note-scale));
        border: 1px solid var(--note-frame);
        background: var(--paper);
        pointer-events: none;
      }

      .sheet-corner-top-left {
        left: calc(5px * var(--note-scale));
        top: calc(13px * var(--note-scale));
      }

      .sheet-corner-top-right {
        right: calc(5px * var(--note-scale));
        top: calc(13px * var(--note-scale));
      }

      .sheet-corner-bottom-left {
        left: calc(5px * var(--note-scale));
        bottom: calc(53px * var(--note-scale));
      }

      .sheet-corner-bottom-right {
        right: calc(5px * var(--note-scale));
        bottom: calc(53px * var(--note-scale));
      }

      .sheet-inner {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 0;
        padding:
          calc(16px * var(--note-scale))
          calc(18px * var(--note-scale))
          calc(14px * var(--note-scale));
      }

      .note-section {
        min-height: auto;
      }

      .note-index {
        margin-bottom: calc(9px * var(--note-scale));
      }

      .note-index p,
      .note-index strong {
        margin: 0;
        font-size: calc(0.92rem * var(--note-scale));
        font-weight: 700;
        color: var(--note-heading);
      }

      .note-copy {
        display: flex;
        flex-direction: column;
        gap: 0;
        color: var(--note-copy);
        font-size: calc(0.89rem * var(--note-scale));
        font-weight: 400;
        line-height: 1.76;
        letter-spacing: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .note-copy p {
        margin: 0;
        white-space: pre-wrap;
      }

      .note-copy h1,
      .note-copy h2,
      .note-copy h3,
      .note-copy h4,
      .note-copy h5,
      .note-copy h6 {
        margin: 0;
        color: var(--note-heading);
        line-height: 1.28;
      }

      .note-copy h1 {
        font-size: calc(1.28rem * var(--note-scale));
      }

      .note-copy h2 {
        font-size: calc(0.92rem * var(--note-scale));
      }

      .note-copy .markdown-blank-line {
        display: block;
        height: 0.704em;
        min-height: 0;
        line-height: 0;
        overflow: hidden;
      }

      .note-copy .markdown-blank-line + p,
      .note-copy .markdown-blank-line + pre,
      .note-copy .markdown-blank-line + blockquote,
      .note-copy .markdown-blank-line + ul,
      .note-copy .markdown-blank-line + ol,
      .note-copy .markdown-blank-line + table,
      .note-copy .markdown-blank-line + hr,
      .note-copy .markdown-blank-line + h1,
      .note-copy .markdown-blank-line + h2,
      .note-copy .markdown-blank-line + h3,
      .note-copy .markdown-blank-line + h4,
      .note-copy .markdown-blank-line + h5,
      .note-copy .markdown-blank-line + h6 {
        margin-top: 0;
      }

      .note-copy p + p {
        margin-top: 0;
      }

      .note-copy p + .markdown-blank-line {
        margin-top: 0;
      }

      .note-copy p img {
        display: block;
        width: auto;
        max-width: 100%;
        height: auto;
        margin:
          calc(12px * var(--note-scale))
          auto
          calc(2px * var(--note-scale));
        border: 0;
        border-radius: 0;
        box-shadow: none;
        background: color-mix(in srgb, var(--paper) 85%, transparent);
        object-fit: contain;
        image-rendering: auto;
      }

      .note-copy a {
        color: var(--note-link);
        text-decoration: none;
      }

      .note-copy code {
        font-size: 0.9em;
        font-weight: 400;
        padding: 0.08em 0.32em;
        border-radius: 0;
        background: var(--note-code-bg);
      }

      .note-copy pre {
        margin: calc(10px * var(--note-scale)) 0 0;
        padding: calc(9px * var(--note-scale)) calc(11px * var(--note-scale));
        overflow: hidden;
        border-radius: 0;
        background: var(--note-pre-bg);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        color: var(--note-pre-text);
        font-size: calc(0.72rem * var(--note-scale));
        font-weight: 400;
        line-height: 1.62;
      }

      .note-copy pre code {
        display: block;
        padding: 0;
        border-radius: 0;
        background: transparent;
        white-space: inherit;
        overflow-wrap: inherit;
        word-break: inherit;
      }

      .note-copy blockquote {
        position: relative;
        margin: 0 0 calc(8px * var(--note-scale));
        padding-left: calc(0.92rem * var(--note-scale));
        color: var(--note-quote);
        font-size: calc(0.88rem * var(--note-scale));
        font-weight: 400;
        line-height: 1.48;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .note-copy blockquote::before {
        content: "“";
        position: absolute;
        left: calc(-0.04rem * var(--note-scale));
        top: calc(0.1rem * var(--note-scale));
        font-family: "Georgia", "Times New Roman", serif;
        font-size: calc(1.42rem * var(--note-scale));
        line-height: 0.82;
        font-weight: 400;
        color: var(--note-quote-mark);
      }

      .note-copy blockquote p {
        margin: 0;
      }

      .note-copy ul,
      .note-copy ol {
        margin: calc(8px * var(--note-scale)) 0 0;
        padding-left: 1.3em;
      }

      .note-copy li + li {
        margin-top: 0.35em;
      }

      .note-copy table {
        width: 100%;
        margin: calc(8px * var(--note-scale)) 0 0;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: calc(0.74rem * var(--note-scale));
        line-height: 1.52;
      }

      .note-copy th,
      .note-copy td {
        padding:
          calc(0.35rem * var(--note-scale))
          calc(0.45rem * var(--note-scale));
        border: 1px solid var(--note-table-border);
        overflow-wrap: anywhere;
        word-break: break-word;
        vertical-align: top;
      }

      .note-copy th {
        background: var(--note-table-head-bg);
        font-weight: 700;
      }

      .note-copy hr {
        margin: calc(12px * var(--note-scale)) 0;
        border: 0;
        border-top: 1px solid var(--note-hr);
      }

      .sheet-footer {
        position: relative;
        z-index: 1;
        margin-top: calc(28px * var(--note-scale));
        padding: 0 calc(20px * var(--note-scale)) calc(16px * var(--note-scale));
        display: flex;
        align-items: center;
        gap: calc(4px * var(--note-scale));
        font-size: calc(0.38rem * var(--note-scale));
        line-height: 1;
      }

      .sheet-footer-copy {
        display: inline-flex;
        align-items: baseline;
        gap: calc(4px * var(--note-scale));
        min-width: 0;
        white-space: nowrap;
      }

      .sheet-footer-brand {
        color: var(--footer-copy);
        font-size: calc(0.4rem * var(--note-scale));
        font-weight: 500;
        letter-spacing: 0.01em;
      }

      .sheet-footer-via {
        color: var(--footer-via);
        font-size: calc(0.24rem * var(--note-scale));
        font-weight: 400;
        transform: translateY(calc(-0.01rem * var(--note-scale)));
      }

      .sheet-footer-icon {
        display: block;
        width: calc(0.5rem * var(--note-scale));
        height: calc(0.5rem * var(--note-scale));
        flex: 0 0 auto;
      }

      .sheet-footer-icon svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .sheet-footer-icon circle {
        fill: var(--footer-icon);
      }

      .sheet-footer-icon text {
        fill: var(--paper);
        font-family: "Georgia", "Times New Roman", serif;
        font-size: 18px;
        font-weight: 700;
        text-anchor: middle;
        dominant-baseline: middle;
        dy: 0.04em;
      }

      strong {
        color: inherit;
      }

      @media (max-width: 720px) {
        :root {
          --note-scale: 1.85;
        }

        body {
          padding: 24px 12px;
        }
      }

      @media (max-width: 650px) {
        :root {
          --note-scale: 1.75;
        }
      }

      @media (max-width: 600px) {
        :root {
          --note-scale: 1.6;
        }
      }

      @media (max-width: 540px) {
        :root {
          --note-scale: 1.45;
        }
      }

      @media (max-width: 490px) {
        :root {
          --note-scale: 1.28;
        }

        body {
          padding: 18px 8px;
        }
      }

      @media (max-width: 430px) {
        :root {
          --note-scale: 1.12;
        }
      }

      @media (max-width: 380px) {
        :root {
          --note-scale: 1;
        }
      }
    </style>
  </head>
  <body>
    <main class="preview-stage">${noteSheetHtml}</main>
  </body>
</html>
`;
}

async function buildArchive(
  markdown: string,
  footer: FooterConfig = {},
): Promise<{ filename: string; zipBuffer: Buffer }> {
  const basename = buildArchiveBasename(markdown);
  const folderName = basename;
  const assetFolderName = "INDEX.assets";
  const htmlAssetFolderName = "html.assets";
  const images: ArchiveImage[] = [];
  const replacements = new Map<string, string>();
  const htmlAssetEntries: ZipEntry[] = [];
  const fontAssets = await buildArchiveFontEntries(
    folderName,
    htmlAssetFolderName,
    markdown,
    footer,
  );

  try {
    htmlAssetEntries.push({
      path: `${folderName}/${htmlAssetFolderName}/bg.jpg`,
      data: await fs.readFile(path.join(publicDir, "bg.jpg")),
    });
  } catch (error) {
    console.warn("Archive HTML asset skipped", error);
  }

  for (const [index, source] of collectMarkdownImageSources(markdown).entries()) {
    try {
      const image = await resolveArchiveImage(source);

      if (!image?.buffer.length) {
        continue;
      }

      const extension = detectImageFormat(image.buffer, image.mimeType, image.filename);
      const fallbackName = `image-${index + 1}`;
      const baseFilename = sanitizeArchiveFilename(image.filename || source, fallbackName);
      const filename = path.extname(baseFilename)
        ? baseFilename
        : `${baseFilename}.${extension || "bin"}`;
      const uniqueFilename = getUniqueArchiveFilename(images, filename);

      images.push({
        source,
        filename: uniqueFilename,
        buffer: image.buffer,
      });
      replacements.set(source, `${assetFolderName}/${uniqueFilename}`);
    } catch (error) {
      console.warn(`Archive image skipped: ${source}`, error);
    }
  }

  let archivedMarkdown = markdown;

  for (const [source, replacement] of replacements) {
    archivedMarkdown = replaceAll(archivedMarkdown, source, replacement);
  }

  const entries: ZipEntry[] = [
    {
      path: `${folderName}/index.html`,
      data: Buffer.from(buildArchiveIndexHtml(archivedMarkdown, footer, fontAssets.fonts), "utf8"),
    },
    {
      path: `${folderName}/INDEX.md`,
      data: Buffer.from(archivedMarkdown, "utf8"),
    },
    ...htmlAssetEntries,
    ...fontAssets.entries,
    ...images.map((image) => ({
      path: `${folderName}/${assetFolderName}/${image.filename}`,
      data: image.buffer,
    })),
  ];

  return {
    filename: `${basename}.zip`,
    zipBuffer: createZip(entries),
  };
}

function getUniqueArchiveFilename(images: ArchiveImage[], filename: string): string {
  const used = new Set(images.map((image) => image.filename));

  if (!used.has(filename)) {
    return filename;
  }

  const parsed = path.parse(filename);
  let attempt = 2;

  while (used.has(`${parsed.name}-${attempt}${parsed.ext}`)) {
    attempt += 1;
  }

  return `${parsed.name}-${attempt}${parsed.ext}`;
}

function buildArchiveSubsetText(markdown: string, footer: FooterConfig): string {
  return [
    markdown,
    footer.brand ?? "由锤子便签发送",
    footer.via ?? "via Smartisan Notes",
    "不要因为走得太远，就忘了当初为什么出发。Don't forget why you started just because you've come so far.",
  ].join("\n");
}

async function buildArchiveFontEntries(
  folderName: string,
  htmlAssetFolderName: string,
  markdown: string,
  footer: FooterConfig,
): Promise<{ entries: ZipEntry[]; fonts: ArchiveFont[] }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "notes-font-subset-"));
  const textFilePath = path.join(tempDir, "subset-text.txt");
  const entries: ZipEntry[] = [];
  const fonts: ArchiveFont[] = [];

  try {
    await fs.writeFile(textFilePath, buildArchiveSubsetText(markdown, footer), "utf8");

    for (const font of archiveFonts) {
      const inputPath = path.join(rootDir, "src", "assets", "fonts", font.sourceName);
      const outputPath = path.join(tempDir, font.outputName);

      await execFileAsync("python3", [
        "-m",
        "fontTools.subset",
        inputPath,
        `--text-file=${textFilePath}`,
        `--output-file=${outputPath}`,
        "--flavor=woff2",
        "--layout-features=*",
        "--glyph-names",
        "--symbol-cmap",
        "--legacy-cmap",
        "--notdef-glyph",
        "--notdef-outline",
        "--recommended-glyphs",
      ]);

      entries.push({
        path: `${folderName}/${htmlAssetFolderName}/fonts/${font.outputName}`,
        data: await fs.readFile(outputPath),
      });
      fonts.push(font);
    }
  } catch (error) {
    console.warn("Archive font subsetting skipped", error);
    return {
      entries: [],
      fonts: [],
    };
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }

  return { entries, fonts };
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

function getDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);

  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function createZip(entries: ZipEntry[]): Buffer {
  const now = getDosDateTime(new Date());
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/\\/g, "/"), "utf8");
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(now.time, 10);
    localHeader.writeUInt16LE(now.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(now.time, 12);
    centralHeader.writeUInt16LE(now.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
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

app.post(
  "/api/archive",
  async (
    request: Request<Record<string, never>, unknown, ArchiveRequestBody>,
    response: Response,
  ) => {
    try {
      const body = request.body || {};
      const markdown = await resolveMarkdown(body);
      const archive = await buildArchive(markdown, resolveFooterConfig(body));

      response.setHeader("Content-Type", "application/zip");
      response.setHeader("Content-Disposition", `attachment; filename="${archive.filename}"`);
      response.send(archive.zipBuffer);
    } catch (error) {
      console.error("Archive request failed:", error);

      response.status(500).json({
        error: error instanceof Error ? error.message : "Failed to create archive",
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
