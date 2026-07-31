export interface EditorImagePreview {
  alt: string;
  markerEnd: number;
  markerStart: number;
  source: string;
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

export function collectEditorImagePreviews(
  markdown: string,
): EditorImagePreview[] {
  const previews: EditorImagePreview[] = [];
  const markdownImagePattern =
    /!\[([^\]]*)]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
  const htmlImagePattern = /<img\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/gi;

  for (const match of markdown.matchAll(markdownImagePattern)) {
    const markerStart = match.index;

    previews.push({
      alt: match[1].trim(),
      markerEnd: markerStart + match[0].length,
      markerStart,
      source: match[2],
    });
  }

  for (const match of markdown.matchAll(htmlImagePattern)) {
    const markerStart = match.index;
    const altMatch = /\balt=(["'])(.*?)\1/i.exec(match[0]);

    previews.push({
      alt: altMatch?.[2]?.trim() || "",
      markerEnd: markerStart + match[0].length,
      markerStart,
      source: match[2],
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
