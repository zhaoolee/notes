export type MarkdownShortcut = "title" | "center" | "list" | "bold" | "quote";

export interface MarkdownEditResult {
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
}

interface LineRange {
  start: number;
  end: number;
  text: string;
}

function clampOffset(markdown: string, offset: number): number {
  return Math.min(markdown.length, Math.max(0, offset));
}

function normalizeSelection(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } {
  const start = clampOffset(markdown, Math.min(selectionStart, selectionEnd));
  const end = clampOffset(markdown, Math.max(selectionStart, selectionEnd));

  return { start, end };
}

function getLineRange(markdown: string, offset: number): LineRange {
  const safeOffset = clampOffset(markdown, offset);
  const previousBreak =
    safeOffset === 0 ? -1 : markdown.lastIndexOf("\n", safeOffset - 1);
  const nextBreak = markdown.indexOf("\n", safeOffset);
  const start = previousBreak < 0 ? 0 : previousBreak + 1;
  const end = nextBreak < 0 ? markdown.length : nextBreak;

  return {
    start,
    end,
    text: markdown.slice(start, end),
  };
}

function replaceLine(
  markdown: string,
  line: LineRange,
  replacement: string,
): string {
  return `${markdown.slice(0, line.start)}${replacement}${markdown.slice(line.end)}`;
}

function addLinePrefix(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: "- " | "> ",
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const line = getLineRange(markdown, selection.start);

  if (line.text.startsWith(prefix)) {
    return {
      markdown,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    };
  }

  return {
    markdown: replaceLine(markdown, line, `${prefix}${line.text}`),
    selectionStart: selection.start + prefix.length,
    selectionEnd: selection.end + prefix.length,
  };
}

function cycleTitle(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const line = getLineRange(markdown, selection.start);
  const currentPrefix = line.text.match(/^(#{1,3}) /)?.[0] ?? "";
  const currentLevel = currentPrefix ? currentPrefix.length - 1 : 0;
  const nextLevel = currentLevel >= 3 ? 1 : currentLevel + 1;
  const nextPrefix = `${"#".repeat(nextLevel)} `;
  const delta = nextPrefix.length - currentPrefix.length;
  const prefixEnd = line.start + currentPrefix.length;
  const mapOffset = (offset: number): number =>
    offset <= prefixEnd ? line.start + nextPrefix.length : offset + delta;

  return {
    markdown: replaceLine(
      markdown,
      line,
      `${nextPrefix}${line.text.slice(currentPrefix.length)}`,
    ),
    selectionStart: mapOffset(selection.start),
    selectionEnd: mapOffset(selection.end),
  };
}

function centerLine(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);
  const line = getLineRange(markdown, selection.start);

  if (line.text.startsWith("[") && line.text.endsWith("]")) {
    return {
      markdown,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    };
  }

  if (selection.start === selection.end) {
    const nextCursor =
      line.text.length === 0
        ? line.start + 1
        : selection.start === line.end
          ? selection.start + 2
          : selection.start + 1;

    return {
      markdown: replaceLine(markdown, line, `[${line.text}]`),
      selectionStart: nextCursor,
      selectionEnd: nextCursor,
    };
  }

  return {
    markdown: replaceLine(markdown, line, `[${line.text}]`),
    selectionStart: selection.start + 1,
    selectionEnd: selection.end + 1,
  };
}

function boldSelection(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);

  if (selection.start === selection.end) {
    return {
      markdown,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    };
  }

  const selectedText = markdown.slice(selection.start, selection.end);

  return {
    markdown:
      `${markdown.slice(0, selection.start)}**${selectedText}**` +
      markdown.slice(selection.end),
    selectionStart: selection.start + 2,
    selectionEnd: selection.end + 2,
  };
}

export function applyMarkdownShortcut(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
  shortcut: MarkdownShortcut,
): MarkdownEditResult {
  switch (shortcut) {
    case "title":
      return cycleTitle(markdown, selectionStart, selectionEnd);
    case "center":
      return centerLine(markdown, selectionStart, selectionEnd);
    case "list":
      return addLinePrefix(markdown, selectionStart, selectionEnd, "- ");
    case "bold":
      return boldSelection(markdown, selectionStart, selectionEnd);
    case "quote":
      return addLinePrefix(markdown, selectionStart, selectionEnd, "> ");
  }
}

export function continueMarkdownBlock(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult | null {
  const selection = normalizeSelection(markdown, selectionStart, selectionEnd);

  if (selection.start !== selection.end) {
    return null;
  }

  const line = getLineRange(markdown, selection.start);
  const prefix = line.text.startsWith("- ")
    ? "- "
    : line.text.startsWith("> ")
      ? "> "
      : null;

  if (!prefix) {
    return null;
  }

  if (line.text === prefix) {
    return {
      markdown: replaceLine(markdown, line, ""),
      selectionStart: line.start,
      selectionEnd: line.start,
    };
  }

  const inserted = `\n${prefix}`;
  const nextCursor = selection.start + inserted.length;

  return {
    markdown:
      `${markdown.slice(0, selection.start)}${inserted}` +
      markdown.slice(selection.end),
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}
