import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState, type CSSProperties } from "react";
import {
  getNoteListTitle,
  getNoteTitle,
  isNotePinned,
  orderNoteDocuments,
} from "../lib/notes.js";
import type { NoteDocument } from "../types/app.js";

interface NoteSidebarProps {
  activeNoteId: string;
  categoryLabel: string;
  isTrashView: boolean;
  isOpen: boolean;
  isDesktopCategoryCollapsed: boolean;
  notes: NoteDocument[];
  searchQuery: string;
  onClose: () => void;
  onCreateNote: () => void;
  onPermanentlyDeleteNote: (noteId: string) => void;
  onReorderNotes: (activeNoteId: string, overNoteId: string) => void;
  onRestoreNote: (noteId: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectNote: (noteId: string) => void;
  onTogglePinned: (noteId: string) => void;
  onToggleStarred: (noteId: string) => void;
  onToggleDesktopCategory: () => void;
}

function formatUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function hasMarkdownImage(markdown: string): boolean {
  return /!\[[^\]]*\]\([^)]+\)|<img\b/i.test(markdown);
}

interface SortableNoteListItemProps {
  activeNoteId: string;
  isDragDisabled: boolean;
  isTrashView: boolean;
  note: NoteDocument;
  onPermanentlyDeleteNote: (noteId: string) => void;
  onRestoreNote: (noteId: string) => void;
  onSelectNote: (noteId: string) => void;
  onTogglePinned: (noteId: string) => void;
  onToggleStarred: (noteId: string) => void;
}

function SortableNoteListItem({
  activeNoteId,
  isDragDisabled,
  isTrashView,
  note,
  onPermanentlyDeleteNote,
  onRestoreNote,
  onSelectNote,
  onTogglePinned,
  onToggleStarred,
}: SortableNoteListItemProps) {
  const pinned = isNotePinned(note);
  const includesImage = hasMarkdownImage(note.markdown);
  const isActive = note.id === activeNoteId;
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: note.id,
    disabled: pinned || isDragDisabled || isTrashView,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } satisfies CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`note-list-item${isActive ? " active" : ""}${
        includesImage ? " has-image" : ""
      }${pinned ? " is-pinned" : " is-sortable"}${
        isDragging ? " is-dragging" : ""
      }`}
      role="listitem"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="note-list-select"
        aria-current={isActive ? "page" : undefined}
        onClick={() => onSelectNote(note.id)}
        {...attributes}
        {...listeners}
      >
        <span className="note-list-meta">
          <span>{formatUpdatedAt(note.updatedAt)}</span>
        </span>
        <strong>{getNoteListTitle(note.markdown)}</strong>
      </button>
      {!isTrashView ? (
        <>
          <button
            type="button"
            className="note-list-pin"
            aria-label={
              pinned
                ? `取消置顶：${getNoteTitle(note.markdown)}`
                : `置顶便签：${getNoteTitle(note.markdown)}`
            }
            aria-pressed={pinned}
            title={pinned ? "取消置顶" : "置顶便签"}
            onClick={() => onTogglePinned(note.id)}
          >
            <img
              src={
                pinned
                  ? "/smartisan/mobile/icon_top_checked.png"
                  : "/smartisan/mobile/icon_top_normal.png"
              }
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          </button>
          <button
            type="button"
            className={`note-list-star${note.isStarred ? " is-starred" : ""}`}
            aria-label={
              note.isStarred
                ? `取消加星：${getNoteTitle(note.markdown)}`
                : `加星便签：${getNoteTitle(note.markdown)}`
            }
            aria-pressed={note.isStarred}
            title={note.isStarred ? "取消加星" : "加星便签"}
            onClick={() => onToggleStarred(note.id)}
          >
            <span aria-hidden="true" />
          </button>
        </>
      ) : null}
      {includesImage ? (
        <span
          className="note-list-image-indicator"
          aria-hidden="true"
        />
      ) : null}
      {isTrashView ? (
        <div className="note-list-trash-actions">
          <button
            type="button"
            className="note-list-restore"
            aria-label={`恢复便签：${getNoteTitle(note.markdown)}`}
            onClick={() => onRestoreNote(note.id)}
          >
            恢复
          </button>
          <button
            type="button"
            className="note-list-permanent-delete"
            aria-label={`永久删除：${getNoteTitle(note.markdown)}`}
            onClick={() => onPermanentlyDeleteNote(note.id)}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function NoteSidebar({
  activeNoteId,
  categoryLabel,
  isTrashView,
  isOpen,
  isDesktopCategoryCollapsed,
  notes,
  searchQuery,
  onClose,
  onCreateNote,
  onPermanentlyDeleteNote,
  onReorderNotes,
  onRestoreNote,
  onSearchQueryChange,
  onSelectNote,
  onTogglePinned,
  onToggleStarred,
  onToggleDesktopCategory,
}: NoteSidebarProps) {
  const [isDragging, setIsDragging] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 500,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const orderedNotes = useMemo(() => orderNoteDocuments(notes), [notes]);
  const filteredNotes = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

    if (!normalizedQuery) {
      return orderedNotes;
    }

    return orderedNotes.filter((note) =>
      `${getNoteTitle(note.markdown)} ${note.markdown}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [orderedNotes, searchQuery]);
  const normalNoteIds = useMemo(
    () =>
      filteredNotes
        .filter((note) => !isTrashView && !isNotePinned(note))
        .map((note) => note.id),
    [filteredNotes, isTrashView],
  );
  const isSearchActive = Boolean(searchQuery.trim());

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setIsDragging(false);

    if (!over || active.id === over.id || isSearchActive || isTrashView) {
      return;
    }

    onReorderNotes(String(active.id), String(over.id));
  }

  return (
    <nav
      id="note-sidebar"
      className={`note-sidebar${isOpen ? " is-open" : ""}`}
      aria-label="便签导航"
    >
      <div className="note-sidebar-header">
        <div>
          <p className="note-sidebar-eyebrow">NOTES</p>
          <h2>{categoryLabel}</h2>
        </div>
        <div className="note-sidebar-header-actions">
          <button
            type="button"
            className="note-sidebar-create"
            aria-label="新建便签"
            title="新建便签"
            onClick={onCreateNote}
          >
            <span className="note-sidebar-create-glyph" aria-hidden="true">
              ＋
            </span>
          </button>
          <button
            type="button"
            className="note-sidebar-close"
            aria-label="关闭便签导航"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      <label className="note-search">
        <span className="note-search-icon" aria-hidden="true" />
        <span className="visually-hidden">搜索便签</span>
        <input
          type="search"
          value={searchQuery}
          placeholder="搜索便签"
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </label>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setIsDragging(true)}
        onDragCancel={() => setIsDragging(false)}
        onDragEnd={handleDragEnd}
      >
        <div
          className={`note-list${isDragging ? " is-dragging" : ""}`}
          role="list"
        >
          {filteredNotes.length ? (
            <>
              <div className="note-list-clip-rail" aria-hidden="true">
                {filteredNotes.map((note) => (
                  <img
                    key={`clip-${note.id}`}
                    className="note-list-clip"
                    src="/smartisan/mobile/note_item_clip_normal.png"
                    alt=""
                    draggable={false}
                  />
                ))}
              </div>
              <SortableContext
                items={normalNoteIds}
                strategy={verticalListSortingStrategy}
              >
                {filteredNotes.map((note) => (
                  <SortableNoteListItem
                    key={note.id}
                    activeNoteId={activeNoteId}
                    isDragDisabled={isSearchActive}
                    isTrashView={isTrashView}
                    note={note}
                    onPermanentlyDeleteNote={onPermanentlyDeleteNote}
                    onRestoreNote={onRestoreNote}
                    onSelectNote={onSelectNote}
                    onTogglePinned={onTogglePinned}
                    onToggleStarred={onToggleStarred}
                  />
                ))}
              </SortableContext>
            </>
          ) : (
            <div className="note-list-empty">
              <p>
                {isTrashView && !isSearchActive
                  ? "回收站为空"
                  : isSearchActive
                    ? "没有匹配的便签"
                    : "这个分类还没有便签"}
              </p>
              {isSearchActive ? (
                <button type="button" onClick={() => onSearchQueryChange("")}>
                  清除搜索
                </button>
              ) : null}
            </div>
          )}
        </div>
      </DndContext>

      <div className="note-sidebar-bottom-menu">
        <button
          type="button"
          className={`note-column-toggle${
            isDesktopCategoryCollapsed ? " is-collapsed" : ""
          }`}
          aria-label={
            isDesktopCategoryCollapsed ? "展开分类栏" : "收起分类栏"
          }
          aria-pressed={isDesktopCategoryCollapsed}
          onClick={onToggleDesktopCategory}
        />
      </div>
    </nav>
  );
}
