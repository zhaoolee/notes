import { useState } from "react";
import { THEME_OPTIONS } from "../lib/themes.js";
import type { ThemeId } from "../types/app.js";

interface SettingsPanelProps {
  selectedTheme: ThemeId;
  onClose: () => void;
  onThemeChange: (themeId: ThemeId) => void;
}

type SettingsPage = "root" | "background";

function getThemeName(themeId: ThemeId): string {
  return THEME_OPTIONS.find((option) => option.id === themeId)?.description ?? "暖白纸感";
}

export function SettingsPanel({
  selectedTheme,
  onClose,
  onThemeChange,
}: SettingsPanelProps) {
  const [page, setPage] = useState<SettingsPage>("root");
  const isRootPage = page === "root";

  function handleBack() {
    if (isRootPage) {
      onClose();
      return;
    }

    setPage("root");
  }

  function handleThemeChange(themeId: ThemeId) {
    onThemeChange(themeId);
    setPage("root");
  }

  return (
    <div
      id="app-settings-panel"
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-settings-title"
      data-settings-page={page}
    >
      <header className="settings-panel-header">
        <button
          type="button"
          className="settings-back"
          aria-label={isRootPage ? "关闭设置" : "返回设置"}
          onClick={handleBack}
        >
          <span aria-hidden="true" />
        </button>
        <h2 id="app-settings-title">{isRootPage ? "设置" : "背景颜色"}</h2>
        <button
          type="button"
          className="settings-close"
          aria-label="关闭设置"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="settings-content">
        {isRootPage ? (
          <section className="settings-card" aria-label="便签偏好">
            <button
              type="button"
              className="settings-row"
              aria-label={`背景颜色，当前为${getThemeName(selectedTheme)}`}
              onClick={() => setPage("background")}
            >
              <span className="settings-row-label">背景颜色</span>
              <span className="settings-row-value">
                {getThemeName(selectedTheme)}
                <span className="settings-row-chevron" aria-hidden="true">
                  ›
                </span>
              </span>
            </button>
          </section>
        ) : (
          <section className="settings-card settings-theme-list" aria-label="选择背景颜色">
            {THEME_OPTIONS.map((option) => {
              const isActive = option.id === selectedTheme;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-theme-row${isActive ? " active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => handleThemeChange(option.id)}
                >
                  <span
                    className={`settings-theme-swatch settings-theme-swatch-${option.id}`}
                    aria-hidden="true"
                  />
                  <span className="settings-theme-copy">
                    <strong>{option.description}</strong>
                    <span>{option.label}</span>
                  </span>
                  <span className="settings-theme-check" aria-hidden="true">
                    {isActive ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
