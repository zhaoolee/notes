import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import qiniu from "qiniu";

interface LegacyQiniuConfig {
  AK?: string;
  SK?: string;
  QINIU_BUCKET?: string;
  QINIU_DOMAIN?: string;
  QINIU_PREFIX?: string;
  QINIU_UPLOAD_TIMEOUT_MS?: number | string;
  QINIU_UPLOAD_URL?: string;
  QINIU_UPLOAD_URLS?: string;
}

export interface QiniuConfig {
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  prefix: string;
  uploadTimeoutMs: number;
  uploadUrls: string[];
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
  code?: string;

  constructor(
    message: string,
    options: { cause?: unknown; code?: string; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "QiniuUploadError";
    this.status = options.status;
    this.code = options.code;
  }
}

const DEFAULT_QINIU_UPLOAD_TIMEOUT_MS = 30_000;
const MIN_QINIU_UPLOAD_TIMEOUT_MS = 10_000;
const MAX_QINIU_UPLOAD_TIMEOUT_MS = 300_000;

export function parseQiniuUploadTimeoutMs(value?: string): number {
  const normalized = value?.trim();

  if (!normalized) {
    return DEFAULT_QINIU_UPLOAD_TIMEOUT_MS;
  }

  const parsed = Number(normalized);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_QINIU_UPLOAD_TIMEOUT_MS ||
    parsed > MAX_QINIU_UPLOAD_TIMEOUT_MS
  ) {
    throw new QiniuConfigurationError(
      `QINIU_UPLOAD_TIMEOUT_MS 必须是 ${MIN_QINIU_UPLOAD_TIMEOUT_MS} 到 ${MAX_QINIU_UPLOAD_TIMEOUT_MS} 之间的整数毫秒值。`,
    );
  }

  return parsed;
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function parseQiniuUploadUrls(value?: string): string[] {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries?.length) {
    return [];
  }

  const normalized = entries.map((entry) => {
    let parsed: URL;

    try {
      parsed = new URL(entry);
    } catch {
      throw new QiniuConfigurationError(
        `七牛上传地址格式不正确：${entry}`,
      );
    }

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new QiniuConfigurationError(
        `七牛上传地址必须是没有路径、查询参数或凭证的 HTTP(S) Origin：${entry}`,
      );
    }

    return parsed.origin;
  });
  const protocols = new Set(normalized.map((entry) => new URL(entry).protocol));

  if (protocols.size > 1) {
    throw new QiniuConfigurationError(
      "QINIU_UPLOAD_URLS 中的上传节点必须使用相同协议。",
    );
  }

  return Array.from(new Set(normalized));
}

function readConfiguredUploadUrls(data?: LegacyQiniuConfig): string[] {
  return parseQiniuUploadUrls(
    process.env.QINIU_UPLOAD_URLS?.trim() ||
      process.env.QINIU_UPLOAD_URL?.trim() ||
      data?.QINIU_UPLOAD_URLS?.trim() ||
      data?.QINIU_UPLOAD_URL?.trim(),
  );
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
    uploadTimeoutMs: parseQiniuUploadTimeoutMs(
      process.env.QINIU_UPLOAD_TIMEOUT_MS,
    ),
    uploadUrls: readConfiguredUploadUrls(),
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
    uploadTimeoutMs: parseQiniuUploadTimeoutMs(
      process.env.QINIU_UPLOAD_TIMEOUT_MS ||
        (data.QINIU_UPLOAD_TIMEOUT_MS == null
          ? undefined
          : String(data.QINIU_UPLOAD_TIMEOUT_MS)),
    ),
    uploadUrls: readConfiguredUploadUrls(data),
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

function inferQiniuRegionId(uploadUrl: string): string | null {
  const hostname = new URL(uploadUrl).hostname.toLowerCase();

  if (
    hostname === "upload.qiniup.com" ||
    hostname === "up.qiniup.com" ||
    hostname === "up.qbox.me"
  ) {
    return "z0";
  }

  return /^(?:upload|up)-([a-z0-9-]+)\.qiniup\.com$/.exec(hostname)?.[1] ??
    /^up-([a-z0-9-]+)\.qbox\.me$/.exec(hostname)?.[1] ??
    null;
}

function uniqueEndpoints(
  endpoints: qiniu.httpc.Endpoint[],
): qiniu.httpc.Endpoint[] {
  const seen = new Set<string>();

  return endpoints.filter((endpoint) => {
    if (seen.has(endpoint.host)) {
      return false;
    }

    seen.add(endpoint.host);
    return true;
  });
}

/**
 * 默认让官方 SDK 根据 AK + Bucket 查询区域和上传节点。旧的固定上传地址仅作为
 * 首选节点；若它属于七牛标准区域域名，会自动补齐该区域的其它官方上传节点。
 */
export function createQiniuSdkConfig(config: QiniuConfig): qiniu.conf.Config {
  if (config.uploadUrls.length === 0) {
    return new qiniu.conf.Config({ useHttpsDomain: true });
  }

  const protocol = new URL(config.uploadUrls[0]).protocol.slice(0, -1);
  const preferredScheme = protocol === "http" ? "http" : "https";
  const configuredEndpoints = config.uploadUrls.map(
    (uploadUrl) =>
      new qiniu.httpc.Endpoint(new URL(uploadUrl).host, {
        defaultScheme: preferredScheme,
      }),
  );
  const regionIds = config.uploadUrls.map(inferQiniuRegionId);
  const inferredRegionId =
    regionIds[0] && regionIds.every((regionId) => regionId === regionIds[0])
      ? regionIds[0]
      : null;
  const region = inferredRegionId
    ? qiniu.httpc.Region.fromRegionId(inferredRegionId, { preferredScheme })
    : new qiniu.httpc.Region({
        services: {
          [qiniu.httpc.SERVICE_NAME.UP]: configuredEndpoints,
        },
      });

  if (inferredRegionId) {
    region.services[qiniu.httpc.SERVICE_NAME.UP] = uniqueEndpoints([
      ...configuredEndpoints,
      ...region.services[qiniu.httpc.SERVICE_NAME.UP],
    ]);
  }

  return new qiniu.conf.Config({
    regionsProvider: region,
    useHttpsDomain: preferredScheme === "https",
  });
}

function findQiniuErrorCode(
  error: unknown,
  seen = new Set<unknown>(),
): string | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) {
    return undefined;
  }

  seen.add(error);
  const candidate = error as { cause?: unknown; code?: unknown };

  if (
    typeof candidate.code === "string" &&
    /^[A-Z][A-Z0-9_]+$/.test(candidate.code)
  ) {
    return candidate.code;
  }

  return findQiniuErrorCode(candidate.cause, seen);
}

function readSdkUploadFailure(
  result: qiniu.httpc.ResponseWrapper,
): { message: string; status: number } {
  const status = result.resp?.statusCode || 0;
  const data = result.data as { error?: unknown; error_code?: unknown } | undefined;
  const detail =
    (typeof data?.error === "string" && data.error) ||
    (typeof data?.error_code === "string" && data.error_code) ||
    result.resp?.statusMessage ||
    "未知错误";

  return { message: detail, status };
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
  const uploadToken = createQiniuUploadToken(
    config,
    key,
    Date.now(),
    options.deleteAfterDays,
  );
  const putExtra = new qiniu.form_up.PutExtra(
    filename,
    undefined,
    getMimeType(normalizedExtension),
    undefined,
    true,
  );
  const uploader = new qiniu.form_up.FormUploader(
    createQiniuSdkConfig(config),
  );
  let result: qiniu.httpc.ResponseWrapper;

  // SDK 的 RPC_TIMEOUT 同时覆盖区域查询、连接建立和上传响应等待。
  qiniu.conf.RPC_TIMEOUT = config.uploadTimeoutMs;

  try {
    result = await uploader.put(uploadToken, key, buffer, putExtra);
  } catch (error) {
    const code = findQiniuErrorCode(error);
    throw new QiniuUploadError(
      `七牛 SDK 上传失败：已尝试区域查询和上传链路中的所有可用节点${
        code ? `（${code}）` : ""
      }。`,
      { cause: error, code },
    );
  }

  if (result.ok()) {
    return { key, uploaded: true, url: publicUrl };
  }

  const failure = readSdkUploadFailure(result);

  // 内容哈希作为 key；同一张图已存在时直接复用公开地址。
  if (failure.status === 614) {
    return { key, uploaded: false, url: publicUrl };
  }

  throw new QiniuUploadError(
    `七牛图片上传失败（${failure.status}）：${failure.message}`,
    { status: failure.status },
  );
}
