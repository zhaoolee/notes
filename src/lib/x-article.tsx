import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkManualLineParagraphs } from "../components/MarkdownText.js";
import { detachUnindentedImagesFromLists } from "./markdown.js";

export interface XArticleImage {
  number: number;
  marker: string;
  url: string;
  alt: string;
}

export function formatXArticleImageMarker(number: number): string {
  return `【图片 ${number}】`;
}

function absoluteWebUrl(value: string | undefined, pageUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value, pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function buildXArticleClipboard(
  markdown: string,
  pageUrl: string,
  imageMarker: (number: number) => string = formatXArticleImageMarker,
) {
  const source = detachUnindentedImagesFromLists(markdown);
  const images: XArticleImage[] = [];
  const replacements: Array<{ start: number; end: number; marker: string }> = [];
  const components: Components = {
    p: ({ children }) => <p>{children}</p>,
    a: ({ children, href }) => {
      const url = absoluteWebUrl(href, pageUrl);
      return url ? <a href={url}>{children}</a> : <>{children}</>;
    },
    img: ({ alt, src, node }) => {
      const url = absoluteWebUrl(src, pageUrl);
      if (!url) {
        return <>{alt}</>;
      }

      const number = images.length + 1;
      const marker = imageMarker(number);
      images.push({ number, marker, url, alt: alt ?? "" });
      const start = node?.position?.start.offset;
      const end = node?.position?.end.offset;

      if (start !== undefined && end !== undefined) {
        replacements.push({ start, end, marker });
      }

      return <span data-notes-x-image-url={url}>{marker}</span>;
    },
  };

  const html = renderToStaticMarkup(
    <ReactMarkdown
      components={components}
      remarkPlugins={[remarkGfm, remarkManualLineParagraphs]}
      skipHtml
    >
      {source}
    </ReactMarkdown>,
  ).trim();

  if (replacements.length === 0) {
    return { html, markdown, images };
  }

  let offset = 0;
  const parts = replacements.map(({ start, end, marker }) => {
    const fragment = source.slice(offset, start) + marker;
    offset = end;
    return fragment;
  });
  parts.push(source.slice(offset));

  return { html, markdown: parts.join(""), images };
}
