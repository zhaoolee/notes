import type { NoteSection } from "../types/app";

interface RawSection {
  heading: string;
  lines: string[];
}

function normalizeSingleLineBlockquotes(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    normalized.push(line);

    if (!line.trimStart().startsWith(">")) {
      continue;
    }

    if (nextLine == null || nextLine.trim() === "") {
      continue;
    }

    if (nextLine.trimStart().startsWith(">")) {
      continue;
    }

    normalized.push("");
  }

  return normalized.join("\n");
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
      content: normalizeSingleLineBlockquotes(section.lines.join("\n")).trim(),
    }))
    .filter((section) => section.heading || section.content);
}
