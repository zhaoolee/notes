export interface AiSuggestion {
  id: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
  reason: string;
}

export function validateAiSuggestions(
  sourceMarkdown: string,
  suggestions: AiSuggestion[],
): boolean {
  const ids = new Set<string>();
  let previousEnd = -1;

  for (const suggestion of [...suggestions].sort(
    (left, right) => left.start - right.start,
  )) {
    if (
      !suggestion.id ||
      ids.has(suggestion.id) ||
      !Number.isInteger(suggestion.start) ||
      !Number.isInteger(suggestion.end) ||
      suggestion.start < 0 ||
      suggestion.end <= suggestion.start ||
      suggestion.end > sourceMarkdown.length ||
      sourceMarkdown.slice(suggestion.start, suggestion.end) !==
        suggestion.original ||
      suggestion.original === suggestion.replacement ||
      !suggestion.reason.trim() ||
      suggestion.start < previousEnd
    ) {
      return false;
    }

    ids.add(suggestion.id);
    previousEnd = suggestion.end;
  }

  return true;
}

export function buildMarkdownFromAcceptedSuggestions(
  sourceMarkdown: string,
  suggestions: AiSuggestion[],
  acceptedIds: ReadonlySet<string>,
): string {
  if (!validateAiSuggestions(sourceMarkdown, suggestions)) {
    throw new Error("AI 建议已失效，请重新审阅。");
  }

  let result = sourceMarkdown;
  const accepted = suggestions
    .filter((suggestion) => acceptedIds.has(suggestion.id))
    .sort((left, right) => right.start - left.start);

  for (const suggestion of accepted) {
    result =
      result.slice(0, suggestion.start) +
      suggestion.replacement +
      result.slice(suggestion.end);
  }

  return result;
}
