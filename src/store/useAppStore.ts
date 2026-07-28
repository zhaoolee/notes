import { create } from "zustand";
import { getInitialNoteWorkspace, getInitialTheme } from "../lib/app-state";
import {
  createNoteFolder,
  createNoteDocument,
  moveNoteToFolder,
  moveNoteToTrash,
  reorderNormalNoteDocuments,
  restoreNoteFromTrash,
  toggleNotePinned,
  toggleNoteStarred,
} from "../lib/notes";
import type {
  CopyState,
  NoteDocument,
  NoteFolder,
  PendingAction,
  ThemeId,
} from "../types/app";

interface AppStoreState {
  activeNoteId: string;
  folders: NoteFolder[];
  notes: NoteDocument[];
  markdown: string;
  selectedTheme: ThemeId;
  isExporting: boolean;
  exportError: string;
  copyState: CopyState;
  pendingAction: PendingAction | null;
  createNote: (
    markdown?: string,
    folderId?: string | null,
    isStarred?: boolean,
  ) => void;
  createFolder: (name: string) => string | null;
  deleteFolder: (folderId: string) => void;
  selectNote: (noteId: string) => void;
  requestDeleteNote: (noteId: string) => void;
  requestPermanentlyDeleteNote: (noteId: string) => void;
  restoreNote: (noteId: string) => void;
  reorderNotes: (activeNoteId: string, overNoteId: string) => void;
  moveNoteToFolder: (noteId: string, folderId: string | null) => void;
  setMarkdown: (markdown: string) => void;
  setSelectedTheme: (theme: ThemeId) => void;
  setIsExporting: (isExporting: boolean) => void;
  setExportError: (exportError: string) => void;
  setCopyState: (copyState: CopyState) => void;
  togglePinned: (noteId: string) => void;
  toggleStarred: (noteId: string) => void;
  requestReplaceMarkdown: (
    nextMarkdown: string,
    title: string,
    description: string,
  ) => void;
  clearPendingAction: () => void;
  confirmPendingAction: () => void;
}

const initialWorkspace = getInitialNoteWorkspace();
const initialActiveNote =
  initialWorkspace.notes.find((note) => note.id === initialWorkspace.activeNoteId) ??
  initialWorkspace.notes[0];

export const useAppStore = create<AppStoreState>((set, get) => ({
  activeNoteId: initialActiveNote.id,
  folders: initialWorkspace.folders,
  notes: initialWorkspace.notes,
  markdown: initialActiveNote.markdown,
  selectedTheme: getInitialTheme(),
  isExporting: false,
  exportError: "",
  copyState: "idle",
  pendingAction: null,
  createNote: (markdown = "", folderId = null, isStarred = false) =>
    set((state) => {
      const firstNormalOrder = state.notes.reduce(
        (smallest, note) => Math.min(smallest, note.normalOrder),
        0,
      );
      const note = createNoteDocument(
        markdown,
        Date.now(),
        firstNormalOrder - 1,
        folderId,
        isStarred,
      );

      return {
        activeNoteId: note.id,
        exportError: "",
        markdown: note.markdown,
        notes: [note, ...state.notes],
        pendingAction: null,
      };
    }),
  createFolder: (name) => {
    const normalizedName = name.trim();

    if (!normalizedName) {
      return null;
    }

    const existingFolder = get().folders.find(
      (folder) => folder.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
    );

    if (existingFolder) {
      return existingFolder.id;
    }

    const folder = createNoteFolder(normalizedName);
    set((state) => ({
      folders: [...state.folders, folder],
    }));
    return folder.id;
  },
  deleteFolder: (folderId) =>
    set((state) => ({
      folders: state.folders.filter((folder) => folder.id !== folderId),
      notes: state.notes.map((note) =>
        note.folderId === folderId
          ? {
              ...note,
              folderId: null,
            }
          : note,
      ),
    })),
  selectNote: (noteId) => {
    const note = get().notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    set({
      activeNoteId: note.id,
      exportError: "",
      markdown: note.markdown,
      pendingAction: null,
    });
  },
  requestDeleteNote: (noteId) => {
    const note = get().notes.find((candidate) => candidate.id === noteId);

    if (!note) {
      return;
    }

    set({
      pendingAction: {
        kind: "delete-note",
        noteId,
        title: "将这张便签移到回收站？",
        description: "便签会保留在回收站中，你之后仍可恢复或永久删除。",
        confirmLabel: "移到回收站",
      },
    });
  },
  requestPermanentlyDeleteNote: (noteId) => {
    const note = get().notes.find((candidate) => candidate.id === noteId);

    if (!note || note.deletedAt === null) {
      return;
    }

    set({
      pendingAction: {
        kind: "permanently-delete-note",
        noteId,
        title: "永久删除这张便签？",
        description: "永久删除后无法恢复，便签中的 Markdown 内容也会一并移除。",
        confirmLabel: "永久删除",
      },
    });
  },
  restoreNote: (noteId) =>
    set((state) => ({
      notes: restoreNoteFromTrash(state.notes, noteId),
    })),
  reorderNotes: (activeNoteId, overNoteId) =>
    set((state) => ({
      notes: reorderNormalNoteDocuments(
        state.notes,
        activeNoteId,
        overNoteId,
      ),
    })),
  moveNoteToFolder: (noteId, folderId) =>
    set((state) => {
      const isKnownFolder =
        folderId === null || state.folders.some((folder) => folder.id === folderId);

      return isKnownFolder
        ? {
            notes: moveNoteToFolder(state.notes, noteId, folderId),
          }
        : {};
    }),
  setMarkdown: (markdown) =>
    set((state) => {
      const updatedAt = Date.now();
      return {
        markdown,
        notes: state.notes.map((note) =>
          note.id === state.activeNoteId
            ? {
                ...note,
                markdown,
                updatedAt,
              }
            : note,
        ),
      };
    }),
  setSelectedTheme: (selectedTheme) => set({ selectedTheme }),
  setIsExporting: (isExporting) => set({ isExporting }),
  setExportError: (exportError) => set({ exportError }),
  setCopyState: (copyState) => set({ copyState }),
  togglePinned: (noteId) =>
    set((state) => ({
      notes: toggleNotePinned(state.notes, noteId),
    })),
  toggleStarred: (noteId) =>
    set((state) => ({
      notes: toggleNoteStarred(state.notes, noteId),
    })),
  requestReplaceMarkdown: (nextMarkdown, title, description) =>
    set((state) => ({
      pendingAction: {
        kind: "replace-markdown",
        noteId: state.activeNoteId,
        nextMarkdown,
        title,
        description,
        confirmLabel: "确认覆盖",
      },
    })),
  clearPendingAction: () => set({ pendingAction: null }),
  confirmPendingAction: () => {
    const { activeNoteId, notes, pendingAction } = get();

    if (!pendingAction) {
      return;
    }

    if (pendingAction.kind === "replace-markdown") {
      const updatedAt = Date.now();
      set({
        markdown:
          pendingAction.noteId === activeNoteId
            ? pendingAction.nextMarkdown
            : get().markdown,
        notes: notes.map((note) =>
          note.id === pendingAction.noteId
            ? {
                ...note,
                markdown: pendingAction.nextMarkdown,
                updatedAt,
              }
            : note,
        ),
        pendingAction: null,
      });
      return;
    }

    if (pendingAction.kind === "delete-note") {
      const deletedNotes = moveNoteToTrash(notes, pendingAction.noteId);

      if (pendingAction.noteId !== activeNoteId) {
        set({
          notes: deletedNotes,
          pendingAction: null,
        });
        return;
      }

      const liveNotes = deletedNotes.filter((note) => note.deletedAt === null);

      if (liveNotes.length === 0) {
        const emptyNote = createNoteDocument();
        set({
          activeNoteId: emptyNote.id,
          exportError: "",
          markdown: emptyNote.markdown,
          notes: [emptyNote, ...deletedNotes],
          pendingAction: null,
        });
        return;
      }

      const nextActiveNote = liveNotes[0];
      set({
        activeNoteId: nextActiveNote.id,
        exportError: "",
        markdown: nextActiveNote.markdown,
        notes: deletedNotes,
        pendingAction: null,
      });
      return;
    }

    const noteIndex = notes.findIndex((note) => note.id === pendingAction.noteId);
    const remainingNotes = notes.filter((note) => note.id !== pendingAction.noteId);

    if (remainingNotes.length === 0) {
      const emptyNote = createNoteDocument();
      set({
        activeNoteId: emptyNote.id,
        exportError: "",
        markdown: emptyNote.markdown,
        notes: [emptyNote],
        pendingAction: null,
      });
      return;
    }

    if (pendingAction.noteId !== activeNoteId) {
      set({
        notes: remainingNotes,
        pendingAction: null,
      });
      return;
    }

    const nextActiveNote =
      remainingNotes.find((note) => note.deletedAt === null) ??
      remainingNotes[Math.min(Math.max(noteIndex, 0), remainingNotes.length - 1)];
    set({
      activeNoteId: nextActiveNote.id,
      exportError: "",
      markdown: nextActiveNote.markdown,
      notes: remainingNotes,
      pendingAction: null,
    });
  },
}));
