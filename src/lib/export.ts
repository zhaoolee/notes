import { EXPORT_RETRY_BASE_DELAY_MS, EXPORT_RETRY_LIMIT, EXPORT_REQUEST_TIMEOUT_MS } from "./export-config.js";
import type {
  NoteCardThemeId,
  NoteWorkspace,
} from "../types/app.js";
import { ExportError } from "../types/app.js";

interface ExportErrorPayload {
  error?: string;
  hint?: string;
}

interface ExportFooterOptions {
  footerBrand: string;
  footerLogoUrl: string;
  footerVia: string;
}

interface WorkspaceArchiveJobPayload {
  id: string;
  status: "preparing" | "collecting" | "packaging" | "ready" | "failed";
  progress: number;
  message: string;
  completedNotes: number;
  totalNotes: number;
  error?: string;
  filename?: string;
}

export interface WorkspaceArchiveProgress {
  percent: number;
  message: string;
  completedNotes: number;
  totalNotes: number;
}

const contentDispositionFilenamePattern = /filename\*?=(?:UTF-8''|")?([^";]+)/i;
const workspaceArchivePollIntervalMs = 400;
const workspaceArchiveTimeoutMs = 30 * 60 * 1_000;

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function buildExportFilename(): string {
  const now = new Date();
  const formatted = [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
    padDatePart(now.getHours()),
    padDatePart(now.getMinutes()),
    padDatePart(now.getSeconds()),
  ].join("-");

  return `${formatted}-${Date.now()}.png`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function getFilenameFromContentDisposition(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const match = contentDispositionFilenamePattern.exec(value);

  if (!match) {
    return fallback;
  }

  return decodeURIComponent(match[1].replace(/^"|"$/g, ""));
}

async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const isCoarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches;
  const objectUrl = URL.createObjectURL(blob);

  try {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });

    if (
      isCoarsePointer &&
      typeof navigator !== "undefined" &&
      navigator.share &&
      navigator.canShare?.({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        console.warn("Share failed, falling back to download.", error);
      }
    }

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";

    if (isCoarsePointer) {
      link.target = "_blank";
      link.download = "";
    }

    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    globalThis.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
  }
}

async function readExportErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") || "";
  const prefix = `导出服务返回 ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;

  if (contentType.includes("application/json")) {
    const data = (await response.json().catch(() => null)) as ExportErrorPayload | null;
    const parts = [data?.error, data?.hint].filter(
      (part): part is string => Boolean(part),
    );
    return parts.length ? `${prefix}：${parts.join(" ")}` : prefix;
  }

  const text = await response.text().catch(() => "");
  const details = text.replace(/\s+/g, " ").trim().slice(0, 180);
  return details ? `${prefix}：${details}` : prefix;
}

function normalizeExportError(error: unknown, attempt: number): ExportError {
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ExportError(`导出请求超时（>${EXPORT_REQUEST_TIMEOUT_MS / 1000}s）`, {
      retriable: true,
      attempts: attempt,
    });
  }

  if (error instanceof TypeError) {
    return new ExportError(`导出请求未送达后端：${error.message}`, {
      retriable: true,
      attempts: attempt,
    });
  }

  if (error instanceof ExportError) {
    error.attempts = attempt;
    return error;
  }

  if (error instanceof Error) {
    return new ExportError(error.message, {
      attempts: attempt,
    });
  }

  return new ExportError("导出失败，原因未知", {
    attempts: attempt,
  });
}

function shouldRetryExport(error: unknown): error is ExportError {
  return error instanceof ExportError && error.retriable;
}

async function tryServerExport(
  markdown: string,
  filename: string,
  theme: NoteCardThemeId,
  footer: ExportFooterOptions,
): Promise<Blob> {
  const maxAttempts = EXPORT_RETRY_LIMIT + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => {
      controller.abort();
    }, EXPORT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename,
          footerBrand: footer.footerBrand,
          footerLogoUrl: footer.footerLogoUrl,
          footerVia: footer.footerVia,
          markdown,
          theme,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ExportError(await readExportErrorMessage(response), {
          status: response.status,
          retriable: response.status >= 500 || response.status === 429,
          attempts: attempt,
        });
      }

      const renderedTheme = response.headers.get("X-Export-Theme");

      if (renderedTheme !== theme) {
        throw new ExportError(
          "导出服务尚未更新到当前主题版本，请重启后端服务后再保存图片。",
          {
            status: 409,
            retriable: false,
            attempts: attempt,
          },
        );
      }

      return response.blob();
    } catch (error) {
      const normalizedError = normalizeExportError(error, attempt);

      if (attempt >= maxAttempts || !shouldRetryExport(normalizedError)) {
        throw normalizedError;
      }

      await wait(EXPORT_RETRY_BASE_DELAY_MS * attempt);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  throw new ExportError("导出失败，已超过最大重试次数", {
    attempts: maxAttempts,
  });
}

export async function exportMarkdownAsPng(
  markdown: string,
  theme: NoteCardThemeId,
  footer: ExportFooterOptions,
): Promise<void> {
  const filename = buildExportFilename();
  const blob = await tryServerExport(markdown, filename, theme, footer);
  await saveBlob(blob, filename);
}

export async function exportMarkdownArchive(
  markdown: string,
  theme: NoteCardThemeId,
  footer: ExportFooterOptions,
): Promise<void> {
  const response = await fetch("/api/archive", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      footerBrand: footer.footerBrand,
      footerLogoUrl: footer.footerLogoUrl,
      footerVia: footer.footerVia,
      markdown,
      theme,
    }),
  });

  if (!response.ok) {
    throw new ExportError(await readExportErrorMessage(response), {
      status: response.status,
      retriable: false,
    });
  }

  if (response.headers.get("X-Archive-Theme") !== theme) {
    throw new ExportError(
      "归档服务尚未更新到当前主题版本，请重启后端服务后再下载。",
      {
        status: 409,
        retriable: false,
      },
    );
  }

  const filename = getFilenameFromContentDisposition(
    response.headers.get("content-disposition"),
    "notes-archive.zip",
  );
  await saveBlob(await response.blob(), filename);
}

async function downloadWorkspaceArchive(
  job: WorkspaceArchiveJobPayload,
  onProgress: (progress: WorkspaceArchiveProgress) => void,
): Promise<void> {
  const response = await fetch(`/api/workspace/archive/${job.id}/download`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ExportError(await readExportErrorMessage(response), {
      status: response.status,
      retriable: false,
    });
  }

  const filename = getFilenameFromContentDisposition(
    response.headers.get("content-disposition"),
    job.filename || "smartisan-notes.zip",
  );
  const contentLength = Number(response.headers.get("content-length") || "0");

  if (!response.body) {
    onProgress({
      percent: 98,
      message: "正在下载压缩包",
      completedNotes: job.totalNotes,
      totalNotes: job.totalNotes,
    });
    await saveBlob(await response.blob(), filename);
  } else {
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
      receivedBytes += value.byteLength;
      const downloadPercent = contentLength > 0
        ? Math.min(99, 95 + Math.floor((receivedBytes / contentLength) * 4))
        : 97;
      onProgress({
        percent: downloadPercent,
        message: "正在下载压缩包",
        completedNotes: job.totalNotes,
        totalNotes: job.totalNotes,
      });
    }

    await saveBlob(
      new Blob(chunks, {
        type: response.headers.get("content-type") || "application/zip",
      }),
      filename,
    );
  }

  onProgress({
    percent: 100,
    message: "全部便签已导出",
    completedNotes: job.totalNotes,
    totalNotes: job.totalNotes,
  });
}

export async function exportNoteWorkspaceArchive(
  workspace: NoteWorkspace,
  onProgress: (progress: WorkspaceArchiveProgress) => void,
): Promise<void> {
  const createResponse = await fetch("/api/workspace/archive", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspace }),
  });

  if (!createResponse.ok) {
    throw new ExportError(await readExportErrorMessage(createResponse), {
      status: createResponse.status,
      retriable: false,
    });
  }

  let job = (await createResponse.json()) as WorkspaceArchiveJobPayload;
  const deadline = Date.now() + workspaceArchiveTimeoutMs;

  onProgress({
    percent: job.progress,
    message: job.message,
    completedNotes: job.completedNotes,
    totalNotes: job.totalNotes,
  });

  while (job.status !== "ready") {
    if (job.status === "failed") {
      throw new ExportError(job.error || job.message || "整体导出失败。", {
        retriable: false,
      });
    }

    if (Date.now() >= deadline) {
      throw new ExportError("整体导出等待超时，请稍后重试。", {
        retriable: false,
      });
    }

    await wait(workspaceArchivePollIntervalMs);
    const statusResponse = await fetch(`/api/workspace/archive/${job.id}`, {
      cache: "no-store",
    });

    if (!statusResponse.ok) {
      throw new ExportError(await readExportErrorMessage(statusResponse), {
        status: statusResponse.status,
        retriable: false,
      });
    }

    job = (await statusResponse.json()) as WorkspaceArchiveJobPayload;
    onProgress({
      percent: job.progress,
      message: job.message,
      completedNotes: job.completedNotes,
      totalNotes: job.totalNotes,
    });
  }

  await downloadWorkspaceArchive(job, onProgress);
}

export function getExportErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "导出依赖后端 Playwright 服务，当前 /api/export 不可用。";
  }

  const attempts =
    error instanceof ExportError ? error.attempts : 1;
  const retryCount = Math.max(attempts - 1, 0);
  const retryLabel = retryCount > 0 ? `已自动重试 ${retryCount} 次。` : "";
  return `${retryLabel}${error.message}`;
}
