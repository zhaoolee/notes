import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MARKDOWN_BLANK_LINE, preserveMarkdownBlankLines } from "../lib/markdown.js";

interface MarkdownTextProps {
  children: string;
}

const markdownComponents: Components = {
  p: ({ children, className }) => {
    const isBlankLine = Array.isArray(children)
      ? children.length === 1 && children[0] === MARKDOWN_BLANK_LINE
      : children === MARKDOWN_BLANK_LINE;

    const classes = [className, isBlankLine ? "markdown-blank-line" : undefined]
      .filter(Boolean)
      .join(" ");

    return <p className={classes || undefined}>{children}</p>;
  },
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

type MarkdownAstNode = {
  type?: string;
  value?: string;
  children?: MarkdownAstNode[];
  data?: {
    hProperties?: {
      className?: string | string[];
    };
  };
  [key: string]: unknown;
};

function toClassList(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : value.split(/\s+/).filter(Boolean);
}

function withClassName(node: MarkdownAstNode, className: string): MarkdownAstNode {
  const classNames = toClassList(node.data?.hProperties?.className);

  return {
    ...node,
    data: {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        className: Array.from(new Set([...classNames, className])),
      },
    },
  };
}

function splitParagraphByManualLines(node: MarkdownAstNode): MarkdownAstNode[] {
  if (node.type !== "paragraph" || !Array.isArray(node.children)) {
    return [node];
  }

  const lines: MarkdownAstNode[][] = [[]];
  let hasManualLine = false;

  node.children.forEach((child) => {
    if (child.type !== "text" || typeof child.value !== "string" || !child.value.includes("\n")) {
      lines[lines.length - 1].push(child);
      return;
    }

    hasManualLine = true;

    child.value.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }

      if (part) {
        lines[lines.length - 1].push({ ...child, value: part });
      }
    });
  });

  if (!hasManualLine) {
    return [node];
  }

  return lines.map((children, index) => {
    const paragraph = {
      ...node,
      children: children.length ? children : [{ type: "text", value: "" }],
    };

    return index === 0 ? paragraph : withClassName(paragraph, "markdown-manual-line");
  });
}

function remarkManualLineParagraphs() {
  return (tree: MarkdownAstNode) => {
    function visit(node: MarkdownAstNode): void {
      if (!node || typeof node !== "object") {
        return;
      }

      if (!Array.isArray(node.children)) {
        return;
      }

      node.children = node.children.flatMap((child) => splitParagraphByManualLines(child));

      node.children.forEach(visit);
    }

    visit(tree);
  };
}

export function MarkdownText({ children }: MarkdownTextProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkManualLineParagraphs]}
      components={markdownComponents}
    >
      {preserveMarkdownBlankLines(children)}
    </ReactMarkdown>
  );
}
