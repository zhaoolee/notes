import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import sampleMarkdown from "../example/程序员狠话Vol.5.md?raw";

const FALLBACK_CONTENT = ``;
const DRAFT_STORAGE_KEY = "notes.markdownDraft";

function readStoredValue(key) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function getInitialMarkdown() {
  const storedDraft = readStoredValue(DRAFT_STORAGE_KEY);

  if (storedDraft != null) {
    return storedDraft;
  }

  return sampleMarkdown || FALLBACK_CONTENT;
}

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

async function saveExport(blob, filename) {
  const file = new File([blob], filename, { type: "image/png" });
  const isCoarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches;

  if (
    isCoarsePointer &&
    typeof navigator !== "undefined" &&
    navigator.share &&
    navigator.canShare?.({ files: [file] })
  ) {
    await navigator.share({
      files: [file],
      title: filename,
    });
    return;
  }

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";

  if (isCoarsePointer) {
    link.target = "_blank";
    link.download = "";
  }

  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 60_000);
}

async function tryServerExport(markdown, filename) {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename,
      markdown,
    }),
  });

  if (!response.ok) {
    throw new Error(`Server export failed: ${response.status}`);
  }

  return response.blob();
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
  const [markdown, setMarkdown] = useState(getInitialMarkdown);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [pendingAction, setPendingAction] = useState(null);

  const notes = splitSections(markdown);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(DRAFT_STORAGE_KEY, markdown);
  }, [markdown]);

  async function handleExport() {
    if (isExporting) {
      return;
    }

    try {
      setIsExporting(true);
      setExportError("");
      const filename = slugifyFilename(markdown);
      const blob = await tryServerExport(markdown, filename);
      await saveExport(blob, filename);
    } catch {
      setExportError("导出依赖后端 Playwright 服务，当前 /api/export 不可用。");
    } finally {
      setIsExporting(false);
    }
  }

  function requestReplaceMarkdown(nextMarkdown, title, description) {
    setPendingAction({
      nextMarkdown,
      title,
      description,
    });
  }

  function confirmReplaceMarkdown() {
    if (!pendingAction) {
      return;
    }

    setMarkdown(pendingAction.nextMarkdown);
    setPendingAction(null);
  }

  return (
    <>
      <div className="app-shell">
        <aside className="editor-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Markdown Note</p>
              <h1>便签导出器</h1>
            </div>
          </div>

          <div className="toolbar">
            <button
              type="button"
              onClick={() =>
                requestReplaceMarkdown(
                  sampleMarkdown,
                  "加载示例？",
                  "这会覆盖你当前正在编辑的草稿内容。",
                )
              }
            >
              加载示例
            </button>
            <button
              type="button"
              onClick={() =>
                requestReplaceMarkdown(
                  FALLBACK_CONTENT,
                  "清空重写？",
                  "这会清空当前草稿，建议确认后再继续。",
                )
              }
            >
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
            <div className="preview-actions">
              <button type="button" className="primary preview-export" onClick={handleExport}>
                {isExporting ? "导出中..." : "导出 PNG"}
              </button>
              {exportError ? <p className="export-status">{exportError}</p> : null}
            </div>
          </div>

          <div className="preview-stage">
            <div className="note-sheet">
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

      {pendingAction ? (
        <div className="confirm-dialog-backdrop" onClick={() => setPendingAction(null)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="confirm-dialog-title">{pendingAction.title}</h3>
            <p>{pendingAction.description}</p>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setPendingAction(null)}>
                取消
              </button>
              <button type="button" className="primary" onClick={confirmReplaceMarkdown}>
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
