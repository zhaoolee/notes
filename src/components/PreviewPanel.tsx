import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { NoteSection } from "../types/app";
import { MarkdownText } from "./MarkdownText";

interface PreviewPanelProps {
  notes: NoteSection[];
  exportError: string;
  footerBrand: string;
  footerVia: string;
  onFooterBrandChange: (footerBrand: string) => void;
  onFooterViaChange: (footerVia: string) => void;
}

interface FooterTextEditorProps {
  className: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}

const BASE_NOTE_WIDTH = 330;
const DESKTOP_NOTE_SCALE = 2;
const MOBILE_NOTE_SCALE = 1.4;
const MOBILE_BREAKPOINT = 640;

function FooterTextEditor({ className, value, maxLength, onChange }: FooterTextEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!isEditing) {
      setDraft(value);
    }
  }, [isEditing, value]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function commit(nextValue: string) {
    onChange(nextValue);
    setIsEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      commit(draft);
      return;
    }

    if (event.key === "Escape") {
      setDraft(value);
      setIsEditing(false);
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className={`${className} sheet-footer-input`}
        value={draft}
        maxLength={maxLength}
        onBlur={() => commit(draft)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <button
      type="button"
      className={`${className} sheet-footer-editable`}
      onClick={() => setIsEditing(true)}
    >
      {value}
    </button>
  );
}

export function PreviewPanel({
  notes,
  exportError,
  footerBrand,
  footerVia,
  onFooterBrandChange,
  onFooterViaChange,
}: PreviewPanelProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [noteScale, setNoteScale] = useState(DESKTOP_NOTE_SCALE);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage || typeof window === "undefined") {
      return;
    }

    const updateNoteScale = () => {
      const styles = window.getComputedStyle(stage);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const availableWidth = Math.max(stage.clientWidth - paddingX, 0);
      const targetScale =
        window.innerWidth <= MOBILE_BREAKPOINT ? MOBILE_NOTE_SCALE : DESKTOP_NOTE_SCALE;
      const fittedScale = availableWidth > 0 ? availableWidth / BASE_NOTE_WIDTH : targetScale;

      setNoteScale(Math.min(targetScale, fittedScale));
    };

    updateNoteScale();

    const resizeObserver = new ResizeObserver(() => {
      updateNoteScale();
    });

    resizeObserver.observe(stage);
    window.addEventListener("resize", updateNoteScale);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateNoteScale);
    };
  }, []);

  const previewStyle = {
    "--note-scale": String(noteScale),
  } as CSSProperties;

  return (
    <main className="preview-panel">
      {exportError ? <p className="export-status">{exportError}</p> : null}

      <div className="preview-stage" ref={stageRef} style={previewStyle}>
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
              <FooterTextEditor
                className="sheet-footer-brand"
                value={footerBrand}
                maxLength={80}
                onChange={onFooterBrandChange}
              />
              <FooterTextEditor
                className="sheet-footer-via"
                value={footerVia}
                maxLength={80}
                onChange={onFooterViaChange}
              />
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
