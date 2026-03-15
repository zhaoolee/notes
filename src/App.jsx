import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import sampleMarkdown from "../example/程序员狠话Vol.5.md?raw";

const FALLBACK_CONTENT = ``;

function normalizeSingleLineBlockquotes(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const normalized = [];

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

function splitSections(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;

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
    .map((section) => {
      return {
        heading: section.heading.trim(),
        content: normalizeSingleLineBlockquotes(section.lines.join("\n")).trim(),
      };
    })
    .filter((section) => section.heading || section.content);
}

function slugifyFilename(markdown) {
  const firstHeading = markdown.match(/^##\s+\*{0,2}([^*\n]+)\*{0,2}/m)?.[1];
  const base = firstHeading ? firstHeading.trim() : "note-export";
  return `${base.replace(/[\\/:*?"<>|]/g, "-") || "note-export"}.png`;
}

function getExportPixelRatio(width, height) {
  const preferredRatio = 3;
  const maxCanvasEdge = 16384;
  const maxCanvasArea = 120_000_000;

  return Math.max(
    1,
    Math.min(
      preferredRatio,
      maxCanvasEdge / width,
      maxCanvasEdge / height,
      Math.sqrt(maxCanvasArea / (width * height)),
    ),
  );
}

function MarkdownText({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: content }) => <p>{content}</p>,
        strong: ({ children: content }) => <strong>{content}</strong>,
        em: ({ children: content }) => <em>{content}</em>,
        a: ({ children: content, href }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {content}
          </a>
        ),
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt || ""}
            loading="eager"
            decoding="sync"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
          />
        ),
        code: ({ children: content }) => <code>{content}</code>,
        blockquote: ({ children: content }) => <blockquote>{content}</blockquote>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export default function App() {
  const previewRef = useRef(null);
  const [markdown, setMarkdown] = useState(sampleMarkdown || FALLBACK_CONTENT);
  const [isExporting, setIsExporting] = useState(false);

  const notes = splitSections(markdown);

  async function handleExport() {
    if (!previewRef.current || isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      const width = Math.ceil(previewRef.current.scrollWidth);
      const height = Math.ceil(previewRef.current.scrollHeight);
      const pixelRatio = getExportPixelRatio(width, height);

      const dataUrl = await toPng(previewRef.current, {
        cacheBust: true,
        pixelRatio,
        backgroundColor: "#f6f1e8",
        width,
        height,
        canvasWidth: width * pixelRatio,
        canvasHeight: height * pixelRatio,
        style: {
          width: `${width}px`,
          height: `${height}px`,
        },
      });

      const link = document.createElement("a");
      link.download = slugifyFilename(markdown);
      link.href = dataUrl;
      link.click();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="editor-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Markdown Note</p>
            <h1>便签导出器</h1>
          </div>
        </div>

        <div className="toolbar">
          <button type="button" onClick={() => setMarkdown(sampleMarkdown)}>
            加载示例
          </button>
          <button type="button" onClick={() => setMarkdown(FALLBACK_CONTENT)}>
            清空重写
          </button>
        </div>

        <label className="input-label" htmlFor="markdown-editor">
          Markdown 内容
        </label>
        <textarea
          id="markdown-editor"
          className="markdown-editor"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          spellCheck="false"
        />

      </aside>

      <main className="preview-panel">
        <div className="preview-header">
          <div>
            <p className="eyebrow">Live Preview</p>
            <h2>导出画布</h2>
          </div>
          <button type="button" className="primary preview-export" onClick={handleExport}>
            {isExporting ? "导出中..." : "导出 PNG"}
          </button>
        </div>

        <div className="preview-stage">
          <div className="note-sheet" ref={previewRef}>
            <div className="sheet-frame sheet-frame-outer" />
            <div className="sheet-frame sheet-frame-inner" />
            <span className="sheet-corner sheet-corner-top-left" />
            <span className="sheet-corner sheet-corner-top-right" />
            <span className="sheet-corner sheet-corner-bottom-left" />
            <span className="sheet-corner sheet-corner-bottom-right" />

            <div className="sheet-inner">
              {notes.map((note, index) => (
                <article className="note-section" key={`${note.heading}-${index}`}>
                  {note.heading ? (
                    <header className="note-index">
                      <MarkdownText>{note.heading}</MarkdownText>
                    </header>
                  ) : null}

                  <div className="note-copy">
                    <MarkdownText>{note.content || " "}</MarkdownText>
                  </div>
                </article>
              ))}

              {!notes.length ? (
                <article className="note-section empty-state">
                  <p>还没有可预览的内容。</p>
                  <p>在左侧输入以 `##` 开头的段落即可生成便签。</p>
                </article>
              ) : null}
            </div>

            <div className="sheet-footer">
              <span className="sheet-footer-icon">T</span>
              <span className="sheet-footer-brand">由锤子便签发送</span>
              <span className="sheet-footer-via">via Smartisan Notes</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
