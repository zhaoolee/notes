import type { NoteSection } from "../types/app.js";

interface RawSection {
  heading: string;
  lines: string[];
}

export const MARKDOWN_BLANK_LINE = "\u00A0";

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

  for (const line of lines) {
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
      content: section.lines.join("\n"),
    }))
    .filter((section) => section.heading || section.content.trim());
}
