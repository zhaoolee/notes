import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  getMobileNoteSwipeAxis,
  getMobileNoteSwipeOffset,
  MOBILE_NOTE_SWIPE_OPEN_OFFSET,
  shouldOpenMobileNoteSwipe,
  type MobileNoteSwipeAxis,
} from "../lib/mobile-note-swipe.js";
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
  onDeleteNote: (noteId: string) => void;
  onPermanentlyDeleteNote: (noteId: string) => void;
  onReorderNotes: (activeNoteId: string, overNoteId: string) => void;
  onRestoreNote: (noteId: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectNote: (noteId: string) => void;
  onTogglePinned: (noteId: string) => void;
  onToggleStarred: (noteId: string) => void;
  onToggleDesktopCategory: () => void;
}

const MOBILE_NOTE_DRAG_DELAY_MS = 220;
const MOBILE_NOTE_DRAG_TOLERANCE_PX = 12;

const restrictNoteDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

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

function NoteDragOverlay({ note }: { note: NoteDocument }) {
  const includesImage = hasMarkdownImage(note.markdown);

  return (
    <div
      className={`note-list-item note-list-drag-overlay is-dragging${
        includesImage ? " has-image" : ""
      }`}
      aria-hidden="true"
    >
      <div className="note-list-card">
        <div className="note-list-select">
          <span className="note-list-meta">
            <span>{formatUpdatedAt(note.updatedAt)}</span>
          </span>
          <strong>{getNoteListTitle(note.markdown)}</strong>
        </div>
        <span className="note-list-pin">
          <img
            src="/smartisan/mobile/icon_top_normal.png"
            alt=""
            draggable={false}
          />
        </span>
        <span
          className={`note-list-star${note.isStarred ? " is-starred" : ""}`}
        />
        {includesImage ? (
          <span className="note-list-image-indicator" />
        ) : null}
      </div>
    </div>
  );
}

interface SortableNoteListItemProps {
  activeNoteId: string;
  isDragDisabled: boolean;
  isSwipeOpen: boolean;
  isTrashView: boolean;
  note: NoteDocument;
  onDeleteNote: (noteId: string) => void;
  onPermanentlyDeleteNote: (noteId: string) => void;
  onRestoreNote: (noteId: string) => void;
  onSelectNote: (noteId: string) => void;
  onSwipeClose: () => void;
  onSwipeOpen: () => void;
  onTogglePinned: (noteId: string) => void;
  onToggleStarred: (noteId: string) => void;
}

interface SwipeGesture {
  axis: MobileNoteSwipeAxis;
  pointerId: number;
  startOffset: number;
  startX: number;
  startY: number;
}

function SortableNoteListItem({
  activeNoteId,
  isDragDisabled,
  isSwipeOpen,
  isTrashView,
  note,
  onDeleteNote,
  onPermanentlyDeleteNote,
  onRestoreNote,
  onSelectNote,
  onSwipeClose,
  onSwipeOpen,
  onTogglePinned,
  onToggleStarred,
}: SortableNoteListItemProps) {
  const pinned = isNotePinned(note);
  const isSortable = !pinned && !isDragDisabled && !isTrashView;
  const includesImage = hasMarkdownImage(note.markdown);
  const isActive = note.id === activeNoteId;
  const [swipeOffset, setSwipeOffset] = useState(
    isSwipeOpen ? MOBILE_NOTE_SWIPE_OPEN_OFFSET : 0,
  );
  const [isSwipeTracking, setIsSwipeTracking] = useState(false);
  const swipeGestureRef = useRef<SwipeGesture | null>(null);
  const swipeOffsetRef = useRef(swipeOffset);
  const suppressClickUntilRef = useRef(0);
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
    disabled: !isSortable,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } satisfies CSSProperties;
  const swipeStyle = {
    "--note-swipe-offset": `${swipeOffset}px`,
  } as CSSProperties;

  function updateSwipeOffset(nextOffset: number) {
    swipeOffsetRef.current = nextOffset;
    setSwipeOffset(nextOffset);
  }

  useEffect(() => {
    if (swipeGestureRef.current) {
      return;
    }

    updateSwipeOffset(isSwipeOpen ? MOBILE_NOTE_SWIPE_OPEN_OFFSET : 0);
  }, [isSwipeOpen]);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    swipeGestureRef.current = null;
    setIsSwipeTracking(false);
    updateSwipeOffset(0);
  }, [isDragging]);

  function canStartSwipe(event: ReactPointerEvent<HTMLDivElement>): boolean {
    return (
      !isTrashView &&
      event.isPrimary &&
      (event.pointerType === "touch" || event.pointerType === "pen") &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 640px)").matches &&
      !(event.target as HTMLElement).closest(
        ".note-list-pin, .note-list-star",
      )
    );
  }

  function handleSwipePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canStartSwipe(event)) {
      return;
    }

    swipeGestureRef.current = {
      axis: "pending",
      pointerId: event.pointerId,
      startOffset: swipeOffsetRef.current,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handleSwipePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeGestureRef.current;

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (gesture.axis === "pending") {
      gesture.axis = getMobileNoteSwipeAxis(deltaX, deltaY);

      if (gesture.axis === "horizontal") {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        setIsSwipeTracking(true);
      }
    }

    if (gesture.axis !== "horizontal") {
      return;
    }

    event.preventDefault();
    updateSwipeOffset(
      getMobileNoteSwipeOffset(gesture.startOffset, deltaX),
    );
  }

  function settleSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = swipeGestureRef.current;

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    swipeGestureRef.current = null;
    setIsSwipeTracking(false);

    if (gesture.axis !== "horizontal") {
      return;
    }

    const shouldOpen = shouldOpenMobileNoteSwipe(swipeOffsetRef.current);
    updateSwipeOffset(shouldOpen ? MOBILE_NOTE_SWIPE_OPEN_OFFSET : 0);
    suppressClickUntilRef.current = Date.now() + 350;

    if (shouldOpen) {
      onSwipeOpen();
    } else {
      onSwipeClose();
    }
  }

  function handleSelectClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      return;
    }

    if (isSwipeOpen) {
      event.preventDefault();
      onSwipeClose();
      return;
    }

    onSelectNote(note.id);
  }

  function suppressMobileDragPreview(
    event: ReactMouseEvent<HTMLDivElement>,
  ) {
    if (
      !isSortable ||
      typeof window === "undefined" ||
      !window.matchMedia("(max-width: 640px)").matches
    ) {
      return;
    }

    event.preventDefault();
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-note-id={note.id}
      className={`note-list-item${isActive ? " active" : ""}${
        includesImage ? " has-image" : ""
      }${pinned ? " is-pinned" : isSortable ? " is-sortable" : " is-drag-disabled"}${
        isDragging ? " is-dragging" : ""
      }${isSwipeOpen ? " is-swipe-open" : ""}${
        isSwipeTracking ? " is-swipe-tracking" : ""
      }`}
      role="listitem"
    >
      {!isTrashView ? (
        <button
          type="button"
          className="note-list-swipe-delete"
          aria-hidden={!isSwipeOpen}
          aria-label={`删除便签：${getNoteTitle(note.markdown)}`}
          tabIndex={isSwipeOpen ? 0 : -1}
          onClick={() => {
            onSwipeClose();
            onDeleteNote(note.id);
          }}
        />
      ) : null}
      <div
        className="note-list-card"
        style={swipeStyle}
        onContextMenu={suppressMobileDragPreview}
        onPointerCancel={settleSwipe}
        onPointerDown={handleSwipePointerDown}
        onPointerMove={handleSwipePointerMove}
        onPointerUp={settleSwipe}
      >
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="note-list-select"
          aria-current={isActive ? "page" : undefined}
          onClick={handleSelectClick}
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
  onDeleteNote,
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
  const [activeDragNoteId, setActiveDragNoteId] = useState<string | null>(null);
  const [openSwipeNoteId, setOpenSwipeNoteId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: MOBILE_NOTE_DRAG_DELAY_MS,
        tolerance: MOBILE_NOTE_DRAG_TOLERANCE_PX,
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
  const activeDragNote = activeDragNoteId
    ? filteredNotes.find((note) => note.id === activeDragNoteId) ?? null
    : null;

  useEffect(() => {
    if (
      openSwipeNoteId &&
      !filteredNotes.some((note) => note.id === openSwipeNoteId)
    ) {
      setOpenSwipeNoteId(null);
    }
  }, [filteredNotes, openSwipeNoteId]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setIsDragging(false);
    setActiveDragNoteId(null);

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
        modifiers={[restrictNoteDragToVerticalAxis]}
        onDragStart={({ active }) => {
          window.getSelection()?.removeAllRanges();
          setOpenSwipeNoteId(null);
          setActiveDragNoteId(String(active.id));
          setIsDragging(true);
        }}
        onDragCancel={() => {
          setActiveDragNoteId(null);
          setIsDragging(false);
        }}
        onDragEnd={handleDragEnd}
      >
        <div
          className={`note-list${isDragging ? " is-dragging" : ""}`}
          role="list"
          onPointerDownCapture={(event) => {
            if (!openSwipeNoteId) {
              return;
            }

            const row = (event.target as HTMLElement).closest(
              ".note-list-item",
            );

            if (row?.getAttribute("data-note-id") !== openSwipeNoteId) {
              setOpenSwipeNoteId(null);
            }
          }}
          onScroll={() => setOpenSwipeNoteId(null)}
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
                    isSwipeOpen={openSwipeNoteId === note.id}
                    isTrashView={isTrashView}
                    note={note}
                    onDeleteNote={onDeleteNote}
                    onPermanentlyDeleteNote={onPermanentlyDeleteNote}
                    onRestoreNote={onRestoreNote}
                    onSelectNote={onSelectNote}
                    onSwipeClose={() =>
                      setOpenSwipeNoteId((currentNoteId) =>
                        currentNoteId === note.id ? null : currentNoteId,
                      )
                    }
                    onSwipeOpen={() => setOpenSwipeNoteId(note.id)}
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
        <DragOverlay
          adjustScale={false}
          dropAnimation={null}
          modifiers={[restrictNoteDragToVerticalAxis]}
          zIndex={100}
        >
          {activeDragNote ? <NoteDragOverlay note={activeDragNote} /> : null}
        </DragOverlay>
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
