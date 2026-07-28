import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  getCategoryNoteDocuments,
  getFolderCategoryId,
} from "../lib/notes.js";
import type {
  NoteCategoryId,
  NoteDocument,
  NoteFolder,
} from "../types/app.js";

interface CategorySidebarProps {
  activeCategoryId: NoteCategoryId;
  folders: NoteFolder[];
  isOpen: boolean;
  notes: NoteDocument[];
  searchQuery: string;
  onCategorySelect: (categoryId: NoteCategoryId) => void;
  onClose: () => void;
  onCreateFolder: (name: string) => string | null;
  onDeleteFolder: (folderId: string) => void;
  onSearchQueryChange: (query: string) => void;
}

interface CategoryRowProps {
  active: boolean;
  count: number;
  icon: "all" | "folder" | "starred" | "trash";
  label: string;
  onClick: () => void;
  onDelete?: () => void;
}

function CategoryRow({
  active,
  count,
  icon,
  label,
  onClick,
  onDelete,
}: CategoryRowProps) {
  return (
    <li
      className={`category-row${active ? " active" : ""}${
        onDelete ? " has-delete" : ""
      }`}
    >
      <button
        type="button"
        className="category-row-select"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
      >
        <span
          className={`category-row-icon category-row-icon-${icon}`}
          aria-hidden="true"
        />
        <span className="category-row-label">{label}</span>
        <span className="category-row-count" aria-label={`${count} 张便签`}>
          {count}
        </span>
      </button>
      {onDelete ? (
        <button
          type="button"
          className="category-row-delete"
          aria-label={`删除文件夹：${label}`}
          title="删除文件夹（便签会保留在全部便签中）"
          onClick={onDelete}
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

export function CategorySidebar({
  activeCategoryId,
  folders,
  isOpen,
  notes,
  searchQuery,
  onCategorySelect,
  onClose,
  onCreateFolder,
  onDeleteFolder,
  onSearchQueryChange,
}: CategorySidebarProps) {
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isEditingFolders, setIsEditingFolders] = useState(false);
  const [folderSortDirection, setFolderSortDirection] = useState<"asc" | "desc">(
    "asc",
  );
  const [folderName, setFolderName] = useState("");
  const categoryCounts = useMemo(
    () => ({
      all: getCategoryNoteDocuments(notes, "all").length,
      starred: getCategoryNoteDocuments(notes, "starred").length,
      trash: getCategoryNoteDocuments(notes, "trash").length,
    }),
    [notes],
  );
  const orderedFolders = useMemo(
    () =>
      [...folders].sort((leftFolder, rightFolder) => {
        const result = leftFolder.name.localeCompare(rightFolder.name, "zh-CN");
        return folderSortDirection === "asc" ? result : -result;
      }),
    [folderSortDirection, folders],
  );

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setFolderName("");
    setIsCreatingFolder(false);
    setIsEditingFolders(false);
  }, [isOpen]);

  function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const folderId = onCreateFolder(folderName);

    if (!folderId) {
      return;
    }

    setFolderName("");
    setIsCreatingFolder(false);
    onCategorySelect(getFolderCategoryId(folderId));
  }

  return (
    <aside
      id="category-sidebar"
      className={`category-sidebar${isOpen ? " is-open" : ""}${
        isEditingFolders ? " is-editing-folders" : ""
      }`}
      aria-label="便签分类"
    >
      <label className="category-search">
        <span className="category-search-icon" aria-hidden="true" />
        <span className="visually-hidden">搜索便签</span>
        <input
          type="search"
          value={searchQuery}
          placeholder="快速搜索关键字"
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </label>

      <div className="category-section-heading">
        <span className="category-section-chevron" aria-hidden="true">
          ▾
        </span>
        <strong>便签</strong>
        <button
          type="button"
          className="category-folder-create"
          aria-label="新建文件夹"
          title="新建文件夹"
          onClick={() => setIsCreatingFolder(true)}
        >
          ＋
        </button>
        <button
          type="button"
          className="category-sidebar-close"
          aria-label="关闭分类"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {isCreatingFolder ? (
        <form className="category-folder-form" onSubmit={handleCreateFolder}>
          <input
            autoFocus
            maxLength={24}
            value={folderName}
            aria-label="文件夹名称"
            placeholder="文件夹名称"
            onChange={(event) => setFolderName(event.target.value)}
          />
          <button type="submit">确定</button>
          <button
            type="button"
            onClick={() => {
              setFolderName("");
              setIsCreatingFolder(false);
            }}
          >
            取消
          </button>
        </form>
      ) : null}

      <ul className="category-list">
        <CategoryRow
          active={activeCategoryId === "all"}
          count={categoryCounts.all}
          icon="all"
          label="全部便签"
          onClick={() => onCategorySelect("all")}
        />
        <CategoryRow
          active={activeCategoryId === "starred"}
          count={categoryCounts.starred}
          icon="starred"
          label="加星便签"
          onClick={() => onCategorySelect("starred")}
        />
        {orderedFolders.map((folder) => {
          const categoryId = getFolderCategoryId(folder.id);
          return (
            <CategoryRow
              key={folder.id}
              active={activeCategoryId === categoryId}
              count={getCategoryNoteDocuments(notes, categoryId).length}
              icon="folder"
              label={folder.name}
              onClick={() => onCategorySelect(categoryId)}
              onDelete={() => onDeleteFolder(folder.id)}
            />
          );
        })}
        <CategoryRow
          active={activeCategoryId === "trash"}
          count={categoryCounts.trash}
          icon="trash"
          label="回收站"
          onClick={() => onCategorySelect("trash")}
        />
      </ul>

      <div className="category-download-banner">
        <svg
          className="category-download-icon"
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M5 2.5H0V7.5H5V2.5ZM3.33333 4.16667H1.66667V5.83333H3.33333V4.16667ZM0 9.16667H5V10.8333H0V9.16667ZM6.66634 2.5H19.9997V17.5H6.66634V2.5ZM8.33301 4.16667H18.333V15.8333H8.33301V4.16667ZM12.5003 5.83366H14.167V11.3217L15.6626 9.82605L16.8411 11.0046L13.332 14.5137L12.1535 13.3352L12.1551 13.3335L9.83268 11.0111L11.0112 9.83256L12.5003 11.3217V5.83366ZM5 11.6667H3.33333V13.3333H5V11.6667ZM0 12.5H1.66667V14.1667H0V12.5ZM3.33333 15.8333V14.1667L1.66667 14.1667V15.8333H0V17.5H1.66667V15.8333H3.33333ZM3.33333 15.8333V17.5H5V15.8333H3.33333Z"
            fill="currentColor"
          />
        </svg>
        <span>下载锤子便签 APP</span>
      </div>

      <div className="category-popover-footer">
        <button
          type="button"
          className="category-popover-edit"
          aria-pressed={isEditingFolders}
          onClick={() => setIsEditingFolders((isEditing) => !isEditing)}
        >
          {isEditingFolders ? "完成" : "编辑"}
        </button>
        <button
          type="button"
          className="category-popover-sort"
          aria-label={
            folderSortDirection === "asc"
              ? "文件夹按名称倒序"
              : "文件夹按名称正序"
          }
          onClick={() =>
            setFolderSortDirection((direction) =>
              direction === "asc" ? "desc" : "asc",
            )
          }
        >
          A<span aria-hidden="true">{folderSortDirection === "asc" ? "↓" : "↑"}</span>
        </button>
        <button
          type="button"
          className="category-popover-create"
          onClick={() => setIsCreatingFolder(true)}
        >
          新建文件夹
        </button>
      </div>
    </aside>
  );
}
