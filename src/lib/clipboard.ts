function fallbackCopyText(text: string): void {
  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand?.("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Copy command failed");
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    window.isSecureContext &&
    navigator.clipboard?.writeText
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  fallbackCopyText(text);
}

function joinWithOrigin(origin: string, path: string): string {
  return `${origin}${path}`;
}

function replaceMarkdownImageUrls(markdown: string, origin: string): string {
  return markdown.replace(/(!\[[^\]]*]\()(["']?)(\/images\/[^)\s"']+)\2(\))/g, (_match, prefix, quote, path, suffix) =>
    `${prefix}${quote}${joinWithOrigin(origin, path)}${quote}${suffix}`,
  );
}

function replaceHtmlImageUrls(markdown: string, origin: string): string {
  return markdown.replace(/(<img\b[^>]*\bsrc=)(["'])(\/images\/[^"']+)(\2)/gi, (_match, prefix, quote, path, suffix) =>
    `${prefix}${quote}${joinWithOrigin(origin, path)}${suffix}`,
  );
}

export function normalizeClipboardMarkdown(markdown: string): string {
  if (typeof window === "undefined" || !window.location?.origin) {
    return markdown;
  }

  const origin = window.location.origin;
  return replaceHtmlImageUrls(replaceMarkdownImageUrls(markdown, origin), origin);
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

export async function copyRichHtmlToClipboard<T extends { html: string; markdown: string }>(
  preparation: Promise<T>,
): Promise<T> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      // Start the write during the click gesture while the article HTML is still preparing.
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
