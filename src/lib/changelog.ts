import type { NoteSection } from "../types/app.js";
import { splitSections } from "./markdown.js";

const REFERENCE_LINK_PATTERN = /^\[([^\]]+)\]:\s*(\S+)\s*$/gm;
const REFERENCE_HEADING_PATTERN = /^\[([^\]]+)\](.*)$/;

function getReferenceLinks(markdown: string): Map<string, string> {
  const links = new Map<string, string>();

  for (const match of markdown.matchAll(REFERENCE_LINK_PATTERN)) {
    const [, label, href] = match;

    if (label && href) {
      links.set(label.toLocaleLowerCase(), href);
    }
  }

  return links;
}

export function getChangelogSections(markdown: string): NoteSection[] {
  const referenceLinks = getReferenceLinks(markdown);

  return splitSections(markdown).map((section) => {
    const headingMatch = section.heading.match(REFERENCE_HEADING_PATTERN);

    if (!headingMatch) {
      return section;
    }

    const [, label, suffix] = headingMatch;
    const href = referenceLinks.get(label.toLocaleLowerCase());

    if (!href) {
      return section;
    }

    return {
      ...section,
      heading: `[${label}](${href})${suffix}`,
    };
  });
}
