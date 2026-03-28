import { EXPORT_RETRY_BASE_DELAY_MS, EXPORT_RETRY_LIMIT, EXPORT_REQUEST_TIMEOUT_MS } from "./export-config";
import type { ThemeId } from "../types/app";
import { ExportError } from "../types/app";

interface ExportErrorPayload {
  error?: string;
  hint?: string;
}

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

async function saveExport(blob: Blob, filename: string): Promise<void> {
  const isCoarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches;
  const objectUrl = URL.createObjectURL(blob);

  try {
    const file = new File([blob], filename, { type: "image/png" });

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
  theme: ThemeId,
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
  theme: ThemeId,
): Promise<void> {
  const filename = buildExportFilename();
  const blob = await tryServerExport(markdown, filename, theme);
  await saveExport(blob, filename);
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
