import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownTextProps {
  children: string;
}

const markdownComponents: Components = {
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ""}
      loading="eager"
      decoding="sync"
    />
  ),
  code: ({ children, className }) => <code className={className}>{children}</code>,
  blockquote: ({ children }) => <blockquote>{children}</blockquote>,
};

export function MarkdownText({ children }: MarkdownTextProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  );
}
