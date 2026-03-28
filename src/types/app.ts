export type ThemeId = "default" | "smartisan-dark";

export type CopyState = "idle" | "copied" | "failed";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
}

export interface NoteSection {
  heading: string;
  content: string;
}

export interface PendingAction {
  nextMarkdown: string;
  title: string;
  description: string;
}

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
