export interface EditorImagePreview {
  alt: string;
  altEnd: number | null;
  altStart: number | null;
  format: "html" | "markdown";
  markerEnd: number;
  markerStart: number;
  source: string;
  sourceEnd: number;
  sourceStart: number;
}

export interface EditorTextBlock {
  end: number;
  kind: "text";
  start: number;
  text: string;
}

export interface EditorImageBlock extends EditorImagePreview {
  kind: "image";
}

export type EditorContentBlock = EditorTextBlock | EditorImageBlock;

function decodeMarkdownImageAlt(value: string): string {
  return value.replace(/\\([\\\]])/g, "$1");
}

function encodeMarkdownImageAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function encodeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function collectEditorImagePreviews(
  markdown: string,
): EditorImagePreview[] {
  const previews: EditorImagePreview[] = [];
  const markdownImagePattern =
    /!\[((?:\\.|[^\]\\])*)]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
  const htmlImagePattern = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;

  for (const match of markdown.matchAll(markdownImagePattern)) {
    const markerStart = match.index;
    const rawAlt = match[1];
    const altStart = markerStart + 2;
    const sourceOffset = match[0].indexOf(
      match[2],
      2 + rawAlt.length + 2,
    );

    previews.push({
      alt: decodeMarkdownImageAlt(rawAlt).trim(),
      altEnd: altStart + rawAlt.length,
      altStart,
      format: "markdown",
      markerEnd: markerStart + match[0].length,
      markerStart,
      source: match[2],
      sourceEnd: markerStart + sourceOffset + match[2].length,
      sourceStart: markerStart + sourceOffset,
    });
  }

  for (const match of markdown.matchAll(htmlImagePattern)) {
    const markerStart = match.index;
    const sourceMatch = /\bsrc=(["'])(.*?)\1/i.exec(match[0]);
    const altMatch = /\balt=(["'])(.*?)\1/i.exec(match[0]);
    const sourceOffset = sourceMatch
      ? sourceMatch.index + sourceMatch[0].indexOf(sourceMatch[2])
      : match[0].indexOf(match[2]);
    const altOffset = altMatch
      ? match[0].indexOf(altMatch[2], altMatch.index + 5)
      : -1;

    previews.push({
      alt: decodeHtmlAttribute(altMatch?.[2]?.trim() || ""),
      altEnd:
        altOffset >= 0 ? markerStart + altOffset + altMatch![2].length : null,
      altStart: altOffset >= 0 ? markerStart + altOffset : null,
      format: "html",
      markerEnd: markerStart + match[0].length,
      markerStart,
      source: sourceMatch?.[2] ?? match[2],
      sourceEnd:
        markerStart + sourceOffset + (sourceMatch?.[2] ?? match[2]).length,
      sourceStart: markerStart + sourceOffset,
    });
  }

  const sorted = previews.sort(
    (left, right) => left.markerStart - right.markerStart,
  );
  const nonOverlapping: EditorImagePreview[] = [];

  for (const preview of sorted) {
    const previous = nonOverlapping.at(-1);

    if (!previous || preview.markerStart >= previous.markerEnd) {
      nonOverlapping.push(preview);
    }
  }

  return nonOverlapping;
}

export function splitEditorContent(
  markdown: string,
): EditorContentBlock[] {
  const images = collectEditorImagePreviews(markdown);

  if (images.length === 0) {
    return [
      {
        end: markdown.length,
        kind: "text",
        start: 0,
        text: markdown,
      },
    ];
  }

  const blocks: EditorContentBlock[] = [];
  let cursor = 0;

  for (const image of images) {
    blocks.push({
      end: image.markerStart,
      kind: "text",
      start: cursor,
      text: markdown.slice(cursor, image.markerStart),
    });
    blocks.push({
      ...image,
      kind: "image",
    });
    cursor = image.markerEnd;
  }

  blocks.push({
    end: markdown.length,
    kind: "text",
    start: cursor,
    text: markdown.slice(cursor),
  });

  return blocks;
}

export function replaceEditorImageAlt(
  markdown: string,
  image: EditorImagePreview,
  nextAlt: string,
): string {
  if (
    image.markerStart < 0 ||
    image.markerEnd > markdown.length ||
    image.markerStart >= image.markerEnd
  ) {
    return markdown;
  }

  const normalizedAlt = nextAlt.replace(/[\r\n]+/g, " ");

  if (image.format === "markdown" && image.altStart !== null && image.altEnd !== null) {
    return `${markdown.slice(0, image.altStart)}${encodeMarkdownImageAlt(
      normalizedAlt,
    )}${markdown.slice(image.altEnd)}`;
  }

  if (image.altStart !== null && image.altEnd !== null) {
    return `${markdown.slice(0, image.altStart)}${encodeHtmlAttribute(
      normalizedAlt,
    )}${markdown.slice(image.altEnd)}`;
  }

  const marker = markdown.slice(image.markerStart, image.markerEnd);
  const insertionOffset = marker.search(/\s*\/?>$/);

  if (insertionOffset < 0) {
    return markdown;
  }

  const nextMarker = `${marker.slice(0, insertionOffset)} alt="${encodeHtmlAttribute(
    normalizedAlt,
  )}"${marker.slice(insertionOffset)}`;

  return `${markdown.slice(0, image.markerStart)}${nextMarker}${markdown.slice(
    image.markerEnd,
  )}`;
}

export function replaceEditorImageSource(
  markdown: string,
  image: EditorImagePreview,
  nextSource: string,
): string {
  if (
    image.sourceStart < image.markerStart ||
    image.sourceEnd > image.markerEnd ||
    image.sourceStart >= image.sourceEnd
  ) {
    return markdown;
  }

  return `${markdown.slice(0, image.sourceStart)}${nextSource}${markdown.slice(
    image.sourceEnd,
  )}`;
}

export function moveEditorImage(
  markdown: string,
  image: EditorImagePreview,
  requestedOffset: number,
): string {
  if (
    image.markerStart < 0 ||
    image.markerEnd > markdown.length ||
    image.markerStart >= image.markerEnd
  ) {
    return markdown;
  }

  const targetOffset = Math.max(0, Math.min(markdown.length, requestedOffset));

  if (targetOffset >= image.markerStart && targetOffset <= image.markerEnd) {
    return markdown;
  }

  const marker = markdown.slice(image.markerStart, image.markerEnd);
  let extractionStart = image.markerStart;
  let extractionEnd = image.markerEnd;

  if (markdown[extractionEnd] === "\n") {
    extractionEnd += 1;
  } else if (markdown[extractionStart - 1] === "\n") {
    extractionStart -= 1;
  }

  const withoutImage = `${markdown.slice(0, extractionStart)}${markdown.slice(
    extractionEnd,
  )}`;
  let insertionOffset = targetOffset;

  if (targetOffset > extractionEnd) {
    insertionOffset -= extractionEnd - extractionStart;
  } else if (targetOffset > extractionStart) {
    insertionOffset = extractionStart;
  }

  insertionOffset = Math.max(0, Math.min(withoutImage.length, insertionOffset));

  let before = withoutImage.slice(0, insertionOffset);
  let after = withoutImage.slice(insertionOffset);

  if (before && !before.endsWith("\n")) {
    before += "\n";
  }

  if (after && !after.startsWith("\n")) {
    after = `\n${after}`;
  }

  return `${before}${marker}${after}`;
}
