import sampleMarkdown from "../../example/程序员狠话Vol.5.md?raw";
import type { ThemeId } from "../types/app";
import { DEFAULT_THEME_ID, isThemeId } from "./themes";

export const FALLBACK_CONTENT = "";
export const DRAFT_STORAGE_KEY = "notes.markdownDraft";
export const THEME_STORAGE_KEY = "notes.previewTheme";
export const DEFAULT_FOOTER_BRAND = "由锤子便签发送";
export const DEFAULT_FOOTER_VIA = "via Smartisan Notes";
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

export function getInitialMarkdown(): string {
  if (getRenderMode() === "playwright") {
    return FALLBACK_CONTENT;
  }

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

export function getInitialFooterBrand(): string {
  return readSearchParam("footerBrand") ?? DEFAULT_FOOTER_BRAND;
}

export function getInitialFooterVia(): string {
  return readSearchParam("footerVia") ?? DEFAULT_FOOTER_VIA;
}
