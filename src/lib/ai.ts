import {
  normalizeMarkdownStrongWhitespace,
  validateAiSuggestions,
  type AiSuggestion,
} from "./ai-suggestions";

interface AiStatusResponse {
  available?: unknown;
}

interface AiSuggestionsResponse {
  sourceHash?: unknown;
  suggestions?: unknown;
}

export interface AiReviewResult {
  sourceHash: string;
  suggestions: AiSuggestion[];
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function getAiStatus(): Promise<boolean> {
  const response = await fetch("/api/ai/status", {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("AI 状态暂时不可用。");
  }

  const payload = (await response.json()) as AiStatusResponse;
  return payload.available === true;
}

export async function reviewMarkdownWithAi(
  markdown: string,
  instruction: string,
): Promise<AiReviewResult> {
  const response = await fetch("/api/ai/suggestions", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ markdown, instruction }),
  });
  const payload = (await readJsonResponse(response)) as AiSuggestionsResponse & {
    error?: unknown;
  };

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "AI 暂时无法生成建议，请稍后重试。",
    );
  }

  const suggestions = Array.isArray(payload.suggestions)
    ? payload.suggestions.map((suggestion) => {
        if (!suggestion || typeof suggestion !== "object") {
          return suggestion as AiSuggestion;
        }

        const candidate = suggestion as AiSuggestion;

        return typeof candidate.replacement === "string"
          ? {
              ...candidate,
              replacement: normalizeMarkdownStrongWhitespace(
                candidate.replacement,
              ),
            }
          : candidate;
      })
    : [];

  if (
    typeof payload.sourceHash !== "string" ||
    !validateAiSuggestions(markdown, suggestions)
  ) {
    throw new Error("AI 返回的建议无法安全定位，请重新审阅。");
  }

  return {
    sourceHash: payload.sourceHash,
    suggestions,
  };
}
