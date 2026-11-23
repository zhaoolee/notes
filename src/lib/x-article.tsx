import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkManualLineParagraphs } from "../components/MarkdownText.js";
import { detachUnindentedImagesFromLists } from "./markdown.js";

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

export function buildXArticleClipboard(markdown: string, pageUrl: string) {
  const components: Components = {
    p: ({ children }) => <p>{children}</p>,
    a: ({ children, href }) => {
      const url = absoluteWebUrl(href, pageUrl);
      return url ? <a href={url}>{children}</a> : <>{children}</>;
    },
    img: ({ alt, src }) => {
      const url = absoluteWebUrl(src, pageUrl);
      return url ? <img src={url} alt={alt ?? ""} loading="lazy" /> : <>{alt}</>;
    },
  };

  const html = renderToStaticMarkup(
    <ReactMarkdown
      components={components}
      remarkPlugins={[remarkGfm, remarkManualLineParagraphs]}
      skipHtml
    >
      {detachUnindentedImagesFromLists(markdown)}
    </ReactMarkdown>,
  ).trim();

  return { html, markdown };
}
