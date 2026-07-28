import type { NoteSection } from "../types/app.js";

interface RawSection {
  heading: string;
  headingAlignment?: "start" | "center";
  lines: string[];
}

export const MARKDOWN_BLANK_LINE = "\u00A0";

export function detachUnindentedImagesFromLists(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let inCodeFence = false;
  const listItemPattern = /^\s*(?:[-+*]|\d+[.)])\s+\S/;
  const unindentedImagePattern =
    /^!\[[^\]\n]*\]\((?:[^()\n]|\([^)\n]*\))+\)\s*$/;

  lines.forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      output.push(line);
      return;
    }

    if (!inCodeFence && unindentedImagePattern.test(line)) {
      const previousLine = output[output.length - 1] ?? "";
      const nextLine = lines[index + 1] ?? "";

      if (listItemPattern.test(previousLine)) {
        output.push("");
      }

      output.push(line);

      if (listItemPattern.test(nextLine)) {
        output.push("");
      }

      return;
    }

    output.push(line);
  });

  return output.join("\n");
}

export function preserveMarkdownBlankLines(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const preservedLines: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      preservedLines.push(line);
      continue;
    }

    if (!inCodeFence && line.trim() === "") {
      preservedLines.push("", MARKDOWN_BLANK_LINE, "");
      continue;
    }

    preservedLines.push(line);
  }

  return preservedLines.join("\n");
}

export function splitSections(markdown: string): NoteSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let startIndex = 0;
  const firstContentIndex = lines.findIndex((line) => line.trim());
  const centeredHeadingMatch =
    firstContentIndex >= 0
      ? lines[firstContentIndex].trim().match(/^\[(.+)\]$/)
      : null;

  if (centeredHeadingMatch?.[1].trim()) {
    current = {
      heading: centeredHeadingMatch[1].trim(),
      headingAlignment: "center",
      lines: [],
    };
    startIndex = firstContentIndex + 1;

    while (startIndex < lines.length && !lines[startIndex].trim()) {
      startIndex += 1;
    }
  }

  for (const line of lines.slice(startIndex)) {
    if (/^##\s+/.test(line)) {
      if (current) {
        sections.push(current);
      }

      current = {
        heading: line.replace(/^##\s+/, "").trim(),
        lines: [],
      };
      continue;
    }

    if (!current) {
      current = {
        heading: "",
        lines: [],
      };
    }

    current.lines.push(line);
  }

  if (current) {
    sections.push(current);
  }

  return sections
    .map((section) => ({
      heading: section.heading.trim(),
      ...(section.headingAlignment
        ? { headingAlignment: section.headingAlignment }
        : {}),
      content: section.lines.join("\n"),
    }))
    .filter((section) => section.heading || section.content.trim());
}
