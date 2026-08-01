export interface AiSuggestion {
  id: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
  reason: string;
}

export type TextDiffPartType = "unchanged" | "removed" | "added";

export interface TextDiffPart {
  type: TextDiffPartType;
  value: string;
}

export interface SuggestionTextDiff {
  changeCount: number;
  original: TextDiffPart[];
  replacement: TextDiffPart[];
}

const MAX_DIFF_MATRIX_CELLS = 1_000_000;

function appendDiffPart(
  parts: TextDiffPart[],
  type: TextDiffPartType,
  value: string,
): void {
  if (!value) {
    return;
  }

  const previousPart = parts.at(-1);

  if (previousPart?.type === type) {
    previousPart.value += value;
    return;
  }

  parts.push({ type, value });
}

export function buildSuggestionTextDiff(
  original: string,
  replacement: string,
): SuggestionTextDiff {
  const originalCharacters = Array.from(original);
  const replacementCharacters = Array.from(replacement);
  let prefixLength = 0;

  while (
    prefixLength < originalCharacters.length &&
    prefixLength < replacementCharacters.length &&
    originalCharacters[prefixLength] === replacementCharacters[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;

  while (
    suffixLength < originalCharacters.length - prefixLength &&
    suffixLength < replacementCharacters.length - prefixLength &&
    originalCharacters[originalCharacters.length - suffixLength - 1] ===
      replacementCharacters[replacementCharacters.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const originalParts: TextDiffPart[] = [];
  const replacementParts: TextDiffPart[] = [];
  const prefix = originalCharacters.slice(0, prefixLength).join("");
  const originalMiddle = originalCharacters.slice(
    prefixLength,
    originalCharacters.length - suffixLength,
  );
  const replacementMiddle = replacementCharacters.slice(
    prefixLength,
    replacementCharacters.length - suffixLength,
  );
  const suffix = originalCharacters
    .slice(originalCharacters.length - suffixLength)
    .join("");

  appendDiffPart(originalParts, "unchanged", prefix);
  appendDiffPart(replacementParts, "unchanged", prefix);

  let changeCount = 0;

  if (
    originalMiddle.length > 0 ||
    replacementMiddle.length > 0
  ) {
    const matrixCells = originalMiddle.length * replacementMiddle.length;

    if (
      originalMiddle.length === 0 ||
      replacementMiddle.length === 0 ||
      matrixCells > MAX_DIFF_MATRIX_CELLS
    ) {
      appendDiffPart(originalParts, "removed", originalMiddle.join(""));
      appendDiffPart(replacementParts, "added", replacementMiddle.join(""));
      changeCount = 1;
    } else {
      const columnCount = replacementMiddle.length + 1;
      const lcsLengths = new Uint16Array(
        (originalMiddle.length + 1) * columnCount,
      );

      for (let originalIndex = originalMiddle.length - 1; originalIndex >= 0; originalIndex -= 1) {
        for (
          let replacementIndex = replacementMiddle.length - 1;
          replacementIndex >= 0;
          replacementIndex -= 1
        ) {
          const matrixIndex = originalIndex * columnCount + replacementIndex;

          lcsLengths[matrixIndex] =
            originalMiddle[originalIndex] === replacementMiddle[replacementIndex]
              ? lcsLengths[matrixIndex + columnCount + 1] + 1
              : Math.max(
                  lcsLengths[matrixIndex + columnCount],
                  lcsLengths[matrixIndex + 1],
                );
        }
      }

      let originalIndex = 0;
      let replacementIndex = 0;
      let isInsideChange = false;

      while (
        originalIndex < originalMiddle.length ||
        replacementIndex < replacementMiddle.length
      ) {
        if (
          originalIndex < originalMiddle.length &&
          replacementIndex < replacementMiddle.length &&
          originalMiddle[originalIndex] === replacementMiddle[replacementIndex]
        ) {
          const value = originalMiddle[originalIndex];
          appendDiffPart(originalParts, "unchanged", value);
          appendDiffPart(replacementParts, "unchanged", value);
          originalIndex += 1;
          replacementIndex += 1;
          isInsideChange = false;
          continue;
        }

        if (!isInsideChange) {
          changeCount += 1;
          isInsideChange = true;
        }

        const shouldRemove =
          originalIndex < originalMiddle.length &&
          (replacementIndex >= replacementMiddle.length ||
            lcsLengths[(originalIndex + 1) * columnCount + replacementIndex] >=
              lcsLengths[
                originalIndex * columnCount + replacementIndex + 1
              ]);

        if (shouldRemove) {
          appendDiffPart(
            originalParts,
            "removed",
            originalMiddle[originalIndex],
          );
          originalIndex += 1;
        } else {
          appendDiffPart(
            replacementParts,
            "added",
            replacementMiddle[replacementIndex],
          );
          replacementIndex += 1;
        }
      }
    }
  }

  appendDiffPart(originalParts, "unchanged", suffix);
  appendDiffPart(replacementParts, "unchanged", suffix);

  return {
    changeCount,
    original: originalParts,
    replacement: replacementParts,
  };
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

export function getAcceptedSuggestionIdsAfterAcceptAll(
  suggestions: AiSuggestion[],
  acceptedIds: ReadonlySet<string>,
  ignoredIds: ReadonlySet<string>,
): Set<string> {
  const nextAcceptedIds = new Set(acceptedIds);

  for (const suggestion of suggestions) {
    if (!ignoredIds.has(suggestion.id)) {
      nextAcceptedIds.add(suggestion.id);
    }
  }

  return nextAcceptedIds;
}
