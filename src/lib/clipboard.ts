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
