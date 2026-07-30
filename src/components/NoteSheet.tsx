import type { ReactNode } from "react";
import { DEFAULT_FOOTER_LOGO_URL } from "../lib/footer.js";
import type { NoteSection } from "../types/app.js";
import { MarkdownText } from "./MarkdownText.js";

interface NoteSheetProps {
  notes: NoteSection[];
  footerBrand: ReactNode;
  footerLogoUrl?: string;
  footerVia: ReactNode;
}

export function NoteSheet({
  notes,
  footerBrand,
  footerLogoUrl = DEFAULT_FOOTER_LOGO_URL,
  footerVia,
}: NoteSheetProps) {
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
            {note.heading && note.headingAlignment !== "center" ? (
              <header className="note-index">
                <MarkdownText>{note.heading}</MarkdownText>
              </header>
            ) : null}

            <div className="note-copy">
              {note.heading && note.headingAlignment === "center" ? (
                <div className="note-centered-line">
                  <MarkdownText>{note.heading}</MarkdownText>
                </div>
              ) : null}
              <MarkdownText>
                {note.content ||
                  (note.headingAlignment === "center" ? "" : " ")}
              </MarkdownText>
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
          <img
            src={footerLogoUrl}
            alt=""
            width="48"
            height="48"
          />
        </span>
        <span className="sheet-footer-copy">
          {footerBrand}
          {footerVia}
        </span>
      </div>
    </div>
  );
}
