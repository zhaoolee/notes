import type { NoteSection } from "../types/app";
import { MarkdownText } from "./MarkdownText";

interface PreviewPanelProps {
  notes: NoteSection[];
  exportError: string;
}

export function PreviewPanel({ notes, exportError }: PreviewPanelProps) {
  return (
    <main className="preview-panel">
      {exportError ? <p className="export-status">{exportError}</p> : null}

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
            <span className="sheet-footer-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" role="img" focusable="false">
                <circle cx="16" cy="16" r="16" />
                <text x="50%" y="50%">
                  T
                </text>
              </svg>
            </span>
            <span className="sheet-footer-copy">
              <span className="sheet-footer-brand">由锤子便签发送</span>
              <span className="sheet-footer-via">via Smartisan Notes</span>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
