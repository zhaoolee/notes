import { createHash } from "node:crypto";

export interface WechatOfficialConfiguration {
  appId: string;
  appSecret: string;
}

export interface WechatImageUpload {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface WechatDraftArticle {
  content: string;
  thumbMediaId: string;
  title: string;
}

interface WechatAccessTokenResponse {
  access_token?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
  expires_in?: unknown;
}

interface WechatContentImageResponse {
  errcode?: unknown;
  errmsg?: unknown;
  url?: unknown;
}

interface WechatPermanentImageResponse {
  errcode?: unknown;
  errmsg?: unknown;
  media_id?: unknown;
}

interface WechatDraftResponse {
  errcode?: unknown;
  errmsg?: unknown;
  media_id?: unknown;
}

interface CachedAccessToken {
  expiresAt: number;
  token: string;
}

const accessTokenCache = new Map<string, CachedAccessToken>();
const requestTimeoutMs = 20_000;

function getWechatApiBaseUrl(): string {
  const configured = process.env.WECHAT_API_BASE_URL?.trim();

  return configured || "https://api.weixin.qq.com";
}

function createWechatApiUrl(pathname: string): URL {
  return new URL(pathname, `${getWechatApiBaseUrl().replace(/\/$/, "")}/`);
}

function getConfigurationKey(
  configuration: WechatOfficialConfiguration,
): string {
  return createHash("sha256")
    .update(configuration.appId)
    .update("\0")
    .update(configuration.appSecret)
    .digest("hex");
}

function getWechatErrorMessage(code: number | null, message: string): string {
  switch (code) {
    case 40013:
      return "微信公众号 AppID 无效。";
    case 40125:
      return "微信公众号 AppSecret 无效。";
    case 40164:
      return "当前服务器出口 IP 不在微信公众号白名单中。";
    case 40007:
      return "微信公众号拒绝了草稿封面素材。";
    case 45009:
      return "微信公众号接口调用额度已用完。";
    default:
      return message
        ? `微信公众号接口返回错误：${message}${code == null ? "" : `（${code}）`}`
        : `微信公众号接口调用失败${code == null ? "" : `（${code}）`}。`;
  }
}

export class WechatOfficialApiError extends Error {
  readonly code: number | null;

  constructor(code: number | null, message: string) {
    super(getWechatErrorMessage(code, message));
    this.name = "WechatOfficialApiError";
    this.code = code;
  }
}

async function readWechatJson<T>(
  response: Response,
  operation: string,
): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { errcode?: unknown; errmsg?: unknown })
    | null;

  if (!response.ok || !payload) {
    throw new WechatOfficialApiError(
      null,
      `${operation}失败（HTTP ${response.status}）`,
    );
  }

  const code =
    typeof payload.errcode === "number" ? payload.errcode : null;

  if (code !== null && code !== 0) {
    throw new WechatOfficialApiError(
      code,
      typeof payload.errmsg === "string" ? payload.errmsg : operation,
    );
  }

  return payload;
}

async function requestWechatJson<T>(
  url: URL,
  init: RequestInit,
  operation: string,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new WechatOfficialApiError(
      null,
      error instanceof Error ? `${operation}失败：${error.message}` : operation,
    );
  }

  return readWechatJson<T>(response, operation);
}

export function clearWechatAccessToken(
  configuration: WechatOfficialConfiguration,
): void {
  accessTokenCache.delete(getConfigurationKey(configuration));
}

export async function getWechatAccessToken(
  configuration: WechatOfficialConfiguration,
  forceRefresh = false,
): Promise<string> {
  const cacheKey = getConfigurationKey(configuration);
  const cached = accessTokenCache.get(cacheKey);

  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const url = createWechatApiUrl("/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", configuration.appId);
  url.searchParams.set("secret", configuration.appSecret);

  const payload = await requestWechatJson<WechatAccessTokenResponse>(
    url,
    { method: "GET" },
    "验证公众号配置",
  );

  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new WechatOfficialApiError(null, "微信没有返回接口调用凭据");
  }

  const expiresIn =
    typeof payload.expires_in === "number" && payload.expires_in > 0
      ? payload.expires_in
      : 7_200;
  accessTokenCache.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 300) * 1_000,
  });

  return payload.access_token;
}

function createImageFormData(image: WechatImageUpload): FormData {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
    image.filename,
  );
  return form;
}

export async function uploadWechatContentImage(
  accessToken: string,
  image: WechatImageUpload,
): Promise<string> {
  const url = createWechatApiUrl("/cgi-bin/media/uploadimg");
  url.searchParams.set("access_token", accessToken);
  const payload = await requestWechatJson<WechatContentImageResponse>(
    url,
    {
      method: "POST",
      body: createImageFormData(image),
    },
    "上传公众号正文图片",
  );

  if (typeof payload.url !== "string" || !payload.url) {
    throw new WechatOfficialApiError(null, "微信没有返回正文图片地址");
  }

  return payload.url;
}

export async function uploadWechatPermanentImage(
  accessToken: string,
  image: WechatImageUpload,
): Promise<string> {
  const url = createWechatApiUrl("/cgi-bin/material/add_material");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("type", "image");
  const payload = await requestWechatJson<WechatPermanentImageResponse>(
    url,
    {
      method: "POST",
      body: createImageFormData(image),
    },
    "上传公众号草稿封面",
  );

  if (typeof payload.media_id !== "string" || !payload.media_id) {
    throw new WechatOfficialApiError(null, "微信没有返回封面素材 ID");
  }

  return payload.media_id;
}

export async function addWechatDraft(
  accessToken: string,
  article: WechatDraftArticle,
): Promise<string> {
  const url = createWechatApiUrl("/cgi-bin/draft/add");
  url.searchParams.set("access_token", accessToken);
  const payload = await requestWechatJson<WechatDraftResponse>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articles: [
          {
            article_type: "news",
            title: article.title,
            content: article.content,
            thumb_media_id: article.thumbMediaId,
            need_open_comment: 0,
            only_fans_can_comment: 0,
          },
        ],
      }),
    },
    "保存公众号草稿",
  );

  if (typeof payload.media_id !== "string" || !payload.media_id) {
    throw new WechatOfficialApiError(null, "微信没有返回草稿素材 ID");
  }

  return payload.media_id;
}
