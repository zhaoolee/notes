import { imageExtensions, isArticleComposer, notesImageUrl } from "./media.js";

const maxImageBytes = 20 * 1024 * 1024;

async function getImage(url) {
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
  });
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!response.ok || !response.body || !imageExtensions.has(type)) {
    throw new Error("Notes did not return an image file.");
  }

  // Chrome extension messages serialize as JSON. Keep the read bounded even if a response has no Content-Length.
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxImageBytes) {
        await reader.cancel();
        throw new Error("The image is larger than 20 MB.");
      }
      for (let offset = 0; offset < value.length; offset += 16_384) {
        parts.push(String.fromCharCode(...value.subarray(offset, offset + 16_384)));
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (size === 0) throw new Error("The image file is empty.");
  return { type, base64: btoa(parts.join("")) };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "notes-article-image" || sender.id !== chrome.runtime.id || !sender.url) {
    return false;
  }
  const page = new URL(sender.url);
  const url = notesImageUrl(message.url);
  if (page.origin !== "https://x.com" || !isArticleComposer(page.pathname) || !url) {
    reply({ error: "The image is outside the Notes image library." });
    return false;
  }

  getImage(url).then(reply, (error) => reply({ error: error.message }));
  return true;
});
