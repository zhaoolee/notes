import { fromMarkdown } from "mdast-util-from-markdown";

interface MarkdownNode {
  type: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  identifier?: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MarkdownNode[];
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

export function removeDuplicateSiteTitle(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return markdown;
  const heading = /^#{1,6}\s+(.+?)\s*$/.exec(lines[first]);
  if (heading) {
    if (heading[1] !== title) return markdown;
    return lines.slice(first + 1).join("\n").replace(/^\n/, "");
  }
  if (lines[first].trim() !== title) return markdown;

  // CommonMark 解析时，GFM 表头及其分隔行也会占用多行，不能作为独立标题删除。
  const paragraph = fromMarkdown(markdown).children[0];
  const lineNumber = first + 1;
  if (paragraph?.type !== "paragraph" || paragraph.position?.start.line !== lineNumber || paragraph.position.end.line !== lineNumber) return markdown;
  const [text] = paragraph.children;
  const end = paragraph.position.end.offset;
  if (paragraph.children.length !== 1 || text?.type !== "text" || text.value !== title || end === undefined) return markdown;
  return markdown.slice(end).replace(/^\r?\n(?:[ \t]*(?:\r?\n|$))?/, "");
}

/** Hugo scans shortcodes before Markdown, including fenced code examples. */
export function escapeHugoShortcodes(markdown: string): string {
  const protectedTokens: string[] = [];
  const prefix = `NOTESHUGO${Math.random().toString(36).slice(2)}TOKEN`;
  const escaped = markdown.replace(/{{([<%])([\s\S]*?)([>%])}}/g, (token, opening: string, body: string, closing: string) => {
    if ((opening === "<" && closing !== ">") || (opening === "%" && closing !== "%")) return token.replaceAll("{", "&#123;");
    const value = /^\/\*[\s\S]*\*\/$/.test(body) ? token : body.includes("*/") ? token.replaceAll("{", "&#123;") : `{{${opening}/*${body}*/${closing}}}`;
    protectedTokens.push(value);
    return `${prefix}${protectedTokens.length - 1}END`;
  }).replace(/{{(?=[<%])/g, "&#123;&#123;");
  return escaped.replace(new RegExp(`${prefix}(\\d+)END`, "g"), (_, index: string) => protectedTokens[Number(index)]);
}

export async function localizeSiteMarkdown(
  markdown: string,
  saveImage: (url: string) => Promise<string>,
): Promise<string> {
  const tree = fromMarkdown(markdown) as MarkdownNode;
  const definitions = new Map<string, MarkdownNode>();
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const images: MarkdownNode[] = [];
  walk(tree, (node) => {
    if (node.type === "definition" && node.identifier && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
    if (node.type === "image" || node.type === "imageReference") images.push(node);
    if (node.type === "html" && node.position) {
      const start = node.position.start.offset;
      const end = node.position.end.offset;
      if (start !== undefined && end !== undefined) edits.push({ start, end, value: markdown.slice(start, end).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") });
    }
  });
  if (images.length > 300) throw new Error("单张便签最多支持 300 个图片引用。");
  for (const image of images) {
    const target = image.type === "image" ? image : definitions.get(image.identifier ?? "");
    if (!target?.url) throw new Error("便签包含无法解析的图片引用。");
    const destination = await saveImage(target.url);
    const start = image.position?.start.offset;
    const end = image.position?.end.offset;
    if (start === undefined || end === undefined) throw new Error("图片位置无法解析。");
    const alt = (image.alt ?? "").replace(/([\\\[\]])/g, "\\$1").replace(/\r?\n/g, " ");
    const title = target.title ? ` ${JSON.stringify(target.title)}` : "";
    edits.push({ start, end, value: `![${alt}](<${destination}>${title})` });
  }
  let result = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  // A Markdown thematic break or JSON body cannot be interpreted as front matter:
  // the caller always writes a complete serialized JSON header first.
  return escapeHugoShortcodes(result);
}
