export const xArticleImageSupportEvent = "notes-x-article:image-support-v1";

export function canPasteXArticleImages(urls: readonly string[]): boolean {
  // A compatible extension cancels this synchronous probe when it supports every URL.
  return !document.dispatchEvent(new CustomEvent(xArticleImageSupportEvent, {
    cancelable: true,
    detail: urls,
  }));
}
