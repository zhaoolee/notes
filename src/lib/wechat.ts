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

function fallbackCopyRichHtml(html: string): void {
  if (typeof document === "undefined") {
    throw new Error("当前环境无法访问剪贴板");
  }

  const container = document.createElement("div");
  container.contentEditable = "true";
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "680px";
  container.style.opacity = "0";
  container.innerHTML = html;
  document.body.append(container);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(container);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const copied = document.execCommand?.("copy");
  selection?.removeAllRanges();
  container.remove();

  if (!copied) {
    throw new Error("浏览器拒绝写入富文本剪贴板");
  }
}

export async function copyMarkdownForWechat(
  markdown: string,
  theme: NoteCardThemeId,
  footer?: WechatFooterOptions,
): Promise<WechatPreparationResult> {
  const preparation = prepareWechatArticle(markdown, theme, footer);

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      const item = new ClipboardItem({
        "text/html": preparation.then(
          (result) => new Blob([result.html], { type: "text/html" }),
        ),
        "text/plain": preparation.then(
          (result) => new Blob([result.markdown], { type: "text/plain" }),
        ),
      });

      await navigator.clipboard.write([item]);
      return preparation;
    } catch (error) {
      const result = await preparation;

      try {
        fallbackCopyRichHtml(result.html);
        return result;
      } catch {
        throw error;
      }
    }
  }

  const result = await preparation;
  fallbackCopyRichHtml(result.html);
  return result;
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
