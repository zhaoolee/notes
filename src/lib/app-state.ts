import sampleMarkdown from "../../example/程序员狠话Vol.5.md?raw";
import type { ThemeId, ThemeOption } from "../types/app";

export const FALLBACK_CONTENT = "";
export const DRAFT_STORAGE_KEY = "notes.markdownDraft";
export const THEME_STORAGE_KEY = "notes.previewTheme";
export const THEME_OPTIONS: ThemeOption[] = [
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
export const DEFAULT_THEME_ID: ThemeId = THEME_OPTIONS[0].id;
export const SAMPLE_MARKDOWN_CONTENT = sampleMarkdown || FALLBACK_CONTENT;

function readStoredValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function readSearchParam(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get(key);
}

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function getInitialMarkdown(): string {
  const storedDraft = readStoredValue(DRAFT_STORAGE_KEY);

  if (storedDraft != null) {
    return storedDraft;
  }

  return SAMPLE_MARKDOWN_CONTENT;
}

export function getInitialTheme(): ThemeId {
  const searchTheme = readSearchParam("theme");

  if (isThemeId(searchTheme)) {
    return searchTheme;
  }

  const storedTheme = readStoredValue(THEME_STORAGE_KEY);

  if (isThemeId(storedTheme)) {
    return storedTheme;
  }

  return DEFAULT_THEME_ID;
}

export function getRenderMode(): string | null {
  return readSearchParam("renderMode");
}
