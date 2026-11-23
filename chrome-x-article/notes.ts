import { xArticleImageSupportEvent } from "../src/lib/x-article-extension.js";
import { notesImageUrl } from "./media.js";

declare const chrome: { runtime: { id?: string } };

document.addEventListener(xArticleImageSupportEvent, (event) => {
  if (!chrome.runtime?.id || !(event instanceof CustomEvent)) return;
  const urls: unknown = event.detail;
  if (Array.isArray(urls) && urls.length > 0 && urls.every(notesImageUrl)) {
    event.preventDefault();
  }
});
