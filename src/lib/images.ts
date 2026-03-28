import type { ImageImportResult } from "../types/app";

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

export async function importImageFile(file: File): Promise<ImageImportResult> {
  const formData = new FormData();
  formData.append("image", file, file.name);

  const response = await fetch("/api/images/import", {
    method: "POST",
    body: formData,
  });

  return parseImportResponse(response);
}

export async function importImageUrl(sourceUrl: string): Promise<ImageImportResult> {
  const payload: ImportByUrlPayload = {
    sourceUrl,
  };

  const response = await fetch("/api/images/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  return parseImportResponse(response);
}
