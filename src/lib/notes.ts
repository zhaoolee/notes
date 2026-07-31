import type {
  NoteCategoryId,
  NoteDocument,
  NoteFolder,
  NoteWorkspace,
} from "../types/app.js";

const NOTE_TITLE_MAX_LENGTH = 38;
const NOTE_PREVIEW_MAX_LENGTH = 88;
let fallbackIdSequence = 0;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownDecorators(value: string): string {
  return collapseWhitespace(
    value
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s*/, "")
      .replace(/^[-+*]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<https?:\/\/[^>]+>/g, "")
      .replace(/[`*_~]/g, ""),
  );
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function getMeaningfulLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map(stripMarkdownDecorators)
    .filter(Boolean);
}

function createNoteId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  fallbackIdSequence += 1;
  return `note-${now}-${fallbackIdSequence}`;
}

function createFolderId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  fallbackIdSequence += 1;
  return `folder-${now}-${fallbackIdSequence}`;
}

function isValidNote(value: unknown): value is NoteDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const note = value as Partial<NoteDocument>;
  return (
    typeof note.id === "string" &&
    Boolean(note.id) &&
    typeof note.markdown === "string" &&
    typeof note.createdAt === "number" &&
    Number.isFinite(note.createdAt) &&
    typeof note.updatedAt === "number" &&
    Number.isFinite(note.updatedAt) &&
    (note.normalOrder === undefined ||
      (typeof note.normalOrder === "number" && Number.isFinite(note.normalOrder))) &&
    (note.pinnedAt === undefined ||
      note.pinnedAt === null ||
      (typeof note.pinnedAt === "number" && Number.isFinite(note.pinnedAt))) &&
    (note.folderId === undefined ||
      note.folderId === null ||
      typeof note.folderId === "string") &&
    (note.isStarred === undefined || typeof note.isStarred === "boolean") &&
    (note.deletedAt === undefined ||
      note.deletedAt === null ||
      (typeof note.deletedAt === "number" && Number.isFinite(note.deletedAt)))
  );
}

function isValidFolder(value: unknown): value is NoteFolder {
  if (!value || typeof value !== "object") {
    return false;
  }

  const folder = value as Partial<NoteFolder>;
  return (
    typeof folder.id === "string" &&
    Boolean(folder.id) &&
    typeof folder.name === "string" &&
    Boolean(folder.name.trim()) &&
    typeof folder.createdAt === "number" &&
    Number.isFinite(folder.createdAt)
  );
}

export function createNoteDocument(
  markdown = "",
  now = Date.now(),
  normalOrder = 0,
  folderId: string | null = null,
  isStarred = false,
): NoteDocument {
  return {
    id: createNoteId(now),
    markdown,
    createdAt: now,
    updatedAt: now,
    normalOrder,
    pinnedAt: null,
    folderId,
    isStarred,
    deletedAt: null,
  };
}

export function createNoteFolder(
  name: string,
  now = Date.now(),
): NoteFolder {
  return {
    id: createFolderId(now),
    name: name.trim(),
    createdAt: now,
  };
}

export function isNotePinned(note: NoteDocument): boolean {
  return note.pinnedAt !== null;
}

export function isNoteDeleted(note: NoteDocument): boolean {
  return note.deletedAt !== null;
}

export function getFolderCategoryId(folderId: string): NoteCategoryId {
  return `folder:${folderId}`;
}

export function getFolderIdFromCategory(
  categoryId: NoteCategoryId,
): string | null {
  return categoryId.startsWith("folder:")
    ? categoryId.slice("folder:".length)
    : null;
}

export function getCategoryNoteDocuments(
  notes: NoteDocument[],
  categoryId: NoteCategoryId,
): NoteDocument[] {
  if (categoryId === "trash") {
    return notes.filter(isNoteDeleted);
  }

  const liveNotes = notes.filter((note) => !isNoteDeleted(note));

  if (categoryId === "all") {
    return liveNotes;
  }

  if (categoryId === "starred") {
    return liveNotes.filter((note) => note.isStarred);
  }

  const folderId = getFolderIdFromCategory(categoryId);
  return liveNotes.filter((note) => note.folderId === folderId);
}

export function getNoteDocumentById(
  notes: NoteDocument[],
  noteId: string,
): NoteDocument | null {
  return notes.find((note) => note.id === noteId) ?? null;
}

export function toggleNoteStarred(
  notes: NoteDocument[],
  noteId: string,
): NoteDocument[] {
  return notes.map((note) =>
    note.id === noteId && !isNoteDeleted(note)
      ? {
          ...note,
          isStarred: !note.isStarred,
        }
      : note,
  );
}

export function moveNoteToTrash(
  notes: NoteDocument[],
  noteId: string,
  now = Date.now(),
): NoteDocument[] {
  return notes.map((note) =>
    note.id === noteId && !isNoteDeleted(note)
      ? {
          ...note,
          deletedAt: now,
          pinnedAt: null,
        }
      : note,
  );
}

export function restoreNoteFromTrash(
  notes: NoteDocument[],
  noteId: string,
): NoteDocument[] {
  return notes.map((note) =>
    note.id === noteId && isNoteDeleted(note)
      ? {
          ...note,
          deletedAt: null,
          pinnedAt: null,
        }
      : note,
  );
}

export function moveNoteToFolder(
  notes: NoteDocument[],
  noteId: string,
  folderId: string | null,
): NoteDocument[] {
  return notes.map((note) =>
    note.id === noteId && !isNoteDeleted(note)
      ? {
          ...note,
          folderId,
        }
      : note,
  );
}

export function orderNoteDocuments(notes: NoteDocument[]): NoteDocument[] {
  return notes
    .map((note, index) => ({ index, note }))
    .sort((left, right) => {
      const leftPinned = isNotePinned(left.note);
      const rightPinned = isNotePinned(right.note);

      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }

      if (leftPinned && rightPinned) {
        const pinnedDifference =
          (right.note.pinnedAt ?? 0) - (left.note.pinnedAt ?? 0);

        if (pinnedDifference !== 0) {
          return pinnedDifference;
        }
      } else {
        const normalDifference = left.note.normalOrder - right.note.normalOrder;

        if (normalDifference !== 0) {
          return normalDifference;
        }
      }

      return left.index - right.index;
    })
    .map(({ note }) => note);
}

export function discardEmptyNoteDraft(
  notes: NoteDocument[],
  noteId: string,
  preferredNextNoteId?: string,
): { activeNote: NoteDocument; notes: NoteDocument[] } | null {
  const draft = notes.find((note) => note.id === noteId);

  if (!draft || isNoteDeleted(draft) || draft.markdown.trim()) {
    return null;
  }

  const remainingNotes = notes.filter((note) => note.id !== noteId);
  const remainingLiveNotes = orderNoteDocuments(
    remainingNotes.filter((note) => !isNoteDeleted(note)),
  );

  if (remainingLiveNotes.length === 0) {
    return null;
  }

  const activeNote =
    remainingLiveNotes.find((note) => note.id === preferredNextNoteId) ??
    remainingLiveNotes[0];

  return {
    activeNote,
    notes: remainingNotes,
  };
}

export function toggleNotePinned(
  notes: NoteDocument[],
  noteId: string,
  now = Date.now(),
): NoteDocument[] {
  const target = notes.find((note) => note.id === noteId);

  if (!target || isNoteDeleted(target)) {
    return notes;
  }

  if (isNotePinned(target)) {
    return notes.map((note) =>
      note.id === noteId
        ? {
            ...note,
            pinnedAt: null,
          }
        : note,
    );
  }

  const newestPinnedAt = notes.reduce(
    (latest, note) => Math.max(latest, note.pinnedAt ?? 0),
    0,
  );
  const nextPinnedAt = Math.max(now, newestPinnedAt + 1);

  return notes.map((note) =>
    note.id === noteId
      ? {
          ...note,
          pinnedAt: nextPinnedAt,
        }
      : note,
  );
}

export function reorderNormalNoteDocuments(
  notes: NoteDocument[],
  activeNoteId: string,
  overNoteId: string,
): NoteDocument[] {
  if (activeNoteId === overNoteId) {
    return notes;
  }

  const normalNotes = orderNoteDocuments(notes).filter(
    (note) => !isNotePinned(note),
  );
  const activeIndex = normalNotes.findIndex((note) => note.id === activeNoteId);
  const overIndex = normalNotes.findIndex((note) => note.id === overNoteId);

  if (activeIndex < 0 || overIndex < 0) {
    return notes;
  }

  const reorderedNotes = [...normalNotes];
  const [activeNote] = reorderedNotes.splice(activeIndex, 1);
  reorderedNotes.splice(overIndex, 0, activeNote);

  const availableOrders = normalNotes
    .map((note) => note.normalOrder)
    .sort((left, right) => left - right);
  const nextOrderById = new Map(
    reorderedNotes.map((note, index) => [note.id, availableOrders[index]]),
  );

  return notes.map((note) => {
    const nextOrder = nextOrderById.get(note.id);

    if (nextOrder === undefined || nextOrder === note.normalOrder) {
      return note;
    }

    return {
      ...note,
      normalOrder: nextOrder,
    };
  });
}

export function getNoteTitle(markdown: string): string {
  const [firstLine] = getMeaningfulLines(markdown);
  return truncate(firstLine || "新便签", NOTE_TITLE_MAX_LENGTH);
}

export function getNoteListTitle(markdown: string): string {
  const firstLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        Boolean(line) && !/^!\[[^\]]*\]\([^)]*\)$/.test(line),
    );

  return firstLine || "新便签";
}

export function getNotePreview(markdown: string): string {
  const lines = getMeaningfulLines(markdown);
  const previewLines = lines.length > 1 ? lines.slice(1) : lines;
  return truncate(collapseWhitespace(previewLines.join(" ")) || "点击开始记录", NOTE_PREVIEW_MAX_LENGTH);
}

export function parseNoteWorkspace(value: string | null): NoteWorkspace | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<NoteWorkspace>;

    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.notes) ||
      parsed.notes.length === 0 ||
      !parsed.notes.every(isValidNote) ||
      new Set(parsed.notes.map((note) => note.id)).size !== parsed.notes.length
    ) {
      return null;
    }

    const parsedFolders = Array.isArray(parsed.folders)
      ? parsed.folders.filter(isValidFolder)
      : [];
    const normalizedFolders = parsedFolders.filter(
      (folder, index) =>
        parsedFolders.findIndex((candidate) => candidate.id === folder.id) === index,
    );
    const validFolderIds = new Set(normalizedFolders.map((folder) => folder.id));
    const normalizedNotes = parsed.notes.map((note, index) => ({
      ...note,
      normalOrder:
        typeof note.normalOrder === "number" && Number.isFinite(note.normalOrder)
          ? note.normalOrder
          : index,
      pinnedAt:
        typeof note.pinnedAt === "number" && Number.isFinite(note.pinnedAt)
          ? note.pinnedAt
          : null,
      folderId:
        typeof note.folderId === "string" && validFolderIds.has(note.folderId)
          ? note.folderId
          : null,
      isStarred: note.isStarred === true,
      deletedAt:
        typeof note.deletedAt === "number" && Number.isFinite(note.deletedAt)
          ? note.deletedAt
          : null,
    }));
    const activeNoteId =
      typeof parsed.activeNoteId === "string" &&
      normalizedNotes.some((note) => note.id === parsed.activeNoteId)
        ? parsed.activeNoteId
        : normalizedNotes[0].id;

    return {
      activeNoteId,
      folders: normalizedFolders,
      notes: normalizedNotes,
      version: 1,
    };
  } catch {
    return null;
  }
}
