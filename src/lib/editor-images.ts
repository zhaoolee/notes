export interface EditorImagePreview {
  alt: string;
  markerEnd: number;
  markerStart: number;
  source: string;
}

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

  return previews.sort(
    (left, right) => left.markerStart - right.markerStart,
  );
}
