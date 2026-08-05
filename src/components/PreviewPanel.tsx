import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { NOTE_CARD_THEME_OPTIONS } from "../lib/themes.js";
import type { NoteCardThemeId, NoteSection } from "../types/app.js";
import { NoteSheet } from "./NoteSheet.js";

interface PreviewPanelProps {
  notes: NoteSection[];
  exportError: string;
  footerBrand: string;
  footerLogoUrl: string;
  footerVia: string;
  noteCardTheme: NoteCardThemeId;
  onFooterBrandChange: (footerBrand: string) => void;
  onFooterViaChange: (footerVia: string) => void;
  onNoteCardThemeChange: (theme: NoteCardThemeId) => void;
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

interface NoteCardThemePickerProps {
  value: NoteCardThemeId;
  onChange: (theme: NoteCardThemeId) => void;
}

function NoteCardThemePicker({ value, onChange }: NoteCardThemePickerProps) {
  const popoverId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const activeOption = NOTE_CARD_THEME_OPTIONS.find(
    (option) => option.id === value,
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen]);

  function handleSelect(theme: NoteCardThemeId) {
    onChange(theme);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="preview-theme-control" ref={containerRef}>
      {isOpen ? (
        <div
          className="preview-theme-popover"
          id={popoverId}
          role="menu"
          aria-label="选择预览主题"
        >
          <p className="preview-theme-popover-title">主题</p>
          <div className="preview-theme-options">
            {NOTE_CARD_THEME_OPTIONS.map((option) => {
              const isActive = option.id === value;

              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`preview-theme-option${isActive ? " is-active" : ""}`}
                  onClick={() => handleSelect(option.id)}
                >
                  <span
                    className="preview-theme-swatch"
                    data-preview-theme={option.id}
                    aria-hidden="true"
                  />
                  <span className="preview-theme-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="preview-theme-option-check" aria-hidden="true">
                    {isActive ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        className="preview-theme-trigger"
        aria-label={`切换预览主题，当前${activeOption?.label ?? "默认主题"}`}
        aria-controls={popoverId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span
          className="preview-theme-trigger-swatch"
          data-preview-theme={value}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </span>
        <span>主题</span>
      </button>
    </div>
  );
}

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
  noteCardTheme,
  onFooterBrandChange,
  onFooterViaChange,
  onNoteCardThemeChange,
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
        <div
          className="preview-card-theme"
          data-preview-theme={noteCardTheme}
        >
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
      </div>

      <NoteCardThemePicker
        value={noteCardTheme}
        onChange={onNoteCardThemeChange}
      />
    </main>
  );
}
