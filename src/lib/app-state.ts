import sampleMarkdown from "../../example/程序员狠话Vol.5.md?raw";
import {
  createSmartisanWebTestWorkspace,
  SMARTISAN_WEB_TEST_DATA_ID,
  SMARTISAN_WEB_TEST_WORKSPACE_STORAGE_KEY,
} from "../fixtures/smartisan-web-test-workspace.js";
import type { NoteWorkspace } from "../types/app";
import { createNoteDocument, parseNoteWorkspace } from "./notes";
import { consumeTestDataResetFromCurrentUrl } from "./test-data-url";
import {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
  FOOTER_BRAND_STORAGE_KEY,
  FOOTER_LOGO_STORAGE_KEY,
  FOOTER_LOGO_URL_MAX_LENGTH,
  FOOTER_TEXT_MAX_LENGTH,
  FOOTER_VIA_STORAGE_KEY,
  LEGACY_DEFAULT_FOOTER_BRAND,
  LEGACY_DEFAULT_FOOTER_VIA,
} from "./footer";

export {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
  FOOTER_BRAND_STORAGE_KEY,
  FOOTER_LOGO_STORAGE_KEY,
  FOOTER_LOGO_URL_MAX_LENGTH,
  FOOTER_TEXT_MAX_LENGTH,
  FOOTER_VIA_STORAGE_KEY,
} from "./footer";

export const FALLBACK_CONTENT = "";
export const DRAFT_STORAGE_KEY = "notes.markdownDraft";
export const WORKSPACE_STORAGE_KEY = "notes.workspace.v1";
export const AI_ENABLED_STORAGE_KEY = "notes.aiEnabled";
export const SAMPLE_MARKDOWN_CONTENT = sampleMarkdown || FALLBACK_CONTENT;

export {
  getInitialNoteCardTheme,
  getInitialTheme,
  NOTE_CARD_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./themes";

export function isSmartisanWebTestDataMode(): boolean {
  return readSearchParam("testData") === SMARTISAN_WEB_TEST_DATA_ID;
}

function getWorkspaceStorageKey(): string {
  return isSmartisanWebTestDataMode()
    ? SMARTISAN_WEB_TEST_WORKSPACE_STORAGE_KEY
    : WORKSPACE_STORAGE_KEY;
}

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

export function getInitialNoteWorkspace(): NoteWorkspace {
  if (getRenderMode() === "playwright") {
    const note = createNoteDocument(FALLBACK_CONTENT);
    return {
      activeNoteId: note.id,
      folders: [],
      notes: [note],
      version: 1,
    };
  }

  const shouldResetTestData =
    isSmartisanWebTestDataMode() && readSearchParam("resetTestData") === "1";

  if (shouldResetTestData) {
    consumeTestDataResetFromCurrentUrl();
  }

  const storedWorkspace = shouldResetTestData
    ? null
    : parseNoteWorkspace(readStoredValue(getWorkspaceStorageKey()));

  if (storedWorkspace) {
    return storedWorkspace;
  }

  if (isSmartisanWebTestDataMode()) {
    return createSmartisanWebTestWorkspace();
  }

  const storedDraft = readStoredValue(DRAFT_STORAGE_KEY);
  const note = createNoteDocument(storedDraft ?? SAMPLE_MARKDOWN_CONTENT);

  return {
    activeNoteId: note.id,
    folders: [],
    notes: [note],
    version: 1,
  };
}

export function persistNoteWorkspace(workspace: NoteWorkspace): void {
  if (typeof window === "undefined" || getRenderMode() === "playwright") {
    return;
  }

  window.localStorage.setItem(getWorkspaceStorageKey(), JSON.stringify(workspace));

  const activeNote = workspace.notes.find((note) => note.id === workspace.activeNoteId);
  if (activeNote && !isSmartisanWebTestDataMode()) {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, activeNote.markdown);
  }
}

export function getRenderMode(): string | null {
  return readSearchParam("renderMode");
}

export function getInitialAiEnabled(): boolean {
  return readStoredValue(AI_ENABLED_STORAGE_KEY) === "true";
}

export function persistAiEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || getRenderMode() === "playwright") {
    return;
  }

  window.localStorage.setItem(AI_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
}

export function getInitialFooterBrand(): string {
  const searchParam = readSearchParam("footerBrand");
  if (searchParam !== null) {
    return searchParam.slice(0, FOOTER_TEXT_MAX_LENGTH);
  }

  const storedBrand = readStoredValue(FOOTER_BRAND_STORAGE_KEY);
  return (storedBrand === LEGACY_DEFAULT_FOOTER_BRAND
    ? DEFAULT_FOOTER_BRAND
    : storedBrand ?? DEFAULT_FOOTER_BRAND
  ).slice(0, FOOTER_TEXT_MAX_LENGTH);
}

export function getInitialFooterVia(): string {
  const searchParam = readSearchParam("footerVia");
  if (searchParam !== null) {
    return searchParam.slice(0, FOOTER_TEXT_MAX_LENGTH);
  }

  const storedVia = readStoredValue(FOOTER_VIA_STORAGE_KEY);
  return (storedVia === LEGACY_DEFAULT_FOOTER_VIA
    ? DEFAULT_FOOTER_VIA
    : storedVia ?? DEFAULT_FOOTER_VIA
  ).slice(0, FOOTER_TEXT_MAX_LENGTH);
}

export function getInitialFooterLogoUrl(): string {
  return (
    readSearchParam("footerLogoUrl") ??
    readStoredValue(FOOTER_LOGO_STORAGE_KEY) ??
    DEFAULT_FOOTER_LOGO_URL
  ).slice(0, FOOTER_LOGO_URL_MAX_LENGTH);
}

export function persistFooterText(footerBrand: string, footerVia: string): void {
  if (typeof window === "undefined" || getRenderMode() === "playwright") {
    return;
  }

  window.localStorage.setItem(
    FOOTER_BRAND_STORAGE_KEY,
    footerBrand.slice(0, FOOTER_TEXT_MAX_LENGTH),
  );
  window.localStorage.setItem(
    FOOTER_VIA_STORAGE_KEY,
    footerVia.slice(0, FOOTER_TEXT_MAX_LENGTH),
  );
}

export function persistFooterLogoUrl(footerLogoUrl: string): void {
  if (typeof window === "undefined" || getRenderMode() === "playwright") {
    return;
  }

  window.localStorage.setItem(
    FOOTER_LOGO_STORAGE_KEY,
    footerLogoUrl.slice(0, FOOTER_LOGO_URL_MAX_LENGTH),
  );
}
