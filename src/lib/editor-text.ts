export const EDITOR_EMPTY_LINE_MARKER = "\u200B";

function collectEmptyLineStarts(source: string): number[] {
  const starts: number[] = [];
  let lineStart = 0;

  for (let index = 0; index <= source.length; index += 1) {
    if (index !== source.length && source[index] !== "\n") {
      continue;
    }

    if (index === lineStart) {
      starts.push(lineStart);
    }

    lineStart = index + 1;
  }

  return starts;
}

/**
 * WebKit uses the full textarea line box for the caret on a truly empty line.
 * A zero-width text run keeps the native caret on the font's glyph metrics,
 * matching the shorter caret shown next to visible text.
 */
export function toEditorDisplayText(source: string): string {
  return source
    .split("\n")
    .map((line) => line || EDITOR_EMPTY_LINE_MARKER)
    .join("\n");
}

export function stripEditorDisplayMarkers(displayText: string): string {
  return displayText.replaceAll(EDITOR_EMPTY_LINE_MARKER, "");
}

export function editorOffsetToSourceOffset(
  displayText: string,
  displayOffset: number,
): number {
  const clampedOffset = Math.max(
    0,
    Math.min(displayText.length, displayOffset),
  );

  return stripEditorDisplayMarkers(displayText.slice(0, clampedOffset)).length;
}

export function sourceOffsetToEditorOffset(
  source: string,
  sourceOffset: number,
): number {
  const clampedOffset = Math.max(0, Math.min(source.length, sourceOffset));
  const precedingMarkers = collectEmptyLineStarts(source).filter(
    (lineStart) => lineStart < clampedOffset,
  ).length;

  return clampedOffset + precedingMarkers;
}
