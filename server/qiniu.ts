import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

interface LegacyQiniuConfig {
  AK?: string;
  SK?: string;
  QINIU_BUCKET?: string;
  QINIU_DOMAIN?: string;
  QINIU_PREFIX?: string;
  QINIU_UPLOAD_URL?: string;
}

export interface QiniuConfig {
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  prefix: string;
  uploadUrl: string;
}

export interface QiniuUploadResult {
  key: string;
  uploaded: boolean;
  url: string;
}

export interface QiniuUploadOptions {
  deleteAfterDays?: number;
  prefix?: string;
}

export class QiniuConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QiniuConfigurationError";
  }
}

export class QiniuUploadError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "QiniuUploadError";
    this.status = status;
  }
}

const resolvedUploadUrls = new Map<string, string>();

function normalizeDomain(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function readEnvironmentConfig(): QiniuConfig | null {
  const accessKey = process.env.QINIU_ACCESS_KEY?.trim();
  const secretKey = process.env.QINIU_SECRET_KEY?.trim();
  const bucket = process.env.QINIU_BUCKET?.trim();
  const domain = process.env.QINIU_DOMAIN?.trim();
  const configuredValues = [accessKey, secretKey, bucket, domain].filter(Boolean);

  if (configuredValues.length === 0) {
    return null;
  }

  if (!accessKey || !secretKey || !bucket || !domain) {
    throw new QiniuConfigurationError(
      "七牛环境变量配置不完整，需要 QINIU_ACCESS_KEY、QINIU_SECRET_KEY、QINIU_BUCKET 和 QINIU_DOMAIN。",
    );
  }

  return {
    accessKey,
    secretKey,
    bucket,
    domain: normalizeDomain(domain),
    prefix: process.env.QINIU_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "",
    uploadUrl:
      process.env.QINIU_UPLOAD_URL?.trim() || "https://upload.qiniup.com",
  };
}

function parseLegacyConfig(data: LegacyQiniuConfig, configPath: string): QiniuConfig {
  const accessKey = data.AK?.trim();
  const secretKey = data.SK?.trim();
  const bucket = data.QINIU_BUCKET?.trim();
  const domain = data.QINIU_DOMAIN?.trim();

  if (!accessKey || !secretKey || !bucket || !domain) {
    throw new QiniuConfigurationError(
      `七牛配置不完整：${configPath} 需要 AK、SK、QINIU_BUCKET 和 QINIU_DOMAIN。`,
    );
  }

  return {
    accessKey,
    secretKey,
    bucket,
    domain: normalizeDomain(domain),
    prefix: data.QINIU_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "",
    uploadUrl:
      process.env.QINIU_UPLOAD_URL?.trim() ||
      data.QINIU_UPLOAD_URL?.trim() ||
      "https://upload.qiniup.com",
  };
}

async function readConfigFile(configPath: string): Promise<QiniuConfig | null> {
  try {
    const data = JSON.parse(await fs.readFile(configPath, "utf8")) as LegacyQiniuConfig;
    return parseLegacyConfig(data, configPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    if (error instanceof QiniuConfigurationError) {
      throw error;
    }

    throw new QiniuConfigurationError(`无法读取七牛配置：${configPath}`);
  }
}

export async function loadQiniuConfig(rootDir: string): Promise<QiniuConfig> {
  const environmentConfig = readEnvironmentConfig();

  if (environmentConfig) {
    return environmentConfig;
  }

  const candidates = Array.from(
    new Set(
      [
        process.env.QINIU_CONFIG_PATH,
        path.join(rootDir, "qiniu.json"),
        path.resolve(rootDir, "..", "upload-local-image-to-qiniu", "qiniu.json"),
      ].filter((value): value is string => Boolean(value)),
    ),
  );

  for (const candidate of candidates) {
    const config = await readConfigFile(candidate);

    if (config) {
      return config;
    }
  }

  throw new QiniuConfigurationError(
    "未找到七牛配置。请设置 QINIU_CONFIG_PATH，或配置 QINIU_ACCESS_KEY、QINIU_SECRET_KEY、QINIU_BUCKET、QINIU_DOMAIN。",
  );
}

function urlSafeBase64(input: string | Buffer): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createQiniuUploadToken(
  config: QiniuConfig,
  key: string,
  now = Date.now(),
  deleteAfterDays?: number,
): string {
  const policy: Record<string, number | string> = {
    scope: `${config.bucket}:${key}`,
    deadline: Math.floor(now / 1000) + 3600,
  };

  if (
    typeof deleteAfterDays === "number" &&
    Number.isInteger(deleteAfterDays) &&
    deleteAfterDays > 0
  ) {
    policy.deleteAfterDays = deleteAfterDays;
  }

  const encodedPolicy = urlSafeBase64(JSON.stringify(policy));
  const encodedSignature = urlSafeBase64(
    createHmac("sha1", config.secretKey).update(encodedPolicy).digest(),
  );

  return `${config.accessKey}:${encodedSignature}:${encodedPolicy}`;
}

function encodeObjectKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getMimeType(extension: string): string {
  switch (extension.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "image/png";
  }
}

async function readUploadFailure(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return data?.error || response.statusText || "未知错误";
}

function getSuggestedUploadUrl(message: string): string | null {
  const match = /please use ([a-z0-9.-]+\.qiniup\.com)/i.exec(message);

  if (!match) {
    return null;
  }

  return `https://${match[1].toLowerCase()}`;
}

export function isQiniuUrl(sourceUrl: string, config: QiniuConfig): boolean {
  return sourceUrl === config.domain || sourceUrl.startsWith(`${config.domain}/`);
}

function normalizeImageExtension(extension: string): string {
  const normalized =
    extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  return normalized === "jpeg" ? "jpg" : normalized;
}

export function createContentAddressedQiniuKey(
  buffer: Buffer,
  extension: string,
  prefix = "",
): string {
  const normalizedExtension = normalizeImageExtension(extension);
  const hash = createHash("sha256").update(buffer).digest("hex");
  const filename = `${hash}.${normalizedExtension}`;
  const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, "");

  return normalizedPrefix ? `${normalizedPrefix}/${filename}` : filename;
}

export async function uploadImageBufferToQiniu(
  buffer: Buffer,
  extension: string,
  config: QiniuConfig,
  options: QiniuUploadOptions = {},
): Promise<QiniuUploadResult> {
  const normalizedExtension = normalizeImageExtension(extension);
  const key = createContentAddressedQiniuKey(
    buffer,
    normalizedExtension,
    options.prefix ?? config.prefix,
  );
  const filename = key.slice(key.lastIndexOf("/") + 1);
  const publicUrl = `${config.domain}/${encodeObjectKey(key)}`;

  async function upload(uploadUrl: string): Promise<Response> {
    const form = new FormData();

    form.append(
      "token",
      createQiniuUploadToken(
        config,
        key,
        Date.now(),
        options.deleteAfterDays,
      ),
    );
    form.append("key", key);
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: getMimeType(normalizedExtension) }),
      filename,
    );

    return fetch(uploadUrl, {
      method: "POST",
      body: form,
    });
  }

  let uploadUrl = resolvedUploadUrls.get(config.bucket) || config.uploadUrl;
  let response = await upload(uploadUrl);
  let failureMessage = response.ok ? "" : await readUploadFailure(response);
  const suggestedUploadUrl =
    response.status === 400 ? getSuggestedUploadUrl(failureMessage) : null;

  if (suggestedUploadUrl && suggestedUploadUrl !== uploadUrl) {
    uploadUrl = suggestedUploadUrl;
    resolvedUploadUrls.set(config.bucket, uploadUrl);
    response = await upload(uploadUrl);
    failureMessage = response.ok ? "" : await readUploadFailure(response);
  }

  if (response.ok) {
    return { key, uploaded: true, url: publicUrl };
  }

  // 内容哈希作为 key；同一张图已存在时直接复用公开地址。
  if (response.status === 614) {
    return { key, uploaded: false, url: publicUrl };
  }

  throw new QiniuUploadError(
    `七牛图片上传失败（${response.status}）：${failureMessage}`,
    response.status,
  );
}
