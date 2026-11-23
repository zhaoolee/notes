import { copyRichHtmlToClipboard } from "./clipboard.js";
import type { NoteCardThemeId } from "../types/app.js";

interface WechatPreparationResult {
  html: string;
  markdown: string;
  imageCount: number;
  uploadedImageCount: number;
  reusedImageCount: number;
  theme: NoteCardThemeId;
}

interface WechatErrorPayload {
  error?: string;
  hint?: string;
}

interface WechatFooterOptions {
  footerBrand: string;
  footerLogoUrl: string;
  footerVia: string;
}

export interface WechatDraftResult {
  imageCount: number;
  mediaId: string;
  theme: NoteCardThemeId;
  title: string;
}

async function readWechatError(
  response: Response,
  fallback = `公众号格式生成失败（${response.status}）`,
): Promise<string> {
  const data = (await response.json().catch(() => null)) as WechatErrorPayload | null;
  const details = [data?.error, data?.hint].filter(
    (value): value is string => Boolean(value),
  );

  return details.length
    ? details.join(" ")
    : fallback;
}

async function prepareWechatArticle(
  markdown: string,
  theme: NoteCardThemeId,
  footer?: WechatFooterOptions,
): Promise<WechatPreparationResult> {
  const response = await fetch("/api/wechat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ markdown, theme, ...footer }),
  });

  if (!response.ok) {
    throw new Error(await readWechatError(response));
  }

  const result = (await response.json()) as WechatPreparationResult;

  if (result.theme !== theme) {
    throw new Error(
      "公众号服务尚未更新到当前主题版本，请重启后端服务后再复制。",
    );
  }

  return result;
}

export function copyMarkdownForWechat(
  markdown: string,
  theme: NoteCardThemeId,
  footer?: WechatFooterOptions,
): Promise<WechatPreparationResult> {
  return copyRichHtmlToClipboard(prepareWechatArticle(markdown, theme, footer));
}

export async function publishMarkdownAsWechatDraft(
  markdown: string,
  theme: NoteCardThemeId,
  footer?: WechatFooterOptions,
): Promise<WechatDraftResult> {
  const response = await fetch("/api/wechat/draft", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ markdown, theme, ...footer }),
  });

  if (!response.ok) {
    throw new Error(
      await readWechatError(
        response,
        `发布公众号草稿失败（${response.status}）`,
      ),
    );
  }

  const result = (await response.json()) as WechatDraftResult;

  if (result.theme !== theme) {
    throw new Error(
      "公众号服务尚未更新到当前主题版本，请重启后端服务后再发布草稿。",
    );
  }

  return result;
}
