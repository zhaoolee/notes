import type {
  NoteCardThemeOption,
  NoteCardThemeId,
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
export const NOTE_CARD_THEME_STORAGE_KEY = "notes.previewCardTheme";

export const NOTE_CARD_THEME_OPTIONS: NoteCardThemeOption[] = [
  {
    id: "default",
    label: "暖白质感",
    description: "温润纸面",
  },
  {
    id: "smartisan-dark",
    label: "深夜便签",
    description: "低亮暗色",
  },
  {
    id: "apple-notes-light",
    label: "iPhone 浅色",
    description: "Apple 备忘录质感",
  },
  {
    id: "apple-notes",
    label: "iPhone 深色",
    description: "Apple 备忘录质感",
  },
  {
    id: "bear",
    label: "Bear 便签",
    description: "红色极简排版",
  },
  {
    id: "bazhahei",
    label: "老罗巴扎嘿",
    description: "暖色杂志排版",
  },
  {
    id: "telegraph",
    label: "Telegra.ph",
    description: "简洁出版排版",
  },
];

export function isNoteCardThemeId(
  value: string | null | undefined,
): value is NoteCardThemeId {
  return NOTE_CARD_THEME_OPTIONS.some((option) => option.id === value);
}

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

export function getInitialNoteCardTheme(): NoteCardThemeId | null {
  if (typeof window === "undefined") {
    return null;
  }

  const searchTheme = new URLSearchParams(window.location.search).get("theme");

  if (isNoteCardThemeId(searchTheme)) {
    return searchTheme;
  }

  const storedTheme = window.localStorage.getItem(
    NOTE_CARD_THEME_STORAGE_KEY,
  );

  return isNoteCardThemeId(storedTheme) ? storedTheme : null;
}
