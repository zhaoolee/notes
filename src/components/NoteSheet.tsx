import type { ReactNode } from "react";
import { DEFAULT_FOOTER_LOGO_URL } from "../lib/footer.js";
import type { NoteSection } from "../types/app.js";
import { MarkdownInlineText, MarkdownText } from "./MarkdownText.js";

interface NoteSheetProps {
  notes: NoteSection[];
  footerBrand: ReactNode;
  footerLogoUrl?: string;
  footerVia: ReactNode;
}

function isDocumentTitle(note: NoteSection, index: number) {
  return (
    index === 0 &&
    note.headingAlignment === "center" &&
    /^#(?!#)\s+/.test(note.heading.trim())
  );
}

export function NoteSheet({
  notes,
  footerBrand,
  footerLogoUrl = DEFAULT_FOOTER_LOGO_URL,
  footerVia,
}: NoteSheetProps) {
  const isDefaultFooterLogo = footerLogoUrl === DEFAULT_FOOTER_LOGO_URL;

  return (
    <div className="note-sheet">
      <div className="sheet-frame sheet-frame-outer" />
      <div className="sheet-frame sheet-frame-inner" />
      <span className="sheet-corner sheet-corner-top-left" />
      <span className="sheet-corner sheet-corner-top-right" />
      <span className="sheet-corner sheet-corner-bottom-left" />
      <span className="sheet-corner sheet-corner-bottom-right" />

      <div className="note-apple-toolbar" aria-hidden="true">
        <span className="note-apple-back">
          <span className="note-apple-back-chevron">‹</span>
          备忘录
        </span>
        <span className="note-apple-actions">
          <span className="note-apple-action-icon note-apple-share">
            <svg
              viewBox="0 0 86.6722412109375 117.4306640625"
              focusable="false"
            >
              <g transform="matrix(1 0 0 1 -12.448911132812555 93.9453125)">
                <path d="M55.7617-21.9727C57.8613-21.9727 59.668-23.7305 59.668-25.7812L59.668-75.9277L59.375-83.252L62.6465-79.7852L70.0684-71.875C70.752-71.0938 71.7285-70.7031 72.7051-70.7031C74.707-70.7031 76.2695-72.168 76.2695-74.1699C76.2695-75.1953 75.8301-75.9766 75.0977-76.709L58.5938-92.627C57.6172-93.6035 56.7871-93.9453 55.7617-93.9453C54.7852-93.9453 53.9551-93.6035 52.9297-92.627L36.4258-76.709C35.6934-75.9766 35.3027-75.1953 35.3027-74.1699C35.3027-72.168 36.7676-70.7031 38.8184-70.7031C39.7461-70.7031 40.8203-71.0938 41.5039-71.875L48.877-79.7852L52.1973-83.252L51.9043-75.9277L51.9043-25.7812C51.9043-23.7305 53.6621-21.9727 55.7617-21.9727ZM27.7832 16.2598L83.7891 16.2598C93.9941 16.2598 99.1211 11.1816 99.1211 1.12305L99.1211-47.6074C99.1211-57.666 93.9941-62.7441 83.7891-62.7441L70.166-62.7441L70.166-54.8828L83.6426-54.8828C88.4766-54.8828 91.2598-52.2461 91.2598-47.168L91.2598 0.683594C91.2598 5.76172 88.4766 8.39844 83.6426 8.39844L27.8809 8.39844C22.998 8.39844 20.3125 5.76172 20.3125 0.683594L20.3125-47.168C20.3125-52.2461 22.998-54.8828 27.8809-54.8828L41.4062-54.8828L41.4062-62.7441L27.7832-62.7441C17.5781-62.7441 12.4512-57.666 12.4512-47.6074L12.4512 1.12305C12.4512 11.1816 17.5781 16.2598 27.7832 16.2598Z" />
              </g>
            </svg>
          </span>
          <span className="note-apple-action-icon note-apple-compose">
            <svg
              viewBox="0 0 106.68408203125 103.19677734375"
              focusable="false"
            >
              <g transform="matrix(1 0 0 1 -7.402929687500091 86.828369140625)">
                <path d="M109.326-75.293L112.842-78.9062C114.502-80.6641 114.502-83.0078 112.842-84.6191L111.719-85.791C110.205-87.3047 107.812-87.1094 106.201-85.5469L102.637-82.0312ZM50.5859-22.0215L60.1074-26.1719L105.713-71.7285L99.0234-78.3203L53.4668-32.7637L49.0723-23.584C48.6816-22.7539 49.6582-21.6309 50.5859-22.0215ZM32.8125 9.61914L90.1367 9.61914C98.9258 9.61914 104.004 4.54102 104.004-5.51758L104.004-57.7148L96.1426-49.8535L96.1426-5.9082C96.1426-0.830078 93.4082 1.75781 90.0391 1.75781L32.959 1.75781C28.0762 1.75781 25.3418-0.830078 25.3418-5.9082L25.3418-61.3281C25.3418-66.4062 28.0762-69.043 32.959-69.043L77.4414-69.043L85.3027-76.9043L32.8125-76.9043C22.6562-76.9043 17.4805-71.8262 17.4805-61.7676L17.4805-5.51758C17.4805 4.58984 22.6562 9.61914 32.8125 9.61914Z" />
              </g>
            </svg>
          </span>
        </span>
      </div>

      <div className="sheet-inner">
        {notes.map((note, index) => (
          <article
            className={`note-section${
              note.heading && note.headingAlignment !== "center"
                ? " has-heading"
                : ""
            }${isDocumentTitle(note, index) ? " is-document-title" : ""}`}
            key={`${note.heading}-${index}`}
          >
            {note.heading && note.headingAlignment !== "center" ? (
              <header className="note-index">
                <h2>
                  <MarkdownInlineText>{note.heading}</MarkdownInlineText>
                </h2>
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
        <span
          className={`sheet-footer-icon${isDefaultFooterLogo ? " is-default-footer-logo" : ""}`}
          aria-hidden="true"
        >
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
