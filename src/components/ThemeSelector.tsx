import { THEME_OPTIONS } from "../lib/app-state";
import type { ThemeId } from "../types/app";

interface ThemeSelectorProps {
  value: ThemeId;
  onChange: (themeId: ThemeId) => void;
}

export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  return (
    <div className="theme-selector" aria-label="主题选择器">
      <div className="theme-selector-options" role="tablist" aria-label="选择便签主题">
        {THEME_OPTIONS.map((option) => {
          const isActive = option.id === value;

          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`theme-selector-option${isActive ? " active" : ""}`}
              onClick={() => onChange(option.id)}
            >
              <span
                className={`theme-selector-swatch theme-selector-swatch-${option.id}`}
                aria-hidden="true"
              />
              <span className="theme-selector-meta">
                <span className="theme-selector-name">{option.label}</span>
                <span className="theme-selector-copy">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
