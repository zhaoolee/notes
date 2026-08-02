import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getChangelogSections } from "../lib/changelog.js";
import {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
} from "../lib/footer.js";
import { getInitialTheme } from "../lib/themes.js";
import { useResolvedTheme } from "../lib/use-theme.js";
import { NoteSheet } from "./NoteSheet.js";

const BASE_NOTE_WIDTH = 330;
const DESKTOP_NOTE_SCALE = 2;
const MOBILE_NOTE_SCALE = 1.4;
const MOBILE_BREAKPOINT = 640;
const STAGE_HORIZONTAL_PADDING = 20;

function getInitialNoteScale(): number {
  if (typeof window === "undefined") {
    return DESKTOP_NOTE_SCALE;
  }

  const targetScale =
    window.innerWidth <= MOBILE_BREAKPOINT
      ? MOBILE_NOTE_SCALE
      : DESKTOP_NOTE_SCALE;
  const availableWidth = Math.max(
    window.innerWidth - STAGE_HORIZONTAL_PADDING,
    0,
  );

  return Math.min(targetScale, availableWidth / BASE_NOTE_WIDTH);
}

interface ChangelogPageProps {
  markdown: string;
}

export function ChangelogPage({ markdown }: ChangelogPageProps) {
  const themePreference = getInitialTheme();
  const theme = useResolvedTheme(themePreference);
  const notes = useMemo(() => getChangelogSections(markdown), [markdown]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [noteScale, setNoteScale] = useState(getInitialNoteScale);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = "更新日志 · 锤子便签";
  }, [theme]);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const updateNoteScale = () => {
      const styles = window.getComputedStyle(stage);
      const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const availableWidth = Math.max(stage.clientWidth - paddingX, 0);
      const targetScale =
        window.innerWidth <= MOBILE_BREAKPOINT
          ? MOBILE_NOTE_SCALE
          : DESKTOP_NOTE_SCALE;
      const fittedScale =
        availableWidth > 0 ? availableWidth / BASE_NOTE_WIDTH : targetScale;

      setNoteScale(Math.min(targetScale, fittedScale));
    };

    updateNoteScale();

    const resizeObserver = new ResizeObserver(updateNoteScale);
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
    <div
      className="app-layout changelog-page"
      data-theme={theme}
      data-theme-preference={themePreference}
    >
      <header className="app-topbar changelog-topbar">
        <div className="app-topbar-inner changelog-topbar-inner">
          <a className="changelog-back" href="/" aria-label="返回锤子便签">
            <span className="mobile-back-icon" aria-hidden="true" />
          </a>

          <a className="app-brand changelog-brand" href="/">
            <span className="app-brand-mark" aria-hidden="true" />
            <span className="app-brand-copy">
              <span className="app-brand-title">锤子便签</span>
            </span>
          </a>

          <span className="changelog-page-title">更新日志</span>
          <a className="changelog-home-link" href="/">
            返回便签
          </a>
        </div>
      </header>

      <main className="changelog-main">
        <div
          className="changelog-preview-stage"
          ref={stageRef}
          style={previewStyle}
        >
          <NoteSheet
            notes={notes}
            footerBrand={DEFAULT_FOOTER_BRAND}
            footerLogoUrl={DEFAULT_FOOTER_LOGO_URL}
            footerVia={DEFAULT_FOOTER_VIA}
          />
        </div>
      </main>
    </div>
  );
}
