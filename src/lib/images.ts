import type { ImageImportResult } from "../types/app.js";

interface ImportByUrlPayload {
  sourceUrl: string;
}

async function readImportError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => null)) as
    | {
        error?: string;
      }
    | null;

  if (data?.error) {
    return data.error;
  }

  return `图片导入失败（${response.status}）`;
}

async function parseImportResponse(response: Response): Promise<ImageImportResult> {
  if (!response.ok) {
    throw new Error(await readImportError(response));
  }

  return (await response.json()) as ImageImportResult;
}

export interface ImageImportOptions {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export async function importImageFile(
  file: File,
  options: ImageImportOptions = {},
): Promise<ImageImportResult> {
  const formData = new FormData();
  formData.append("image", file, file.name);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = (): void => request.abort();
    const finish = (): void => options.signal?.removeEventListener("abort", abort);
    if (options.signal?.aborted) {
      reject(new DOMException("已取消上传", "AbortError"));
      return;
    }
    request.open("POST", "/api/images/import");
    request.timeout = 120_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        // 100% means the server has also accepted and stored the image.
        options.onProgress?.(Math.min(99, Math.floor(event.loaded / event.total * 100)));
      }
    };
    request.onload = async () => {
      finish();
      try {
        const result = await parseImportResponse(new Response(request.responseText, { status: request.status }));
        options.onProgress?.(100);
        resolve(result);
      } catch (error) { reject(error); }
    };
    request.onerror = () => { finish(); reject(new Error("图片上传失败，请检查网络后重试。")); };
    request.ontimeout = () => { finish(); reject(new Error("图片上传超时，请重试。")); };
    request.onabort = () => { finish(); reject(new DOMException("已取消上传", "AbortError")); };
    options.signal?.addEventListener("abort", abort, { once: true });
    request.send(formData);
  });
}

export async function importImageUrl(
  sourceUrl: string,
  options: ImageImportOptions = {},
): Promise<ImageImportResult> {
  const payload: ImportByUrlPayload = {
    sourceUrl,
  };

  const response = await fetch("/api/images/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  return parseImportResponse(response);
}
