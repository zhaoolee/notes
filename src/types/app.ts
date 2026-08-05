export type ThemeId = "default" | "smartisan-dark";
export type NoteCardThemeId =
  | ThemeId
  | "apple-notes"
  | "apple-notes-light"
  | "bear"
  | "telegraph";
export type ThemePreferenceId = ThemeId | "system";

export type CopyState = "idle" | "copied" | "failed";

export interface ThemeOption {
  id: ThemePreferenceId;
  label: string;
  description: string;
}

export interface NoteCardThemeOption {
  id: NoteCardThemeId;
  label: string;
  description: string;
}

export interface NoteSection {
  heading: string;
  headingAlignment?: "start" | "center";
  content: string;
}

export interface NoteDocument {
  id: string;
  markdown: string;
  createdAt: number;
  updatedAt: number;
  normalOrder: number;
  pinnedAt: number | null;
  folderId: string | null;
  isStarred: boolean;
  deletedAt: number | null;
}

export interface NoteFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface NoteWorkspace {
  activeNoteId: string;
  folders: NoteFolder[];
  notes: NoteDocument[];
  version: 1;
}

export type SystemNoteCategoryId = "all" | "starred" | "trash";
export type NoteCategoryId = SystemNoteCategoryId | `folder:${string}`;

interface PendingActionBase {
  confirmLabel: string;
  description: string;
  title: string;
}

export interface ReplaceMarkdownAction extends PendingActionBase {
  kind: "replace-markdown";
  nextMarkdown: string;
  noteId: string;
}

export interface DeleteNoteAction extends PendingActionBase {
  kind: "delete-note";
  noteId: string;
}

export interface PermanentlyDeleteNoteAction extends PendingActionBase {
  kind: "permanently-delete-note";
  noteId: string;
}

export type PendingAction =
  | ReplaceMarkdownAction
  | DeleteNoteAction
  | PermanentlyDeleteNoteAction;

export interface ImageImportResult {
  hash: string;
  extension: string;
  path: string;
  url: string;
}

export interface ExportErrorOptions {
  status?: number;
  retriable?: boolean;
  attempts?: number;
}

export class ExportError extends Error {
  status?: number;
  retriable: boolean;
  attempts: number;

  constructor(message: string, options: ExportErrorOptions = {}) {
    super(message);
    this.name = "ExportError";
    this.status = options.status;
    this.retriable = Boolean(options.retriable);
    this.attempts = options.attempts ?? 1;
  }
}
