import type {
  ThemeId,
  ThemeOption,
  ThemePreferenceId,
} from "../types/app.js";

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "system",
    label: "跟随系统日夜切换",
    description: "自动适应",
  },
  {
    id: "default",
    label: "默认主题",
    description: "暖白纸感",
  },
  {
    id: "smartisan-dark",
    label: "锤子暗黑",
    description: "深夜便签",
  },
];

export const DEFAULT_THEME_ID: ThemeId = "default";
export const DEFAULT_THEME_PREFERENCE_ID: ThemePreferenceId = DEFAULT_THEME_ID;
export const THEME_STORAGE_KEY = "notes.previewTheme";

export function isThemePreferenceId(
  value: string | null | undefined,
): value is ThemePreferenceId {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function resolveThemePreference(
  preference: ThemePreferenceId,
  systemPrefersDark: boolean,
): ThemeId {
  if (preference === "system") {
    return systemPrefersDark ? "smartisan-dark" : "default";
  }

  return preference;
}

export function getInitialTheme(): ThemePreferenceId {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_PREFERENCE_ID;
  }

  const searchTheme = new URLSearchParams(window.location.search).get("theme");

  if (isThemePreferenceId(searchTheme)) {
    return searchTheme;
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  return isThemePreferenceId(storedTheme)
    ? storedTheme
    : DEFAULT_THEME_PREFERENCE_ID;
}
