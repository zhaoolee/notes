import type { ReactNode } from "react";
import type { NoteSection } from "../types/app.js";
import { MarkdownText } from "./MarkdownText.js";

interface NoteSheetProps {
  notes: NoteSection[];
  footerBrand: ReactNode;
  footerVia: ReactNode;
}

export function NoteSheet({ notes, footerBrand, footerVia }: NoteSheetProps) {
  return (
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
            <p>不要因为走得太远，</p>
            <p>就忘了当初为什么出发。</p>
            <p>Don't forget why you started just because you've come so far.</p>
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
          {footerBrand}
          {footerVia}
        </span>
      </div>
    </div>
  );
}
