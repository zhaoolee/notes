import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { NoteSection } from "../types/app";
import { NoteSheet } from "./NoteSheet.js";

interface PreviewPanelProps {
  notes: NoteSection[];
  exportError: string;
  footerBrand: string;
  footerLogoUrl: string;
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
  footerLogoUrl,
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
        <NoteSheet
          notes={notes}
          footerLogoUrl={footerLogoUrl}
          footerBrand={
            <FooterTextEditor
              className="sheet-footer-brand"
              value={footerBrand}
              maxLength={80}
              onChange={onFooterBrandChange}
            />
          }
          footerVia={
            <FooterTextEditor
              className="sheet-footer-via"
              value={footerVia}
              maxLength={80}
              onChange={onFooterViaChange}
            />
          }
        />
      </div>
    </main>
  );
}
