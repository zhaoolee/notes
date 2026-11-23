export const notesOrigin = "https://notes.fangyuanxiaozhan.com";

export const imageExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
]);

export function isArticleComposer(pathname) {
  return /^\/compose\/articles?(?:\/|$)/.test(pathname);
}

export function notesImageUrl(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.origin === notesOrigin &&
      !url.username && !url.password &&
      /^\/images\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)
    ) {
      return notesOrigin + url.pathname;
    }
  } catch {
    return null;
  }
  return null;
}
