import express, { type NextFunction, type Request, type Response } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
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
import sharp, { type Metadata } from "sharp";
import { NoteSheet } from "../src/components/NoteSheet.js";
import { WechatArticle } from "../src/components/WechatArticle.js";
import {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
  FOOTER_LOGO_URL_MAX_LENGTH,
} from "../src/lib/footer.js";
import { splitSections } from "../src/lib/markdown.js";
import {
  buildNoteCardThemeCssVariables,
  getNoteCardThemeStyle,
  NOTE_CARD_THEME_STYLES,
} from "../src/lib/note-card-theme-styles.js";
import {
  getNoteTitle,
  orderNoteDocuments,
  parseNoteWorkspace,
} from "../src/lib/notes.js";
import type {
  NoteCardThemeId,
  NoteDocument,
  NoteWorkspace,
} from "../src/types/app.js";
import {
  isQiniuUrl,
  loadQiniuConfig,
  QiniuConfigurationError,
  QiniuUploadError,
  uploadImageBufferToQiniu,
} from "./qiniu.js";
import {
  AccountNotFoundError,
  AnonymousQuotaExceededError,
  createExpiredSessionCookie,
  createSessionCookie,
  createSessionToken,
  createSkillToken,
  DuplicateUsernameError,
  getShanghaiDateKey,
  InvalidCurrentPasswordError,
  InvalidNewPasswordError,
  InvalidWechatConfigurationError,
  InvalidUsernameError,
  normalizeUsername,
  NotesDataStore,
  readSessionToken,
  safeStringEqual,
  verifySessionToken,
  verifySkillToken,
  WorkspaceConflictError,
  type AnonymousQuotaStatus,
  type AuthRole,
  type AuthSession,
  type AuthUser,
} from "./auth.js";
import {
  checkAiAvailability,
  createAiSuggestions,
  isAiAvailable,
} from "./ai.js";
import {
  addWechatDraft,
  clearWechatAccessToken,
  getWechatAccessToken,
  uploadWechatContentImage,
  uploadWechatPermanentImage,
  WechatOfficialApiError,
  type WechatImageUpload,
  type WechatOfficialConfiguration,
} from "./wechat-official.js";

interface ExportRequestBody {
  markdown?: string;
  markdownPath?: string;
  theme?: string;
  filename?: string;
  footerBrand?: string;
  footerLogoUrl?: string;
  footerVia?: string;
}

interface ImageImportRequestBody {
  sourceUrl?: string;
}

interface ArchiveRequestBody {
  markdown?: string;
  markdownPath?: string;
  theme?: string;
  footerBrand?: string;
  footerLogoUrl?: string;
  footerVia?: string;
}

interface WorkspaceArchiveRequestBody {
  workspace?: unknown;
}

interface WechatRequestBody {
  markdown?: string;
  markdownPath?: string;
  theme?: string;
  footerBrand?: string;
  footerLogoUrl?: string;
  footerVia?: string;
}

interface LoginRequestBody {
  password?: string;
  remember?: boolean;
  username?: string;
}

interface CreateUserRequestBody {
  username?: string;
}

interface ChangePasswordRequestBody {
  currentPassword?: string;
  newPassword?: string;
}

interface WorkspaceRequestBody {
  expectedUpdatedAt?: number | null;
  workspace?: unknown;
}

interface AiSuggestionsRequestBody {
  instruction?: unknown;
  markdown?: unknown;
}

interface WechatConfigurationRequestBody {
  appId?: unknown;
  appSecret?: unknown;
}

interface WechatDraftRequestBody extends WechatRequestBody {}

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
  logoUrl?: string;
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
  mode?: number;
}

interface ArchiveFont {
  sourceName: string;
  outputName: string;
  weight: number;
}

type WorkspaceArchiveJobStatus =
  | "preparing"
  | "collecting"
  | "packaging"
  | "ready"
  | "failed";

interface WorkspaceArchiveJob {
  id: string;
  status: WorkspaceArchiveJobStatus;
  progress: number;
  message: string;
  completedNotes: number;
  totalNotes: number;
  createdAt: number;
  error?: string;
  filename?: string;
  zipBuffer?: Buffer;
}

interface WorkspaceArchiveBuildProgress {
  status: Extract<WorkspaceArchiveJobStatus, "collecting" | "packaging">;
  progress: number;
  message: string;
  completedNotes: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir =
  path.basename(__dirname) === "server" && path.basename(path.dirname(__dirname)) === "dist-server"
    ? path.resolve(__dirname, "..", "..")
    : path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");
const workspaceSkillDir = path.join(rootDir, "skills", "notes-workspace-api");
const imagesDir = process.env.IMAGE_STORAGE_DIR || path.join(rootDir, "storage", "images");
const dataDirectory =
  process.env.DATA_STORAGE_DIR || path.join(rootDir, "storage", "data");
const port = Number(process.env.PORT || 3001);
const anonymousDailyUploadLimit = Math.max(
  1,
  Number.parseInt(process.env.ANONYMOUS_DAILY_UPLOAD_LIMIT || "500", 10) ||
    500,
);
const supportedThemes = new Set<NoteCardThemeId>(
  Object.keys(NOTE_CARD_THEME_STYLES) as NoteCardThemeId[],
);

class UnsupportedExportThemeError extends Error {
  constructor(theme: unknown) {
    super(`不支持的导出主题：${String(theme)}`);
    this.name = "UnsupportedExportThemeError";
  }
}

class WechatDraftPreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WechatDraftPreparationError";
  }
}
const maxImageSizeBytes = 20 * 1024 * 1024;
const maxAiMarkdownLength = 100_000;
const maxAiInstructionLength = 2_000;
const aiRequestWindowMs = 10 * 60 * 1_000;
const maxAiRequestsPerWindow = 10;
const maxWorkspaceArchiveNotes = 2_000;
const maxWorkspaceArchiveUncompressedBytes = 512 * 1024 * 1024;
const maxConcurrentWorkspaceArchiveJobs = 2;
const maxRetainedWorkspaceArchiveJobs = 8;
const maxRetainedWorkspaceArchiveBytes = 640 * 1024 * 1024;
const workspaceArchiveJobLifetimeMs = 30 * 60 * 1_000;
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
const activeAiUsers = new Set<string>();
const aiRequestHistory = new Map<string, number[]>();
const workspaceArchiveJobs = new Map<string, WorkspaceArchiveJob>();
const notesDataStore = new NotesDataStore(dataDirectory);
const execFileAsync = promisify(execFile);
const defaultWechatFooterHammerUrl =
  "https://notes.fangyuanxiaozhan.com/images/b5d3bd9587fa9a1226b25a0709ff61a450df29d96ca2f127c6afc0b8e193a60e.png";
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

function buildRenderUrl(
  baseUrl: string,
  theme: NoteCardThemeId,
  footer?: FooterConfig,
): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("renderMode", "playwright");
  url.searchParams.set("theme", theme);

  if (footer?.brand != null) {
    url.searchParams.set("footerBrand", footer.brand);
  }

  if (footer?.logoUrl != null) {
    url.searchParams.set("footerLogoUrl", footer.logoUrl);
  }

  if (footer?.via != null) {
    url.searchParams.set("footerVia", footer.via);
  }

  return url.toString();
}

function getRenderUrl(
  request: Request,
  theme: NoteCardThemeId,
  footer?: FooterConfig,
): string {
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

function getNotesPublicBaseUrl(request: Request): string {
  const configured = process.env.NOTES_PUBLIC_BASE_URL?.trim();
  const url = new URL(configured || getPublicBaseUrl(request));

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NOTES_PUBLIC_BASE_URL 只支持 HTTP 或 HTTPS 地址。");
  }

  url.hash = "";
  url.pathname = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

async function buildHermesSkillPackage(
  request: Request,
  token: string,
): Promise<Buffer> {
  const packageRoot = "notes-workspace-api";
  const templateFiles = [
    { mode: 0o100644, relativePath: "SKILL.md" },
    { mode: 0o100755, relativePath: "scripts/notes_api.mjs" },
    { mode: 0o100644, relativePath: "references/workspace-api.md" },
  ];
  const entries = await Promise.all(
    templateFiles.map(async ({ mode, relativePath }) => ({
      data: await fs.readFile(path.join(workspaceSkillDir, relativePath)),
      mode,
      path: `${packageRoot}/${relativePath}`,
    })),
  );
  const env = [
    `NOTES_API_BASE_URL=${getNotesPublicBaseUrl(request)}`,
    `NOTES_API_TOKEN=${token}`,
    "",
  ].join("\n");

  entries.push({
    data: Buffer.from(env, "utf8"),
    mode: 0o100600,
    path: `${packageRoot}/.env`,
  });

  return createZip(entries);
}

function applyHermesDownloadHeaders(response: Response): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Type", "application/zip");
  response.setHeader(
    "Content-Disposition",
    'attachment; filename="notes-workspace-api.zip"',
  );
}

function applyCorsHeaders(request: Request, response: Response): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    request.get("access-control-request-headers") || "Content-Type, Authorization",
  );
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Disposition, X-Export-Path, X-Export-Url, X-Export-Theme",
  );
}

function isSecureRequest(request: Request): boolean {
  return (
    request.secure ||
    request.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}

function setAuthenticatedSession(
  request: Request,
  response: Response,
  user: AuthUser,
  remember: boolean,
  passwordVersion?: number,
): void {
  response.setHeader(
    "Set-Cookie",
    createSessionCookie(createSessionToken(user, remember, Date.now(), passwordVersion), {
      remember,
      secure: isSecureRequest(request),
    }),
  );
}

function clearAuthenticatedSession(
  request: Request,
  response: Response,
): void {
  response.setHeader(
    "Set-Cookie",
    createExpiredSessionCookie(isSecureRequest(request)),
  );
}

function getSuperAdminCredentials(): {
  password: string;
  username: string;
} | null {
  const username = process.env.SUPERADMIN?.trim();
  const password = process.env.SUPERADMINPASSWORD?.trim();

  return username && password ? { password, username } : null;
}

async function getAuthenticatedUser(
  request: Request,
): Promise<AuthSession | null> {
  const session = verifySessionToken(readSessionToken(request.get("cookie")));

  if (!session) {
    return null;
  }

  if (session.role === "superadmin") {
    const credentials = getSuperAdminCredentials();

    return credentials &&
      session.id === "superadmin" &&
      safeStringEqual(
        normalizeUsername(session.username),
        normalizeUsername(credentials.username),
      )
      ? session
      : null;
  }

  const account = await notesDataStore.getUserById(session.id);

  return account &&
    account.passwordVersion === (session.passwordVersion ?? 1) &&
    safeStringEqual(
      normalizeUsername(account.username),
      normalizeUsername(session.username),
    )
    ? session
    : null;
}

function readBearerToken(request: Request): string | undefined {
  const authorization = request.get("authorization")?.trim();
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1];
}

async function getAuthenticatedSkillUser(
  request: Request,
): Promise<AuthSession | null> {
  const session = verifySkillToken(readBearerToken(request));

  if (!session) {
    return null;
  }

  if (session.role === "superadmin") {
    return session;
  }

  const account = await notesDataStore.getUserById(session.id);

  return account &&
    account.passwordVersion === session.passwordVersion &&
    account.skillTokenVersion === session.skillTokenVersion &&
    safeStringEqual(
      normalizeUsername(account.username),
      normalizeUsername(session.username),
    )
    ? session
    : null;
}

async function getWorkspaceUser(request: Request): Promise<AuthSession | null> {
  return (
    (await getAuthenticatedUser(request)) ??
    (await getAuthenticatedSkillUser(request))
  );
}

async function createSkillTokenForUser(user: AuthUser): Promise<string | null> {
  if (user.role === "superadmin") {
    return createSkillToken(user);
  }

  const account = await notesDataStore.getUserById(user.id);

  return account
    ? createSkillToken(
        user,
        account.passwordVersion,
        account.skillTokenVersion,
      )
    : null;
}

async function getSkillTokenForHermesInstallTicket(
  ticket: string,
): Promise<string | null> {
  const ownerId = await notesDataStore.getHermesInstallLinkOwner(ticket);

  if (!ownerId) {
    return null;
  }

  if (ownerId === "superadmin") {
    const credentials = getSuperAdminCredentials();
    return credentials
      ? createSkillToken({
          id: "superadmin",
          role: "superadmin",
          username: credentials.username,
        })
      : null;
  }

  const account = await notesDataStore.getUserById(ownerId);
  return account
    ? createSkillToken(
        {
          id: account.id,
          role: "user",
          username: account.username,
        },
        account.passwordVersion,
        account.skillTokenVersion,
      )
    : null;
}

async function requireAuthenticatedUser(
  request: Request,
  response: Response,
  role: AuthRole,
): Promise<AuthSession | null> {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    response.status(401).json({
      error: role === "superadmin" ? "请先登录管理员后台。" : "请先登录账号。",
    });
    return null;
  }

  if (user.role !== role) {
    response.status(403).json({
      error:
        role === "superadmin"
          ? "当前账号没有管理员权限。"
          : "管理员密码由服务端环境变量维护，不能在便签页面修改。",
    });
    return null;
  }

  return user;
}

function getPublicAuthUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    role: user.role,
    username: user.username,
  };
}

function resolveLoginCredentials(body: LoginRequestBody | undefined): {
  password: string;
  remember: boolean;
  username: string;
} | null {
  const username = body?.username?.trim();
  const password = body?.password;

  if (!username || !password) {
    return null;
  }

  return {
    password,
    remember: body?.remember === true,
    username,
  };
}

function authenticateSuperAdmin(
  credentials: ReturnType<typeof resolveLoginCredentials>,
): AuthUser | null {
  const configured = getSuperAdminCredentials();

  if (
    !credentials ||
    !configured ||
    !safeStringEqual(
      normalizeUsername(credentials.username),
      normalizeUsername(configured.username),
    ) ||
    !safeStringEqual(credentials.password, configured.password)
  ) {
    return null;
  }

  return {
    id: "superadmin",
    role: "superadmin",
    username: configured.username,
  };
}

async function requireNoteServiceUser(
  request: Request,
  response: Response,
): Promise<AuthSession | null> {
  const user = await getAuthenticatedUser(request);

  if (!user) {
    response.status(401).json({ error: "请先登录账号。" });
    return null;
  }

  return user;
}

async function requireWorkspaceUser(
  request: Request,
  response: Response,
): Promise<AuthSession | null> {
  const user = await getWorkspaceUser(request);

  if (!user) {
    response.status(401).json({ error: "请先登录账号或提供有效的 Skill Token。" });
    return null;
  }

  return user;
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.get("origin");

  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.origin === new URL(getPublicBaseUrl(request)).origin;
  } catch {
    return false;
  }
}

function consumeAiRateLimit(userId: string): number | null {
  const now = Date.now();
  const earliestAllowed = now - aiRequestWindowMs;
  const history = (aiRequestHistory.get(userId) || []).filter(
    (timestamp) => timestamp > earliestAllowed,
  );

  if (history.length >= maxAiRequestsPerWindow) {
    aiRequestHistory.set(userId, history);
    return Math.max(
      1,
      Math.ceil((history[0] + aiRequestWindowMs - now) / 1_000),
    );
  }

  history.push(now);
  aiRequestHistory.set(userId, history);
  return null;
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

  const currentBrowserPromise = browserPromise;

  try {
    const browser = await currentBrowserPromise;

    if (!browser.isConnected()) {
      if (browserPromise === currentBrowserPromise) {
        browserPromise = undefined;
      }

      return getBrowser();
    }

    return browser;
  } catch (error) {
    if (browserPromise === currentBrowserPromise) {
      browserPromise = undefined;
    }

    throw error;
  }
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

function resolveTheme(body: ExportRequestBody): NoteCardThemeId {
  if (body.theme == null || body.theme === "") {
    return "default";
  }

  if (
    typeof body.theme === "string" &&
    supportedThemes.has(body.theme as NoteCardThemeId)
  ) {
    return body.theme as NoteCardThemeId;
  }

  throw new UnsupportedExportThemeError(body.theme);
}

function normalizeFooterText(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  return input.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 80);
}

function normalizeFooterLogoUrl(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }

  const value = input
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, FOOTER_LOGO_URL_MAX_LENGTH);

  if (
    (value.startsWith("/") && !value.startsWith("//")) ||
    /^https?:\/\//i.test(value) ||
    /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
  ) {
    return value;
  }

  return undefined;
}

function resolveFooterConfig(body: ExportRequestBody): FooterConfig {
  return {
    brand: normalizeFooterText(body.footerBrand),
    logoUrl: normalizeFooterLogoUrl(body.footerLogoUrl),
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

async function resolveArchiveImage(
  source: string,
  publicBaseUrl?: string,
): Promise<ImageSource | null> {
  const dataImage = getDataUrlImage(source);

  if (dataImage) {
    return dataImage;
  }

  if (/^https?:\/\//i.test(source)) {
    if (publicBaseUrl) {
      try {
        const sourceUrl = new URL(source);
        const publicUrl = new URL(publicBaseUrl);

        if (
          sourceUrl.host.toLowerCase() === publicUrl.host.toLowerCase() &&
          sourceUrl.pathname.startsWith("/images/")
        ) {
          return readRootRelativeArchiveImage(
            `${sourceUrl.pathname}${sourceUrl.search}`,
          );
        }
      } catch {
        // Invalid URLs fall through to the existing remote-image path.
      }
    }

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
  const footerBrand = footer.brand ?? DEFAULT_FOOTER_BRAND;
  const footerVia = footer.via ?? DEFAULT_FOOTER_VIA;

  return renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections(markdown),
      footerBrand: createElement("span", { className: "sheet-footer-brand" }, footerBrand),
      footerLogoUrl: footer.logoUrl ?? DEFAULT_FOOTER_LOGO_URL,
      footerVia: createElement("span", { className: "sheet-footer-via" }, footerVia),
    }),
  );
}

function buildArchiveIndexHtml(
  markdown: string,
  footer: FooterConfig,
  fonts: ArchiveFont[],
  theme: NoteCardThemeId,
): string {
  const noteSheetHtml = renderArchiveNoteSheet(markdown, footer);
  const fontFaceCss = buildArchiveFontFaceCss(fonts);
  const fontFamilyPrefix = fonts.length ? `"OPPOSansArchive", ` : "";
  const themeStyle = getNoteCardThemeStyle(theme);
  const usesBundledOppoSans =
    theme === "default" || theme === "smartisan-dark" || theme === "bazhahei";
  const archiveFontFamily =
    usesBundledOppoSans
      ? `${fontFamilyPrefix}${themeStyle.fontFamily}`
      : themeStyle.fontFamily;
  const archiveHeadingFontFamily =
    usesBundledOppoSans
      ? `${fontFamilyPrefix}${themeStyle.headingFontFamily}`
      : themeStyle.headingFontFamily;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>便签归档预览</title>
    <style>
${fontFaceCss}
      :root {
        ${buildNoteCardThemeCssVariables(theme)}
        --note-font: ${archiveFontFamily};
        --note-heading-font: ${archiveHeadingFontFamily};
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
          calc(16px * var(--note-scale))
          calc(24px * var(--note-scale));
        border-radius: 0;
        border: 0;
        background: var(--sheet-surface);
        box-shadow: var(--sheet-shadow);
        font-family: var(--note-font);
        overflow: hidden;
      }

      .note-apple-toolbar {
        position: absolute;
        z-index: 2;
        top: calc(8px * var(--note-scale));
        right: calc(12px * var(--note-scale));
        left: calc(12px * var(--note-scale));
        display: none;
        align-items: center;
        justify-content: space-between;
        color: var(--note-link);
        font-family: var(--note-font);
        font-size: calc(1.0625rem * var(--note-scale));
        font-weight: 400;
        line-height: 1;
        pointer-events: none;
      }

      .note-apple-back,
      .note-apple-actions {
        display: inline-flex;
        align-items: center;
      }

      .note-apple-back {
        gap: calc(2px * var(--note-scale));
      }

      .note-apple-back-chevron {
        font-size: calc(1.5rem * var(--note-scale));
        font-weight: 300;
        line-height: 0.7;
        transform: translateY(calc(-0.5px * var(--note-scale)));
      }

      .note-apple-actions {
        gap: calc(12px * var(--note-scale));
      }

      .note-apple-action-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
      }

      .note-apple-action-icon svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
        fill: currentColor;
      }

      .note-apple-share {
        width: calc(14.2px * var(--note-scale));
        height: calc(19.2px * var(--note-scale));
      }

      .note-apple-compose {
        width: calc(17.7px * var(--note-scale));
        height: calc(17.1px * var(--note-scale));
      }

      .sheet-frame {
        position: absolute;
        pointer-events: none;
        border: 1px solid var(--note-frame);
      }

      .sheet-frame-outer {
        inset:
          calc(16px * var(--note-scale))
          calc(9.6667px * var(--note-scale))
          calc(58px * var(--note-scale));
      }

      .sheet-frame-inner {
        inset:
          calc(18.6667px * var(--note-scale))
          calc(11.6667px * var(--note-scale))
          calc(59.6667px * var(--note-scale));
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
        left: calc(7.6667px * var(--note-scale));
        top: calc(15px * var(--note-scale));
      }

      .sheet-corner-top-right {
        right: calc(7.6667px * var(--note-scale));
        top: calc(15px * var(--note-scale));
      }

      .sheet-corner-bottom-left {
        left: calc(7.6667px * var(--note-scale));
        bottom: calc(55.1667px * var(--note-scale));
      }

      .sheet-corner-bottom-right {
        right: calc(7.6667px * var(--note-scale));
        bottom: calc(55.1667px * var(--note-scale));
      }

      .sheet-inner {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 0;
        padding:
          calc(34px * var(--note-scale))
          calc(16px * var(--note-scale))
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
        font-size: calc(0.76rem * var(--note-scale));
        font-weight: 400;
        line-height: 1.8;
        letter-spacing: 0.03em;
        -webkit-text-stroke:
          calc(0.15px * var(--note-scale))
          color-mix(in srgb, currentColor 62%, transparent);
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

      .note-copy img.note-image-frame {
        display: block;
        box-sizing: border-box;
        width: auto;
        max-width: 100%;
        height: auto;
        margin:
          calc(12px * var(--note-scale))
          auto
          calc(2px * var(--note-scale));
        padding: calc(3px * var(--note-scale));
        border: 1px solid var(--note-image-frame);
        border-radius: 0;
        box-shadow:
          0 calc(1px * var(--note-scale)) calc(3px * var(--note-scale))
          var(--note-image-shadow);
        background: var(--note-image-mat);
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
        margin:
          calc(8px * var(--note-scale))
          0
          calc(8px * var(--note-scale));
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
        margin:
          calc(30px * var(--note-scale))
          0
          0
          calc(0.6667px * var(--note-scale));
        padding: 0 0 calc(16.6667px * var(--note-scale));
        display: flex;
        align-items: center;
        gap: calc(6px * var(--note-scale));
        font-size: calc(0.38rem * var(--note-scale));
        line-height: 1;
      }

      .sheet-footer-copy {
        display: inline-flex;
        align-items: baseline;
        gap: calc(5px * var(--note-scale));
        min-width: 0;
        white-space: nowrap;
      }

      .sheet-footer-brand {
        color: var(--footer-copy);
        font-size: calc(0.5rem * var(--note-scale));
        font-weight: 500;
        letter-spacing: 0.01em;
      }

      .sheet-footer-via {
        color: var(--footer-via);
        font-size: calc(0.42rem * var(--note-scale));
        font-weight: 400;
        transform: translateY(calc(-0.01rem * var(--note-scale)));
      }

      .sheet-footer-icon {
        display: block;
        width: calc(0.64rem * var(--note-scale));
        height: calc(0.64rem * var(--note-scale));
        flex: 0 0 auto;
      }

      .sheet-footer-icon img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .sheet-footer-icon.is-default-footer-logo img {
        filter: var(--default-footer-logo-filter);
        opacity: var(--default-footer-logo-opacity);
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

      body[data-note-card-theme^="apple-notes"] .sheet-frame,
      body[data-note-card-theme^="apple-notes"] .sheet-corner {
        display: none;
      }

      body[data-note-card-theme^="apple-notes"] .sheet-inner {
        padding-right: 0;
        padding-left: 0;
      }

      body[data-note-card-theme^="apple-notes"] .note-sheet {
        padding-right: calc(12px * var(--note-scale));
        padding-left: calc(12px * var(--note-scale));
      }

      body[data-note-card-theme^="apple-notes"] .note-copy {
        letter-spacing: 0.01em;
        line-height: 1.65;
        -webkit-text-stroke: 0;
      }

      body[data-note-card-theme^="apple-notes"] .note-index h2,
      body[data-note-card-theme^="apple-notes"] .note-index h2 strong,
      body[data-note-card-theme^="apple-notes"] .note-copy strong {
        font-weight: 600;
      }

      body[data-note-card-theme^="apple-notes"] .note-apple-toolbar {
        display: flex;
      }

      body[data-note-card-theme="bear"] {
        --bear-block-gap: max(calc(0.33rem * var(--note-scale)), 8.448px);
      }

      body[data-note-card-theme="bear"] .note-sheet {
        padding:
          calc(20px * var(--note-scale))
          calc(18px * var(--note-scale))
          calc(24px * var(--note-scale));
      }

      body[data-note-card-theme="bear"] .sheet-frame,
      body[data-note-card-theme="bear"] .sheet-corner {
        display: none;
      }

      body[data-note-card-theme="bear"] .sheet-inner {
        padding: 0;
      }

      body[data-note-card-theme="bear"] .note-section.is-document-title {
        margin-top: 0;
      }

      body[data-note-card-theme="bear"] .note-section.has-heading {
        margin-top: var(--bear-block-gap);
      }

      body[data-note-card-theme="bear"] .note-section.has-heading:first-child {
        margin-top: 0;
      }

      body[data-note-card-theme="bear"] .note-index {
        margin-bottom: var(--bear-block-gap);
      }

      body[data-note-card-theme="bear"] .note-index h2,
      body[data-note-card-theme="bear"] .note-index h2 strong {
        color: var(--note-heading);
        font-family: var(--note-font);
        font-size: max(calc(0.75rem * var(--note-scale)), 18px);
        font-weight: 400;
        line-height: 1.521;
        padding-block: 0.66em 0.27em;
      }

      body[data-note-card-theme="bear"] .note-copy {
        color: var(--note-copy);
        font-size: max(calc(0.46875rem * var(--note-scale)), 12px);
        line-height: 1.755;
        letter-spacing: 0;
        -webkit-text-stroke: 0;
      }

      body[data-note-card-theme="bear"] .note-copy h1,
      body[data-note-card-theme="bear"] .note-copy h2,
      body[data-note-card-theme="bear"] .note-copy h3,
      body[data-note-card-theme="bear"] .note-copy h4,
      body[data-note-card-theme="bear"] .note-copy h5,
      body[data-note-card-theme="bear"] .note-copy h6 {
        font-family: var(--note-font);
        font-weight: 400;
        line-height: 1.521;
      }

      body[data-note-card-theme="bear"] .note-copy h1 {
        font-size: max(calc(0.9375rem * var(--note-scale)), 22px);
        padding-block: 0.8em 0.33em;
      }

      body[data-note-card-theme="bear"] .note-copy h2 {
        font-size: max(calc(0.75rem * var(--note-scale)), 18px);
        padding-block: 0.66em 0.27em;
      }

      body[data-note-card-theme="bear"] .note-copy h3 {
        font-size: max(calc(0.5953125rem * var(--note-scale)), 15px);
        padding-block: 0.53em 0.27em;
      }

      body[data-note-card-theme="bear"] .note-copy h4,
      body[data-note-card-theme="bear"] .note-copy h5,
      body[data-note-card-theme="bear"] .note-copy h6 {
        font-size: max(calc(0.46875rem * var(--note-scale)), 12px);
        padding-block: 0.4em 0.27em;
      }

      body[data-note-card-theme="bear"] .note-copy strong {
        color: var(--note-link);
        font-weight: 700;
      }

      body[data-note-card-theme="bear"] .note-copy .markdown-blank-line {
        height: var(--bear-block-gap);
      }

      body[data-note-card-theme="bear"] .note-copy code,
      body[data-note-card-theme="bear"] .note-copy pre {
        border-radius: 0.25em;
      }

      body[data-note-card-theme="bear"] .note-copy pre {
        margin: 0;
        padding: 0 0.5em;
        font-size: max(calc(0.4265625rem * var(--note-scale)), 11px);
        line-height: 1.755;
      }

      body[data-note-card-theme="bear"] .note-copy blockquote {
        margin: 0;
        padding-inline-start: 2.13em;
        color: var(--note-copy);
        font-size: inherit;
        line-height: inherit;
      }

      body[data-note-card-theme="bear"] .note-copy blockquote::before {
        content: "";
        box-sizing: content-box;
        top: 0.2em;
        bottom: auto;
        left: 0;
        width: 0.13em;
        height: calc(100% - 0.4em);
        border: 0.0667em solid var(--note-link);
        border-radius: 0.33em;
        background: var(--note-link);
      }

      body[data-note-card-theme="bear"] .note-copy li::marker {
        color: var(--note-link);
      }

      body[data-note-card-theme="bear"] .note-copy table {
        width: auto;
        max-width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        border-radius: 0.33em;
        table-layout: auto;
        overflow: hidden;
      }

      body[data-note-card-theme="bear"] .note-copy img.note-image-frame {
        padding: 0;
        border: 0;
        box-shadow: none;
        background: transparent;
      }

      body[data-note-card-theme="bear"] .sheet-footer {
        margin-top: calc(24px * var(--note-scale));
      }

      body[data-note-card-theme="bazhahei"] {
        --bazhahei-accent: #d4734b;
        --bazhahei-surface: #efe9de;
        --bazhahei-hairline: #e6dfd8;
        --bazhahei-block-gap: max(calc(0.5rem * var(--note-scale)), 12px);
      }

      body[data-note-card-theme="bazhahei"] .note-sheet {
        padding:
          calc(18px * var(--note-scale))
          calc(16px * var(--note-scale))
          calc(24px * var(--note-scale));
      }

      body[data-note-card-theme="bazhahei"] .sheet-frame,
      body[data-note-card-theme="bazhahei"] .sheet-corner {
        display: none;
      }

      body[data-note-card-theme="bazhahei"] .sheet-inner {
        padding: 0;
      }

      body[data-note-card-theme="bazhahei"] .note-section.is-document-title {
        margin-top: 0;
      }

      body[data-note-card-theme="bazhahei"] .note-section.is-document-title .note-centered-line {
        margin-bottom: calc(12px * var(--note-scale));
        text-align: center;
      }

      body[data-note-card-theme="bazhahei"] .note-section.has-heading {
        margin-top: calc(20px * var(--note-scale));
      }

      body[data-note-card-theme="bazhahei"] .note-section.has-heading:first-child {
        margin-top: 0;
      }

      body[data-note-card-theme="bazhahei"] .note-index {
        margin-bottom: calc(8px * var(--note-scale));
      }

      body[data-note-card-theme="bazhahei"] .note-index h2 {
        color: var(--note-heading);
        font-family: var(--note-heading-font);
        font-size: max(calc(0.625rem * var(--note-scale)), 17px);
        font-weight: 700;
        line-height: 1.5;
      }

      body[data-note-card-theme="bazhahei"] .note-index h2::before {
        content: "■";
        margin-right: 0.38em;
      }

      body[data-note-card-theme="bazhahei"] .note-copy {
        color: var(--note-copy);
        font-family: var(--note-font);
        font-size: max(calc(0.46875rem * var(--note-scale)), 13px);
        line-height: 1.8;
        letter-spacing: 0;
        -webkit-text-stroke: 0;
      }

      body[data-note-card-theme="bazhahei"] .note-copy h1,
      body[data-note-card-theme="bazhahei"] .note-copy h2,
      body[data-note-card-theme="bazhahei"] .note-copy h3,
      body[data-note-card-theme="bazhahei"] .note-copy h4,
      body[data-note-card-theme="bazhahei"] .note-copy h5,
      body[data-note-card-theme="bazhahei"] .note-copy h6 {
        color: var(--note-heading);
        font-family: var(--note-heading-font);
        font-weight: 700;
        line-height: 1.5;
        letter-spacing: 0;
      }

      body[data-note-card-theme="bazhahei"] .note-copy h1 {
        padding-block:
          calc(10px * var(--note-scale))
          calc(8px * var(--note-scale));
        font-size: max(calc(0.9375rem * var(--note-scale)), 24px);
        line-height: 1.4;
        text-align: center;
      }

      body[data-note-card-theme="bazhahei"] .note-copy h2 {
        padding-block:
          calc(10px * var(--note-scale))
          calc(6px * var(--note-scale));
        font-size: max(calc(0.625rem * var(--note-scale)), 17px);
      }

      body[data-note-card-theme="bazhahei"] .note-copy h2::before {
        content: "■";
        margin-right: 0.38em;
      }

      body[data-note-card-theme="bazhahei"] .note-copy h3 {
        display: inline;
        padding-bottom: 0.12em;
        border-bottom: 0.16em solid var(--bazhahei-accent);
        font-size: max(calc(0.53125rem * var(--note-scale)), 15px);
      }

      body[data-note-card-theme="bazhahei"] .note-copy strong {
        color: var(--note-heading);
        font-weight: 700;
      }

      body[data-note-card-theme="bazhahei"] .note-copy a {
        color: var(--bazhahei-accent);
        text-decoration: none;
        border-bottom: 0.1em solid currentColor;
      }

      body[data-note-card-theme="bazhahei"] .note-copy .markdown-blank-line {
        height: var(--bazhahei-block-gap);
      }

      body[data-note-card-theme="bazhahei"] .note-copy code {
        border-radius: calc(3px * var(--note-scale));
      }

      body[data-note-card-theme="bazhahei"] .note-copy pre {
        margin: calc(10px * var(--note-scale)) 0;
        border-radius: calc(8px * var(--note-scale));
      }

      body[data-note-card-theme="bazhahei"] .note-copy blockquote {
        margin: calc(12px * var(--note-scale)) 0;
        padding:
          calc(12px * var(--note-scale))
          calc(14px * var(--note-scale));
        border: 0;
        border-radius: calc(8px * var(--note-scale));
        background: var(--bazhahei-surface);
        color: var(--note-quote);
        font-size: inherit;
        line-height: 1.8;
      }

      body[data-note-card-theme="bazhahei"] .note-copy blockquote::before {
        content: none;
      }

      body[data-note-card-theme="bazhahei"] .note-copy ul,
      body[data-note-card-theme="bazhahei"] .note-copy ol {
        margin: calc(8px * var(--note-scale)) 0;
        padding-left: 1.4em;
      }

      body[data-note-card-theme="bazhahei"] .note-copy li::marker {
        color: var(--bazhahei-accent);
        font-weight: 700;
      }

      body[data-note-card-theme="bazhahei"] .note-copy table {
        margin: calc(12px * var(--note-scale)) 0;
        font-size: inherit;
        line-height: 1.6;
      }

      body[data-note-card-theme="bazhahei"] .note-copy img.note-image-frame {
        margin: calc(12px * var(--note-scale)) auto calc(4px * var(--note-scale));
        padding: 0;
        border: 1px solid var(--bazhahei-hairline);
        border-radius: calc(8px * var(--note-scale));
      }

      body[data-note-card-theme="bazhahei"] .sheet-footer {
        margin-top: calc(24px * var(--note-scale));
      }

      body[data-note-card-theme="telegraph"] {
        --telegraph-block-gap: max(calc(0.375rem * var(--note-scale)), 10.5px);
      }

      body[data-note-card-theme="telegraph"] .note-sheet {
        padding:
          calc(10.5px * var(--note-scale))
          calc(10.5px * var(--note-scale))
          calc(21px * var(--note-scale));
      }

      body[data-note-card-theme="telegraph"] .sheet-frame,
      body[data-note-card-theme="telegraph"] .sheet-corner {
        display: none;
      }

      body[data-note-card-theme="telegraph"] .sheet-inner {
        padding: 0;
      }

      body[data-note-card-theme="telegraph"] .note-section.is-document-title {
        margin-top: 0;
      }

      body[data-note-card-theme="telegraph"] .note-section.is-document-title .note-centered-line {
        margin-bottom: 0;
        text-align: left;
      }

      body[data-note-card-theme="telegraph"] .note-section.has-heading {
        margin-top: calc(9px * var(--note-scale));
      }

      body[data-note-card-theme="telegraph"] .note-section.has-heading:first-child {
        margin-top: 0;
      }

      body[data-note-card-theme="telegraph"] .note-index {
        margin-bottom: calc(4.5px * var(--note-scale));
      }

      body[data-note-card-theme="telegraph"] .note-index h2,
      body[data-note-card-theme="telegraph"] .note-index h2 strong {
        color: var(--note-heading);
        font-family: var(--note-heading-font);
        font-size: max(calc(0.875rem * var(--note-scale)), 24px);
        font-weight: 700;
        line-height: 1.1;
      }

      body[data-note-card-theme="telegraph"] .note-copy {
        color: var(--note-copy);
        font-size: max(calc(0.5625rem * var(--note-scale)), 16px);
        line-height: 1.58;
        letter-spacing: 0;
        -webkit-text-stroke: 0;
      }

      body[data-note-card-theme="telegraph"] .note-copy h1,
      body[data-note-card-theme="telegraph"] .note-copy h2,
      body[data-note-card-theme="telegraph"] .note-copy h3,
      body[data-note-card-theme="telegraph"] .note-copy h4,
      body[data-note-card-theme="telegraph"] .note-copy h5,
      body[data-note-card-theme="telegraph"] .note-copy h6 {
        color: var(--note-heading);
        font-family: var(--note-heading-font);
        font-weight: 700;
        letter-spacing: 0;
      }

      body[data-note-card-theme="telegraph"] .note-copy h1 {
        padding-block:
          calc(10.5px * var(--note-scale))
          calc(6px * var(--note-scale));
        font-size: max(calc(1rem * var(--note-scale)), 28px);
        line-height: 1.0625;
      }

      body[data-note-card-theme="telegraph"] .note-copy h2 {
        padding-block:
          calc(9px * var(--note-scale))
          calc(3.5px * var(--note-scale));
        font-size: max(calc(0.75rem * var(--note-scale)), 21px);
        line-height: 1.1;
      }

      body[data-note-card-theme="telegraph"] .note-copy h3 {
        padding-block:
          calc(9px * var(--note-scale))
          calc(4.5px * var(--note-scale));
        font-size: max(calc(0.875rem * var(--note-scale)), 24px);
        line-height: 1.1;
      }

      body[data-note-card-theme="telegraph"] .note-copy h4,
      body[data-note-card-theme="telegraph"] .note-copy h5,
      body[data-note-card-theme="telegraph"] .note-copy h6 {
        padding-block:
          calc(9px * var(--note-scale))
          calc(3.5px * var(--note-scale));
        font-size: max(calc(0.75rem * var(--note-scale)), 21px);
        line-height: 1.1;
      }

      body[data-note-card-theme="telegraph"] .note-copy strong {
        font-weight: 700;
      }

      body[data-note-card-theme="telegraph"] .note-copy a {
        color: inherit;
        text-decoration: none;
        border-bottom: 0.1em solid rgba(0, 0, 0, 0.7);
      }

      body[data-note-card-theme="telegraph"] .note-copy .markdown-blank-line {
        height: var(--telegraph-block-gap);
      }

      body[data-note-card-theme="telegraph"] .note-copy code,
      body[data-note-card-theme="telegraph"] .note-copy pre {
        border-radius: 0;
        font-family: Menlo, "Courier New", Courier, monospace;
        font-size: max(calc(0.5rem * var(--note-scale)), 14px);
      }

      body[data-note-card-theme="telegraph"] .note-copy code {
        padding: 0.0556em 0.1667em;
      }

      body[data-note-card-theme="telegraph"] .note-copy pre {
        margin: calc(7px * var(--note-scale)) 0;
        padding:
          calc(3.5px * var(--note-scale))
          calc(10.5px * var(--note-scale));
        line-height: 1.58;
      }

      body[data-note-card-theme="telegraph"] .note-copy pre code {
        padding: 0;
      }

      body[data-note-card-theme="telegraph"] .note-copy blockquote {
        margin:
          calc(9px * var(--note-scale))
          calc(10.5px * var(--note-scale))
          calc(8px * var(--note-scale))
          calc(3px * var(--note-scale));
        padding-left: calc(7.5px * var(--note-scale));
        border-left: calc(1.5px * var(--note-scale)) solid #000000;
        color: var(--note-copy);
        font-family: var(--note-font);
        font-size: inherit;
        font-style: italic;
        line-height: inherit;
      }

      body[data-note-card-theme="telegraph"] .note-copy blockquote::before {
        content: none;
      }

      body[data-note-card-theme="telegraph"] .note-copy ul,
      body[data-note-card-theme="telegraph"] .note-copy ol {
        margin: calc(10.5px * var(--note-scale)) 0;
        padding-left: calc(15px * var(--note-scale));
      }

      body[data-note-card-theme="telegraph"] .note-copy li + li {
        margin-top: calc(7px * var(--note-scale));
      }

      body[data-note-card-theme="telegraph"] .note-copy table {
        margin: calc(10.5px * var(--note-scale)) 0;
        font-size: inherit;
        line-height: inherit;
      }

      body[data-note-card-theme="telegraph"] .note-copy img.note-image-frame {
        margin: 0 auto calc(8px * var(--note-scale));
        padding: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }

      body[data-note-card-theme="telegraph"] .note-copy hr {
        width: 50%;
        margin: calc(15px * var(--note-scale)) auto;
      }

      body[data-note-card-theme="telegraph"] .sheet-footer {
        margin-top: calc(15px * var(--note-scale));
        padding-bottom: 0;
        font-family: var(--note-heading-font);
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
  <body data-note-card-theme="${theme}">
    <main class="preview-stage">${noteSheetHtml}</main>
  </body>
</html>
`;
}

async function buildArchive(
  markdown: string,
  footer: FooterConfig = {},
  theme: NoteCardThemeId = "default",
): Promise<{ filename: string; zipBuffer: Buffer }> {
  const basename = buildArchiveBasename(markdown);
  const folderName = basename;
  const assetFolderName = "INDEX.assets";
  const htmlAssetFolderName = "html.assets";
  const images: ArchiveImage[] = [];
  const replacements = new Map<string, string>();
  const htmlAssetEntries: ZipEntry[] = [];
  let archivedFooter: FooterConfig = { ...footer };
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

  try {
    const logoSource = footer.logoUrl ?? DEFAULT_FOOTER_LOGO_URL;
    const logoImage = await resolveArchiveImage(logoSource);

    if (logoImage?.buffer.length) {
      const extension =
        detectImageFormat(
          logoImage.buffer,
          logoImage.mimeType,
          logoImage.filename || logoSource,
        ) || "bin";
      const logoFilename = `footer-logo.${extension}`;

      htmlAssetEntries.push({
        path: `${folderName}/${htmlAssetFolderName}/${logoFilename}`,
        data: logoImage.buffer,
      });
      archivedFooter = {
        ...footer,
        logoUrl: `./${htmlAssetFolderName}/${logoFilename}`,
      };
    }
  } catch (error) {
    console.warn("Archive footer Logo skipped", error);
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
      data: Buffer.from(
        buildArchiveIndexHtml(
          archivedMarkdown,
          archivedFooter,
          fontAssets.fonts,
          theme,
        ),
        "utf8",
      ),
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

function sanitizeWorkspaceArchiveSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 80);
  const candidate = normalized || fallback;

  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(candidate)
    ? `_${candidate}`
    : candidate;
}

function getUniqueWorkspaceArchiveSegment(
  usedSegments: Set<string>,
  requestedSegment: string,
): string {
  const normalizedKey = requestedSegment.toLocaleLowerCase("zh-CN");

  if (!usedSegments.has(normalizedKey)) {
    usedSegments.add(normalizedKey);
    return requestedSegment;
  }

  let attempt = 2;

  while (
    usedSegments.has(
      `${requestedSegment}-${attempt}`.toLocaleLowerCase("zh-CN"),
    )
  ) {
    attempt += 1;
  }

  const uniqueSegment = `${requestedSegment}-${attempt}`;
  usedSegments.add(uniqueSegment.toLocaleLowerCase("zh-CN"));
  return uniqueSegment;
}

function buildWorkspaceArchiveNames(): { filename: string; rootFolder: string } {
  const now = new Date();
  const formatted = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
    padDatePart(now.getHours()),
    padDatePart(now.getMinutes()),
    padDatePart(now.getSeconds()),
  ].join("-");

  return {
    filename: `smartisan-notes-${formatted}.zip`,
    rootFolder: `锤子便签-${formatted}`,
  };
}

function buildWorkspaceArchiveReadme(
  workspace: NoteWorkspace,
  exportedAt: Date,
): string {
  const deletedNoteCount = workspace.notes.filter(
    (note) => note.deletedAt !== null,
  ).length;

  return [
    "# 锤子便签整体导出",
    "",
    `- 导出时间：${exportedAt.toISOString()}`,
    `- 自定义文件夹：${workspace.folders.length}`,
    `- 便签总数：${workspace.notes.length}`,
    `- 回收站便签：${deletedNoteCount}`,
    "",
    "每张便签保存为一个 Markdown 文件。便签引用的图片位于同名 `.assets` 文件夹中，Markdown 内的图片地址已经改为相对路径。未分类便签位于 `_未分类`，尚可恢复的已删除便签位于 `_回收站`。",
    "",
  ].join("\n");
}

function getWorkspaceArchiveDirectory(
  note: NoteDocument,
  folderDirectories: Map<string, string>,
): string {
  if (note.deletedAt !== null) {
    return "_回收站";
  }

  if (note.folderId) {
    return folderDirectories.get(note.folderId) ?? "_未分类";
  }

  return "_未分类";
}

async function buildWorkspaceArchive(
  workspace: NoteWorkspace,
  publicBaseUrl: string,
  onProgress: (progress: WorkspaceArchiveBuildProgress) => void,
): Promise<{ filename: string; zipBuffer: Buffer }> {
  const names = buildWorkspaceArchiveNames();
  const entries: ZipEntry[] = [];
  const folderDirectories = new Map<string, string>();
  const usedRootSegments = new Set<string>(["_未分类", "_回收站"]);
  const usedNoteSegments = new Map<string, Set<string>>();
  const orderedNotes = orderNoteDocuments(workspace.notes);
  const totalImages = orderedNotes.reduce(
    (total, note) => total + collectMarkdownImageSources(note.markdown).length,
    0,
  );
  const totalUnits = Math.max(orderedNotes.length + totalImages, 1);
  let completedUnits = 0;
  let uncompressedBytes = 0;

  const addEntry = (entry: ZipEntry) => {
    uncompressedBytes += entry.data.length;

    if (uncompressedBytes > maxWorkspaceArchiveUncompressedBytes) {
      throw new Error("整体导出内容过大，压缩前不能超过 512MB。");
    }

    if (entries.length >= 60_000) {
      throw new Error("整体导出的文件数量过多，无法生成兼容 ZIP。");
    }

    entries.push(entry);
  };

  const reportCollectingProgress = (
    completedNotes: number,
    message: string,
  ) => {
    onProgress({
      status: "collecting",
      progress: Math.min(90, 3 + Math.floor((completedUnits / totalUnits) * 87)),
      message,
      completedNotes,
    });
  };

  for (const folder of workspace.folders) {
    const segment = getUniqueWorkspaceArchiveSegment(
      usedRootSegments,
      sanitizeWorkspaceArchiveSegment(folder.name, "未命名文件夹"),
    );
    folderDirectories.set(folder.id, segment);
  }

  addEntry({
    path: `${names.rootFolder}/导出说明.md`,
    data: Buffer.from(buildWorkspaceArchiveReadme(workspace, new Date()), "utf8"),
  });

  for (const directory of [
    ...folderDirectories.values(),
    "_未分类",
    "_回收站",
  ]) {
    addEntry({
      path: `${names.rootFolder}/${directory}/`,
      data: Buffer.alloc(0),
      mode: 0o40755,
    });
  }

  reportCollectingProgress(0, `正在收集便签（0/${orderedNotes.length}）`);

  for (const [noteIndex, note] of orderedNotes.entries()) {
    const directory = getWorkspaceArchiveDirectory(note, folderDirectories);
    const directoryUsedSegments = usedNoteSegments.get(directory) ?? new Set<string>();
    usedNoteSegments.set(directory, directoryUsedSegments);
    const noteSegment = getUniqueWorkspaceArchiveSegment(
      directoryUsedSegments,
      sanitizeWorkspaceArchiveSegment(
        getNoteTitle(note.markdown),
        `便签-${noteIndex + 1}`,
      ),
    );
    const assetFolderName = `${noteSegment}.assets`;
    const images: ArchiveImage[] = [];
    const replacements = new Map<string, string>();
    const imageSources = collectMarkdownImageSources(note.markdown);

    for (const [imageIndex, source] of imageSources.entries()) {
      let image: ImageSource | null = null;

      try {
        image = await resolveArchiveImage(source, publicBaseUrl);
      } catch {
        throw new Error(
          `便签「${noteSegment}」中的图片无法读取，请确认原图仍可访问。`,
        );
      }

      if (!image?.buffer.length) {
        throw new Error(
          `便签「${noteSegment}」中的图片无法读取，请确认原图仍可访问。`,
        );
      }

      const extension = detectImageFormat(
        image.buffer,
        image.mimeType,
        image.filename,
      );
      const fallbackName = `image-${imageIndex + 1}`;
      const baseFilename = sanitizeArchiveFilename(
        image.filename || source,
        fallbackName,
      );
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
      completedUnits += 1;
      reportCollectingProgress(
        noteIndex,
        `正在收集图片（${completedUnits - noteIndex}/${totalImages}）`,
      );
    }

    let archivedMarkdown = note.markdown;

    const orderedReplacements = Array.from(replacements).sort(
      ([leftSource], [rightSource]) => rightSource.length - leftSource.length,
    );

    for (const [source, replacement] of orderedReplacements) {
      archivedMarkdown = replaceAll(archivedMarkdown, source, replacement);
    }

    addEntry({
      path: `${names.rootFolder}/${directory}/${noteSegment}.md`,
      data: Buffer.from(archivedMarkdown, "utf8"),
    });

    for (const image of images) {
      addEntry({
        path: `${names.rootFolder}/${directory}/${assetFolderName}/${image.filename}`,
        data: image.buffer,
      });
    }

    completedUnits += 1;
    reportCollectingProgress(
      noteIndex + 1,
      `正在收集便签（${noteIndex + 1}/${orderedNotes.length}）`,
    );
  }

  onProgress({
    status: "packaging",
    progress: 92,
    message: "正在生成 ZIP 压缩包",
    completedNotes: orderedNotes.length,
  });

  return {
    filename: names.filename,
    zipBuffer: createZip(entries),
  };
}

function getWorkspaceArchiveJobPayload(job: WorkspaceArchiveJob) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    completedNotes: job.completedNotes,
    totalNotes: job.totalNotes,
    ...(job.filename ? { filename: job.filename } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

function pruneWorkspaceArchiveJobs(requiredBufferBytes = 0): void {
  let retainedBytes = Array.from(workspaceArchiveJobs.values()).reduce(
    (total, job) => total + (job.zipBuffer?.length ?? 0),
    0,
  );
  const removableJobs = Array.from(workspaceArchiveJobs.values())
    .filter((job) => job.status === "ready" || job.status === "failed")
    .sort((left, right) => left.createdAt - right.createdAt);

  for (const job of removableJobs) {
    if (
      workspaceArchiveJobs.size < maxRetainedWorkspaceArchiveJobs &&
      retainedBytes + requiredBufferBytes <= maxRetainedWorkspaceArchiveBytes
    ) {
      break;
    }

    workspaceArchiveJobs.delete(job.id);
    retainedBytes -= job.zipBuffer?.length ?? 0;
  }
}

function scheduleWorkspaceArchiveJobExpiry(jobId: string): void {
  const timeout = setTimeout(() => {
    workspaceArchiveJobs.delete(jobId);
  }, workspaceArchiveJobLifetimeMs);
  timeout.unref();
}

function runWorkspaceArchiveJob(
  job: WorkspaceArchiveJob,
  workspace: NoteWorkspace,
  publicBaseUrl: string,
): void {
  setImmediate(() => {
    void (async () => {
      try {
        job.status = "collecting";
        job.message = `正在收集便签（0/${workspace.notes.length}）`;
        const archive = await buildWorkspaceArchive(
          workspace,
          publicBaseUrl,
          (progress) => {
            job.status = progress.status;
            job.progress = progress.progress;
            job.message = progress.message;
            job.completedNotes = progress.completedNotes;
          },
        );

        if (archive.zipBuffer.length > maxRetainedWorkspaceArchiveBytes) {
          throw new Error("整体导出压缩包过大，无法在服务器上暂存下载。");
        }

        pruneWorkspaceArchiveJobs(archive.zipBuffer.length);
        job.filename = archive.filename;
        job.zipBuffer = archive.zipBuffer;
        job.status = "ready";
        job.progress = 95;
        job.message = "压缩包已生成，正在准备下载";
        job.completedNotes = workspace.notes.length;
      } catch (error) {
        console.error("Workspace archive job failed:", error);
        job.status = "failed";
        job.error =
          error instanceof Error ? error.message : "整体导出失败，请稍后重试。";
        job.message = job.error;
      }
    })();
  });
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
    footer.brand ?? DEFAULT_FOOTER_BRAND,
    footer.via ?? DEFAULT_FOOTER_VIA,
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
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
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
    centralHeader.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
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

async function prepareWechatArticle(
  markdown: string,
  options: {
    footer: FooterConfig;
    publicBaseUrl: string;
    temporaryUploads: boolean;
    theme: NoteCardThemeId;
  },
): Promise<{
  anonymousQuota: AnonymousQuotaStatus | null;
  html: string;
  markdown: string;
  imageCount: number;
  uploadedImageCount: number;
  reusedImageCount: number;
  theme: NoteCardThemeId;
}> {
  const markdownImageSources = collectMarkdownImageSources(markdown);
  const customFooterLogoSource =
    options.footer.logoUrl &&
    options.footer.logoUrl !== DEFAULT_FOOTER_LOGO_URL
      ? options.footer.logoUrl
      : null;
  const imageSources = Array.from(
    new Set([
      ...markdownImageSources,
      ...(customFooterLogoSource ? [customFooterLogoSource] : []),
    ]),
  );
  const replacements = new Map<string, string>();
  let uploadedImageCount = 0;
  let reusedImageCount = 0;
  let wechatMarkdown = markdown;
  let anonymousQuota: AnonymousQuotaStatus | null = null;

  if (imageSources.length > 0) {
    const qiniuConfig = await loadQiniuConfig(rootDir);
    const imagesByContentHash = new Map<
      string,
      {
        buffer: Buffer;
        extension: string;
        sources: string[];
      }
    >();

    for (const source of imageSources) {
      if (isQiniuUrl(source, qiniuConfig)) {
        reusedImageCount += 1;
        continue;
      }

      const image = await resolveArchiveImage(source, options.publicBaseUrl);

      if (!image?.buffer.length) {
        throw new Error(`无法读取公众号图片：${source}`);
      }

      const extension = detectImageFormat(
        image.buffer,
        image.mimeType,
        image.filename || source,
      );

      if (!extension) {
        throw new Error(`公众号暂不支持该图片格式：${source}`);
      }

      const contentHash = createHash("sha256").update(image.buffer).digest("hex");
      const existingImage = imagesByContentHash.get(contentHash);

      if (existingImage) {
        existingImage.sources.push(source);
      } else {
        imagesByContentHash.set(contentHash, {
          buffer: image.buffer,
          extension,
          sources: [source],
        });
      }
    }

    const uniqueImages = Array.from(imagesByContentHash.values());
    const anonymousDateKey = getShanghaiDateKey();
    const temporaryPrefix = [
      qiniuConfig.prefix,
      "temporary",
      anonymousDateKey,
    ]
      .filter(Boolean)
      .join("/");

    if (options.temporaryUploads && uniqueImages.length > 0) {
      anonymousQuota = await notesDataStore.reserveAnonymousUploads(
        uniqueImages.length,
        anonymousDailyUploadLimit,
      );
    }

    for (const image of uniqueImages) {
      const uploaded = await uploadImageBufferToQiniu(
        image.buffer,
        image.extension,
        qiniuConfig,
        options.temporaryUploads
          ? {
              deleteAfterDays: 1,
              prefix: temporaryPrefix,
            }
          : undefined,
      );

      for (const source of image.sources) {
        replacements.set(source, uploaded.url);
      }

      if (uploaded.uploaded) {
        uploadedImageCount += 1;
      } else {
        reusedImageCount += 1;
      }

      reusedImageCount += Math.max(0, image.sources.length - 1);
    }

    for (const [source, replacement] of Array.from(replacements).sort(
      ([left], [right]) => right.length - left.length,
    )) {
      wechatMarkdown = replaceAll(wechatMarkdown, source, replacement);
    }
  }

  const footerHammerUrl = customFooterLogoSource
    ? replacements.get(customFooterLogoSource) || customFooterLogoSource
    : process.env.WECHAT_FOOTER_HAMMER_URL?.trim() ||
      defaultWechatFooterHammerUrl;
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: options.footer.brand ?? DEFAULT_FOOTER_BRAND,
      markdown: wechatMarkdown,
      footerHammerUrl,
      footerVia: options.footer.via ?? DEFAULT_FOOTER_VIA,
      theme: options.theme,
    }),
  ).replace(
    /<link\b[^>]*\brel="preload"[^>]*\bas="image"[^>]*\/?>/gi,
    "",
  );

  return {
    anonymousQuota,
    html,
    markdown: wechatMarkdown,
    imageCount: markdownImageSources.length,
    uploadedImageCount,
    reusedImageCount,
    theme: options.theme,
  };
}

interface WechatConnectionStatus {
  configured: boolean;
  connected: boolean;
  connectionError: string | null;
  checkedAt: number | null;
}

async function checkWechatConnection(
  configuration: WechatOfficialConfiguration | null,
  forceRefresh = false,
): Promise<WechatConnectionStatus> {
  if (!configuration) {
    return {
      configured: false,
      connected: false,
      connectionError: null,
      checkedAt: null,
    };
  }

  try {
    await getWechatAccessToken(configuration, forceRefresh);
    return {
      configured: true,
      connected: true,
      connectionError: null,
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      connectionError:
        error instanceof Error ? error.message : "微信公众号连接失败。",
      checkedAt: Date.now(),
    };
  }
}

function collectHtmlImageSources(html: string): string[] {
  const sources: string[] = [];
  const pattern = /<img\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>/gi;

  for (const match of html.matchAll(pattern)) {
    sources.push(match[2]);
  }

  return Array.from(new Set(sources));
}

function decodeHtmlImageSource(source: string): string {
  return source
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"');
}

async function resolveWechatDraftImage(
  source: string,
  publicBaseUrl: string,
): Promise<ImageSource | null> {
  if (source === defaultWechatFooterHammerUrl) {
    return readRootRelativeArchiveImage(DEFAULT_FOOTER_LOGO_URL);
  }

  return resolveArchiveImage(decodeHtmlImageSource(source), publicBaseUrl);
}

async function toWechatContentImage(
  image: ImageSource,
  source: string,
): Promise<WechatImageUpload> {
  const extension = detectImageFormat(
    image.buffer,
    image.mimeType,
    image.filename || source,
  );

  let outputBuffer = image.buffer;
  let outputExtension = extension;

  if (
    (extension !== "png" && extension !== "jpg") ||
    image.buffer.length >= 1024 * 1024
  ) {
    let metadata: Metadata;

    try {
      metadata = await sharp(image.buffer, { animated: false }).metadata();
    } catch {
      throw new WechatDraftPreparationError(
        `无法把图片转换为公众号支持的格式：${source}`,
      );
    }

    const usePng = metadata.hasAlpha === true;
    let width = Math.min(metadata.width || 1_920, 1_920);
    let quality = 88;
    let converted: Buffer | null = null;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      let pipeline = sharp(image.buffer, { animated: false })
        .rotate()
        .resize({
          width: Math.max(320, Math.round(width)),
          withoutEnlargement: true,
        });

      pipeline = usePng
        ? pipeline.png({
            compressionLevel: 9,
            palette: true,
            quality: Math.max(45, quality),
          })
        : pipeline.jpeg({
            chromaSubsampling: "4:2:0",
            mozjpeg: true,
            quality: Math.max(45, quality),
          });
      converted = await pipeline.toBuffer();

      if (converted.length < 1024 * 1024) {
        break;
      }

      width *= 0.78;
      quality -= 7;
    }

    if (!converted || converted.length >= 1024 * 1024) {
      throw new WechatDraftPreparationError(
        `图片压缩后仍超过公众号 1MB 限制：${source}`,
      );
    }

    outputBuffer = converted;
    outputExtension = usePng ? "png" : "jpg";
  }

  if (outputExtension !== "png" && outputExtension !== "jpg") {
    throw new WechatDraftPreparationError(
      `公众号正文图片仅支持 JPG/PNG：${source}`,
    );
  }

  return {
    buffer: outputBuffer,
    filename: `wechat-${createHash("sha256").update(outputBuffer).digest("hex")}.${outputExtension}`,
    mimeType: outputExtension === "png" ? "image/png" : "image/jpeg",
  };
}

function toWechatCoverImage(
  image: ImageSource,
  source: string,
): WechatImageUpload | null {
  const extension = detectImageFormat(
    image.buffer,
    image.mimeType,
    image.filename || source,
  );
  const supportedExtensions = new Set(["bmp", "png", "jpg", "gif"]);

  if (!extension || !supportedExtensions.has(extension)) {
    return null;
  }

  if (image.buffer.length > 10 * 1024 * 1024) {
    return null;
  }

  const mimeTypes: Record<string, string> = {
    bmp: "image/bmp",
    gif: "image/gif",
    jpg: "image/jpeg",
    png: "image/png",
  };

  return {
    buffer: image.buffer,
    filename: `wechat-cover-${createHash("sha256").update(image.buffer).digest("hex")}.${extension}`,
    mimeType: mimeTypes[extension],
  };
}

async function replaceDraftContentImages(
  html: string,
  accessToken: string,
  publicBaseUrl: string,
): Promise<{ html: string; imageCount: number }> {
  const sources = collectHtmlImageSources(html);
  const uploadedByHash = new Map<string, string>();
  let draftHtml = html;

  for (const source of sources) {
    const image = await resolveWechatDraftImage(source, publicBaseUrl);

    if (!image?.buffer.length) {
      throw new WechatDraftPreparationError(
        `无法读取公众号草稿图片：${source}`,
      );
    }

    const upload = await toWechatContentImage(image, source);
    const hash = createHash("sha256").update(upload.buffer).digest("hex");
    let wechatUrl = uploadedByHash.get(hash);

    if (!wechatUrl) {
      wechatUrl = await uploadWechatContentImage(accessToken, upload);
      uploadedByHash.set(hash, wechatUrl);
    }

    draftHtml = replaceAll(draftHtml, source, wechatUrl);
  }

  return { html: draftHtml, imageCount: uploadedByHash.size };
}

async function uploadDraftCover(
  markdown: string,
  accessToken: string,
  publicBaseUrl: string,
  theme: NoteCardThemeId,
): Promise<string> {
  const firstArticleImage = collectMarkdownImageSources(markdown)[0];
  let cover: WechatImageUpload | null = null;

  if (firstArticleImage) {
    try {
      const image = await resolveWechatDraftImage(
        firstArticleImage,
        publicBaseUrl,
      );
      cover = image ? toWechatCoverImage(image, firstArticleImage) : null;

      if (image && !cover) {
        cover = await toWechatContentImage(image, firstArticleImage);
      }
    } catch {
      // 正文准备阶段已经验证图片；首图不适合作封面时使用默认封面。
    }
  }

  if (!cover) {
    cover = await createWechatTitleCover(markdown, theme);
  }

  return uploadWechatPermanentImage(accessToken, cover);
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function createWechatTitleCover(
  markdown: string,
  theme: NoteCardThemeId,
): Promise<WechatImageUpload> {
  const themeStyle = getNoteCardThemeStyle(theme);
  const coverCharacters = Array.from(getNoteTitle(markdown)).slice(0, 20);
  const visibleCharacters = coverCharacters.length
    ? coverCharacters
    : Array.from("新便签");
  const lines = [
    visibleCharacters.slice(0, 10).join(""),
    visibleCharacters.slice(10, 20).join(""),
  ].filter(Boolean);
  const lineHeight = 88;
  const firstLineY = lines.length === 1 ? 214 : 174;
  const titleMarkup = lines
    .map(
      (line, index) =>
        `<text x="450" y="${firstLineY + index * lineHeight}" text-anchor="middle" fill="${escapeSvgText(themeStyle.colors.heading)}" font-family="Noto Sans CJK SC,Noto Sans SC,PingFang SC,sans-serif" font-size="64" font-weight="700">${escapeSvgText(line)}</text>`,
    )
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="383" viewBox="0 0 900 383">
      <rect width="900" height="383" fill="${escapeSvgText(themeStyle.colors.paper)}"/>
      <rect width="900" height="14" fill="${escapeSvgText(themeStyle.colors.accent)}"/>
      <rect x="34" y="34" width="832" height="315" rx="18" fill="none" stroke="${escapeSvgText(themeStyle.colors.border)}" stroke-width="2"/>
      ${titleMarkup}
      <text x="450" y="326" text-anchor="middle" fill="${escapeSvgText(themeStyle.colors.footer)}" font-family="Noto Sans CJK SC,Noto Sans SC,PingFang SC,sans-serif" font-size="26">开源版锤子便签</text>
    </svg>`,
  );
  let buffer: Buffer;

  try {
    buffer = await sharp(svg).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    buffer = await sharp({
      create: {
        width: 900,
        height: 383,
        channels: 3,
        background: themeStyle.colors.paper,
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  return {
    buffer,
    filename: `wechat-cover-title-${createHash("sha256").update(buffer).digest("hex")}.png`,
    mimeType: "image/png",
  };
}

function getWechatDraftTitle(markdown: string): string {
  return Array.from(getNoteTitle(markdown)).slice(0, 32).join("");
}

function assertWechatDraftContentLimits(html: string): void {
  if (Array.from(html).length >= 20_000) {
    throw new WechatDraftPreparationError(
      "当前文章转换后的公众号正文超过 2 万字符，请精简后再保存草稿。",
    );
  }

  if (Buffer.byteLength(html, "utf8") >= 1024 * 1024) {
    throw new WechatDraftPreparationError(
      "当前文章转换后的公众号正文超过 1MB，请精简后再保存草稿。",
    );
  }
}

const app = express();
app.set("trust proxy", 1);

app.use((request: Request, response: Response, next: NextFunction) => {
  applyCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(
  "/api/ai",
  async (request: Request, response: Response, next: NextFunction) => {
    if (request.method === "GET" && request.path === "/status") {
      next();
      return;
    }

    const user = await requireNoteServiceUser(request, response);

    if (!user) {
      return;
    }

    response.locals.aiUser = user;
    next();
  },
);
app.use("/api/ai", express.json({ limit: "128kb" }));
app.use(
  "/api/ai",
  (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    const parsedError = error as { status?: unknown; type?: unknown };

    if (parsedError?.type === "entity.too.large" || parsedError?.status === 413) {
      response.status(413).json({ error: "便签内容过长，无法提交 AI 审阅。" });
      return;
    }

    if (error) {
      response.status(400).json({ error: "AI 审阅请求格式不正确。" });
      return;
    }

    next();
  },
);
app.use(express.json({ limit: "10mb" }));
app.use("/images", express.static(imagesDir, { fallthrough: false, immutable: true, maxAge: "1y" }));

app.get("/api/auth/session", async (request: Request, response: Response) => {
  const user = await getAuthenticatedUser(request);
  response.json({ user: user ? getPublicAuthUser(user) : null });
});

app.post(
  "/api/auth/login",
  async (
    request: Request<Record<string, never>, unknown, LoginRequestBody>,
    response: Response,
  ) => {
    const credentials = resolveLoginCredentials(request.body);

    if (!credentials) {
      response.status(400).json({ error: "请输入用户名或邮箱及密码。" });
      return;
    }

    const superAdmin = authenticateSuperAdmin(credentials);
    const account = superAdmin
      ? null
      : await notesDataStore.authenticateUser(
          credentials.username,
          credentials.password,
        );

    if (!superAdmin && !account) {
      response.status(401).json({ error: "用户名、邮箱或密码错误。" });
      return;
    }

    const user: AuthUser =
      superAdmin ??
      ({
        id: account!.id,
        role: "user",
        username: account!.username,
      } satisfies AuthUser);
    setAuthenticatedSession(
      request,
      response,
      user,
      credentials.remember,
      account?.passwordVersion,
    );
    response.json({ user });
  },
);

app.post(
  "/api/auth/skill-token",
  async (
    request: Request<Record<string, never>, unknown, LoginRequestBody>,
    response: Response,
  ) => {
    response.setHeader("Cache-Control", "no-store");

    if (!isSameOriginRequest(request)) {
      response.status(403).json({ error: "请从当前便签页面或可信客户端申请 Skill Token。" });
      return;
    }

    let user: AuthUser | null = await getAuthenticatedUser(request);

    if (!user) {
      const credentials = resolveLoginCredentials(request.body);

      if (!credentials) {
        response.status(400).json({ error: "请提供用户名或邮箱及密码。" });
        return;
      }

      const superAdmin = authenticateSuperAdmin(credentials);
      const account = superAdmin
        ? null
        : await notesDataStore.authenticateUser(
            credentials.username,
            credentials.password,
          );

      if (!superAdmin && !account) {
        response.status(401).json({ error: "用户名、邮箱或密码错误。" });
        return;
      }

      user =
        superAdmin ??
        ({
          id: account!.id,
          role: "user",
          username: account!.username,
        } satisfies AuthUser);
    }

    if (!user) {
      response.status(401).json({ error: "当前账号已不存在，请重新登录。" });
      return;
    }

    const token = await createSkillTokenForUser(user);

    if (!token) {
      response.status(401).json({ error: "当前账号已不存在，请重新登录。" });
      return;
    }

    response.json({ token });
  },
);

app.post(
  "/api/hermes-skill/download",
  async (request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("X-Content-Type-Options", "nosniff");

    if (!isSameOriginRequest(request)) {
      response.status(403).json({ error: "请从当前便签页面下载 Hermes Skill。" });
      return;
    }

    const user = await getAuthenticatedUser(request);

    if (!user) {
      response.status(401).json({ error: "请先登录账号。" });
      return;
    }

    const token = await createSkillTokenForUser(user);

    if (!token) {
      response.status(401).json({ error: "当前账号已不存在，请重新登录。" });
      return;
    }

    try {
      const zip = await buildHermesSkillPackage(request, token);
      applyHermesDownloadHeaders(response);
      response.send(zip);
    } catch (error) {
      console.error("Hermes Skill package failed", error);
      response.status(500).json({ error: "Hermes Skill 生成失败，请稍后重试。" });
    }
  },
);

async function respondWithHermesInstallLink(
  request: Request,
  response: Response,
  reset: boolean,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");

  if (!isSameOriginRequest(request)) {
    response.status(403).json({ error: "请从当前便签页面管理安装链接。" });
    return;
  }

  const user = await getAuthenticatedUser(request);

  if (!user) {
    response.status(401).json({ error: "请先登录账号。" });
    return;
  }

  let publicBaseUrl: string;

  try {
    publicBaseUrl = getNotesPublicBaseUrl(request);
  } catch (error) {
    console.error("Hermes Skill public URL failed", error);
    response.status(500).json({ error: "Hermes 安装链接生成失败，请检查公开服务地址。" });
    return;
  }

  const ticket = reset
    ? await notesDataStore.resetHermesInstallLink(user.id)
    : await notesDataStore.getOrCreateHermesInstallLink(user.id);
  const installPath =
    `/api/hermes-skill/install/${ticket}/notes-workspace-api.zip`;
  response.json({
    installUrl: new URL(installPath, `${publicBaseUrl}/`).toString(),
  });
}

app.post(
  "/api/hermes-skill/install-link",
  (request: Request, response: Response) =>
    respondWithHermesInstallLink(request, response, false),
);

app.post(
  "/api/hermes-skill/install-link/reset",
  (request: Request, response: Response) =>
    respondWithHermesInstallLink(request, response, true),
);

app.head(
  "/api/hermes-skill/install/:ticket/notes-workspace-api.zip",
  async (request: Request<{ ticket: string }>, response: Response) => {
    const token = await getSkillTokenForHermesInstallTicket(
      request.params.ticket,
    );

    if (!token) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.status(410).end();
      return;
    }

    applyHermesDownloadHeaders(response);
    response.status(200).end();
  },
);

app.get(
  "/api/hermes-skill/install/:ticket/notes-workspace-api.zip",
  async (request: Request<{ ticket: string }>, response: Response) => {
    const { ticket } = request.params;
    const token = await getSkillTokenForHermesInstallTicket(ticket);

    if (!token) {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.status(410).json({
        error: "安装链接无效或已被重置，请在设置中复制当前链接。",
      });
      return;
    }

    try {
      const zip = await buildHermesSkillPackage(request, token);
      applyHermesDownloadHeaders(response);
      response.send(zip);
    } catch (error) {
      console.error("Hermes Skill install link failed", error);
      response.status(500).json({ error: "Hermes Skill 生成失败，请稍后重试。" });
    }
  },
);

app.post(
  "/api/auth/password",
  async (
    request: Request<Record<string, never>, unknown, ChangePasswordRequestBody>,
    response: Response,
  ) => {
    const session = await requireAuthenticatedUser(request, response, "user");

    if (!session) {
      return;
    }

    const currentPassword = request.body?.currentPassword;
    const newPassword = request.body?.newPassword;

    if (
      typeof currentPassword !== "string" ||
      !currentPassword ||
      typeof newPassword !== "string"
    ) {
      response.status(400).json({ error: "请输入当前密码和新密码。" });
      return;
    }

    try {
      const passwordVersion = await notesDataStore.changePassword(
        session.id,
        currentPassword,
        newPassword,
      );
      const user = getPublicAuthUser(session);
      setAuthenticatedSession(
        request,
        response,
        user,
        session.remember,
        passwordVersion,
      );
      await notesDataStore.revokeHermesInstallLink(session.id);
      response.json({ ok: true });
    } catch (error) {
      const status =
        error instanceof InvalidCurrentPasswordError ||
        error instanceof InvalidNewPasswordError
          ? 400
          : error instanceof AccountNotFoundError
            ? 404
            : 500;
      response.status(status).json({
        error: error instanceof Error ? error.message : "修改密码失败。",
      });
    }
  },
);

app.post(
  "/api/superadmin/login",
  (
    request: Request<Record<string, never>, unknown, LoginRequestBody>,
    response: Response,
  ) => {
    const configured = getSuperAdminCredentials();

    if (!configured) {
      response.status(503).json({
        error:
          "管理员账号尚未配置，请在服务端设置 SUPERADMIN 和 SUPERADMINPASSWORD。",
      });
      return;
    }

    const credentials = resolveLoginCredentials(request.body);
    const user = authenticateSuperAdmin(credentials);

    if (!user) {
      response.status(credentials ? 401 : 400).json({
        error: credentials ? "管理员用户名或密码错误。" : "请输入用户名和密码。",
      });
      return;
    }

    setAuthenticatedSession(
      request,
      response,
      user,
      credentials?.remember === true,
    );
    response.json({ user });
  },
);

app.post("/api/auth/logout", (request: Request, response: Response) => {
  clearAuthenticatedSession(request, response);
  response.json({ ok: true });
});

app.get(
  "/api/wechat/config",
  async (request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");

    if (!isSameOriginRequest(request)) {
      response.status(403).json({ error: "请从当前便签页面读取公众号配置。" });
      return;
    }

    const user = await requireNoteServiceUser(request, response);

    if (!user) {
      return;
    }

    const configuration = await notesDataStore.getWechatConfiguration(user.id);
    response.json(
      configuration ?? {
        appId: "",
        appSecret: "",
        updatedAt: null,
      },
    );
  },
);

app.get(
  "/api/wechat/status",
  async (request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");

    if (!isSameOriginRequest(request)) {
      response.status(403).json({ error: "请从当前便签页面检查公众号连接。" });
      return;
    }

    const user = await requireNoteServiceUser(request, response);

    if (!user) {
      return;
    }

    const configuration = await notesDataStore.getWechatConfiguration(user.id);
    response.json(await checkWechatConnection(configuration));
  },
);

app.put(
  "/api/wechat/config",
  async (
    request: Request<
      Record<string, never>,
      unknown,
      WechatConfigurationRequestBody
    >,
    response: Response,
  ) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");

    if (!isSameOriginRequest(request)) {
      response.status(403).json({ error: "请从当前便签页面保存公众号配置。" });
      return;
    }

    const user = await requireNoteServiceUser(request, response);

    if (!user) {
      return;
    }

    const appId = request.body?.appId;
    const appSecret = request.body?.appSecret;

    if (typeof appId !== "string" || typeof appSecret !== "string") {
      response.status(400).json({ error: "请输入公众号 AppID 和 AppSecret。" });
      return;
    }

    try {
      const configuration = await notesDataStore.saveWechatConfiguration(
        user.id,
        appId,
        appSecret,
      );
      clearWechatAccessToken(configuration);
      response.json({
        ...configuration,
        ...(await checkWechatConnection(configuration, true)),
      });
    } catch (error) {
      response
        .status(error instanceof InvalidWechatConfigurationError ? 400 : 500)
        .json({
          error:
            error instanceof Error ? error.message : "保存公众号配置失败。",
        });
    }
  },
);

app.get(
  "/api/superadmin/users",
  async (request: Request, response: Response) => {
    if (!(await requireAuthenticatedUser(request, response, "superadmin"))) {
      return;
    }

    response.json({ users: await notesDataStore.listUsers() });
  },
);

app.post(
  "/api/superadmin/users",
  async (
    request: Request<Record<string, never>, unknown, CreateUserRequestBody>,
    response: Response,
  ) => {
    if (!(await requireAuthenticatedUser(request, response, "superadmin"))) {
      return;
    }

    const username = request.body?.username;

    if (typeof username !== "string") {
      response.status(400).json({ error: "请输入普通用户名或邮箱。" });
      return;
    }

    const configured = getSuperAdminCredentials();

    if (
      configured &&
      normalizeUsername(username) === normalizeUsername(configured.username)
    ) {
      response.status(409).json({ error: "普通账号不能与管理员账号相同。" });
      return;
    }

    try {
      response.status(201).json({
        user: await notesDataStore.createUser(username),
      });
    } catch (error) {
      const status =
        error instanceof DuplicateUsernameError
          ? 409
          : error instanceof InvalidUsernameError
            ? 400
            : 500;
      response.status(status).json({
        error: error instanceof Error ? error.message : "创建用户失败。",
      });
    }
  },
);

app.post(
  "/api/superadmin/users/:userId/reset-password",
  async (
    request: Request<{ userId: string }>,
    response: Response,
  ) => {
    if (!(await requireAuthenticatedUser(request, response, "superadmin"))) {
      return;
    }

    try {
      const user = await notesDataStore.resetUserPassword(request.params.userId);
      await notesDataStore.revokeHermesInstallLink(request.params.userId);
      response.json({
        user,
      });
    } catch (error) {
      response
        .status(error instanceof AccountNotFoundError ? 404 : 500)
        .json({
          error: error instanceof Error ? error.message : "重置密码失败。",
        });
    }
  },
);

app.get("/api/workspace", async (request: Request, response: Response) => {
  const user = await requireWorkspaceUser(request, response);

  if (!user) {
    return;
  }

  const stored = await notesDataStore.getWorkspace(user.id);
  response.json(
    stored ?? {
      updatedAt: null,
      workspace: null,
    },
  );
});

app.get("/api/ai/status", (_request: Request, response: Response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ available: isAiAvailable() });
});

app.post(
  "/api/ai/suggestions",
  async (
    request: Request<Record<string, never>, unknown, AiSuggestionsRequestBody>,
    response: Response,
  ) => {
    const user = response.locals.aiUser as AuthSession | undefined;

    if (!user) {
      response.status(401).json({ error: "请先登录账号。" });
      return;
    }

    if (!isSameOriginRequest(request)) {
      response.status(403).json({ error: "请从当前便签页面发起 AI 审阅。" });
      return;
    }

    if (!isAiAvailable()) {
      response.status(503).json({ error: "AI 服务当前不可用，请稍后重试。" });
      return;
    }

    const markdown = request.body?.markdown;
    const instruction =
      typeof request.body?.instruction === "string"
        ? request.body.instruction.trim()
        : "";

    if (
      typeof markdown !== "string" ||
      !markdown ||
      markdown.length > maxAiMarkdownLength
    ) {
      response.status(400).json({
        error: `便签正文须为 1-${maxAiMarkdownLength} 个字符。`,
      });
      return;
    }

    if (
      !instruction ||
      instruction.length > maxAiInstructionLength
    ) {
      response.status(400).json({
        error: `审阅要求须为 1-${maxAiInstructionLength} 个字符。`,
      });
      return;
    }

    if (activeAiUsers.has(user.id)) {
      response.status(429).json({ error: "已有 AI 审阅正在进行，请稍候。" });
      return;
    }

    const retryAfter = consumeAiRateLimit(user.id);

    if (retryAfter !== null) {
      response.setHeader("Retry-After", retryAfter.toString());
      response.status(429).json({ error: "AI 审阅请求过于频繁，请稍后再试。" });
      return;
    }

    activeAiUsers.add(user.id);

    try {
      response.setHeader("Cache-Control", "no-store");
      response.json(await createAiSuggestions(markdown, instruction));
    } catch (error) {
      const code = error instanceof Error ? error.message : "AI_UPSTREAM_ERROR";
      const status =
        code === "AI_TIMEOUT"
          ? 504
          : code === "AI_UNAVAILABLE"
            ? 503
            : 502;
      response.status(status).json({
        error:
          status === 504
            ? "AI 审阅超时，请稍后重试。"
            : status === 503
              ? "AI 服务当前不可用，请稍后重试。"
              : "AI 暂时无法生成有效建议，请稍后重试。",
      });
    } finally {
      activeAiUsers.delete(user.id);
    }
  },
);

app.put(
  "/api/workspace",
  async (
    request: Request<Record<string, never>, unknown, WorkspaceRequestBody>,
    response: Response,
  ) => {
    const user = await requireWorkspaceUser(request, response);

    if (!user) {
      return;
    }

    const expectedUpdatedAt = request.body?.expectedUpdatedAt;

    if (
      expectedUpdatedAt !== undefined &&
      expectedUpdatedAt !== null &&
      (typeof expectedUpdatedAt !== "number" ||
        !Number.isFinite(expectedUpdatedAt))
    ) {
      response.status(400).json({
        error: "expectedUpdatedAt 必须是服务端返回的时间戳或 null。",
      });
      return;
    }

    try {
      response.json(
        await notesDataStore.saveWorkspace(
          user.id,
          request.body?.workspace,
          Date.now(),
          expectedUpdatedAt,
        ),
      );
    } catch (error) {
      response.status(error instanceof WorkspaceConflictError ? 409 : 400).json({
        error: error instanceof Error ? error.message : "云端工作区保存失败。",
        ...(error instanceof WorkspaceConflictError
          ? { updatedAt: error.updatedAt }
          : {}),
      });
    }
  },
);

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
      response.setHeader("X-Export-Theme", theme);
      response.send(pngBuffer);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to export note image";
      const isBrowserInstallError =
        message.includes("Executable doesn't exist") ||
        message.includes("Please run the following command");

      console.error("Export request failed:", error);

      response.status(error instanceof UnsupportedExportThemeError ? 400 : 500).json({
        error: message,
        hint: isBrowserInstallError
          ? "Run `npx playwright install chromium` on this machine."
          : undefined,
      });
    }
  },
);

app.post(
  "/api/workspace/archive",
  async (
    request: Request<Record<string, never>, unknown, WorkspaceArchiveRequestBody>,
    response: Response,
  ) => {
    pruneWorkspaceArchiveJobs();
    const activeJobCount = Array.from(workspaceArchiveJobs.values()).filter(
      (job) =>
        job.status === "preparing" ||
        job.status === "collecting" ||
        job.status === "packaging",
    ).length;

    if (activeJobCount >= maxConcurrentWorkspaceArchiveJobs) {
      response.status(429).json({
        error: "当前已有整体导出任务正在运行，请稍后再试。",
      });
      return;
    }

    const serializedWorkspace = JSON.stringify(request.body?.workspace);
    const workspace = parseNoteWorkspace(
      typeof serializedWorkspace === "string" ? serializedWorkspace : null,
    );

    if (!workspace) {
      response.status(400).json({ error: "工作区数据格式不正确，无法整体导出。" });
      return;
    }

    if (workspace.notes.length > maxWorkspaceArchiveNotes) {
      response.status(400).json({
        error: `单次最多导出 ${maxWorkspaceArchiveNotes} 张便签。`,
      });
      return;
    }

    if (workspaceArchiveJobs.size >= maxRetainedWorkspaceArchiveJobs) {
      response.status(429).json({
        error: "整体导出任务暂存数量已满，请稍后再试。",
      });
      return;
    }

    const job: WorkspaceArchiveJob = {
      id: randomUUID(),
      status: "preparing",
      progress: 1,
      message: "正在准备整体导出",
      completedNotes: 0,
      totalNotes: workspace.notes.length,
      createdAt: Date.now(),
    };

    workspaceArchiveJobs.set(job.id, job);
    scheduleWorkspaceArchiveJobExpiry(job.id);
    runWorkspaceArchiveJob(job, workspace, getPublicBaseUrl(request));

    response.setHeader("Cache-Control", "no-store");
    response.status(202).json(getWorkspaceArchiveJobPayload(job));
  },
);

app.get(
  "/api/workspace/archive/:jobId",
  (request: Request<{ jobId: string }>, response: Response) => {
    const job = workspaceArchiveJobs.get(request.params.jobId);

    response.setHeader("Cache-Control", "no-store");

    if (!job) {
      response.status(404).json({ error: "整体导出任务不存在或已过期。" });
      return;
    }

    response.json(getWorkspaceArchiveJobPayload(job));
  },
);

app.get(
  "/api/workspace/archive/:jobId/download",
  (request: Request<{ jobId: string }>, response: Response) => {
    const job = workspaceArchiveJobs.get(request.params.jobId);

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");

    if (!job) {
      response.status(404).json({ error: "整体导出任务不存在或已过期。" });
      return;
    }

    if (job.status === "failed") {
      response.status(409).json({ error: job.error || "整体导出失败。" });
      return;
    }

    if (job.status !== "ready" || !job.zipBuffer || !job.filename) {
      response.status(409).json({ error: "整体导出仍在处理中。" });
      return;
    }

    response.setHeader("Content-Type", "application/zip");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${job.filename}"`,
    );
    response.once("finish", () => {
      workspaceArchiveJobs.delete(job.id);
    });
    response.send(job.zipBuffer);
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
      const theme = resolveTheme(body);
      const markdown = await resolveMarkdown(body);
      const archive = await buildArchive(
        markdown,
        resolveFooterConfig(body),
        theme,
      );

      response.setHeader("Content-Type", "application/zip");
      response.setHeader("Content-Disposition", `attachment; filename="${archive.filename}"`);
      response.setHeader("X-Archive-Theme", theme);
      response.send(archive.zipBuffer);
    } catch (error) {
      console.error("Archive request failed:", error);

      response.status(error instanceof UnsupportedExportThemeError ? 400 : 500).json({
        error: error instanceof Error ? error.message : "Failed to create archive",
      });
    }
  },
);

app.post(
  "/api/wechat",
  async (
    request: Request<Record<string, never>, unknown, WechatRequestBody>,
    response: Response,
  ) => {
    try {
      const body = request.body || {};
      const theme = resolveTheme(body);
      const markdown = await resolveMarkdown(body);
      const authenticatedUser = await getWorkspaceUser(request);
      response.json(
        await prepareWechatArticle(markdown, {
          footer: resolveFooterConfig(body),
          publicBaseUrl: getPublicBaseUrl(request),
          temporaryUploads: !authenticatedUser,
          theme,
        }),
      );
    } catch (error) {
      console.error("Wechat copy preparation failed:", error);

      const status =
        error instanceof UnsupportedExportThemeError
          ? 400
          : error instanceof AnonymousQuotaExceededError
          ? 429
          : error instanceof QiniuConfigurationError
          ? 503
          : error instanceof QiniuUploadError
            ? 502
            : 500;

      response.status(status).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to prepare WeChat article",
        hint:
          error instanceof AnonymousQuotaExceededError
            ? `今日额度已使用 ${error.quota.used}/${error.quota.limit} 张，下一次重置时间：${error.quota.resetsAt}`
            : error instanceof QiniuConfigurationError
            ? "本地可通过 QINIU_CONFIG_PATH 复用现有 qiniu.json；生产环境请使用环境变量或只读挂载配置。"
            : undefined,
      });
    }
  },
);

app.post(
  "/api/wechat/draft",
  async (
    request: Request<Record<string, never>, unknown, WechatDraftRequestBody>,
    response: Response,
  ) => {
    if (!isSameOriginRequest(request)) {
      response.status(403).json({ error: "请从当前便签页面发布公众号草稿。" });
      return;
    }

    const user = await requireNoteServiceUser(request, response);

    if (!user) {
      return;
    }

    try {
      const configuration = await notesDataStore.getWechatConfiguration(user.id);

      if (!configuration) {
        response.status(409).json({
          error: "请先在设置中配置并连通当前账号的公众号 AppID 和 AppSecret。",
        });
        return;
      }

      const body = request.body || {};
      const theme = resolveTheme(body);
      const markdown = await resolveMarkdown(body);
      const publicBaseUrl = getPublicBaseUrl(request);
      const accessToken = await getWechatAccessToken(configuration);
      const prepared = await prepareWechatArticle(markdown, {
        footer: resolveFooterConfig(body),
        publicBaseUrl,
        temporaryUploads: false,
        theme,
      });
      assertWechatDraftContentLimits(prepared.html);
      const content = await replaceDraftContentImages(
        prepared.html,
        accessToken,
        publicBaseUrl,
      );
      assertWechatDraftContentLimits(content.html);
      const thumbMediaId = await uploadDraftCover(
        prepared.markdown,
        accessToken,
        publicBaseUrl,
        prepared.theme,
      );
      const title = getWechatDraftTitle(markdown);
      const mediaId = await addWechatDraft(accessToken, {
        content: content.html,
        thumbMediaId,
        title,
      });

      response.json({
        imageCount: content.imageCount,
        mediaId,
        theme: prepared.theme,
        title,
      });
    } catch (error) {
      console.error("Wechat draft publication failed:", error);

      const status =
        error instanceof UnsupportedExportThemeError ||
        error instanceof WechatDraftPreparationError
          ? 400
          : error instanceof QiniuConfigurationError
            ? 503
            : error instanceof QiniuUploadError ||
                error instanceof WechatOfficialApiError
              ? 502
              : 500;

      response.status(status).json({
        error:
          error instanceof Error ? error.message : "发布公众号草稿失败。",
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

await checkAiAvailability();

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
