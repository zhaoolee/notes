import { useState } from "react";
import type { NoteFolder } from "../types/app";

interface MoveNoteDialogProps {
  currentFolderId: string | null;
  folders: NoteFolder[];
  onClose: () => void;
  onCreateFolder: (name: string) => string | null;
  onMove: (folderId: string | null) => void;
}

export function MoveNoteDialog({
  currentFolderId,
  folders,
  onClose,
  onCreateFolder,
  onMove,
}: MoveNoteDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState(currentFolderId ?? "");
  const [newFolderName, setNewFolderName] = useState("");

  function handleCreateFolder() {
    const folderId = onCreateFolder(newFolderName);

    if (!folderId) {
      return;
    }

    setSelectedFolderId(folderId);
    setNewFolderName("");
  }

  return (
    <div className="move-note-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="move-note-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-note-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="move-note-dialog-header">
          <h2 id="move-note-dialog-title">转移至其他文件夹</h2>
          <button type="button" aria-label="关闭转移便签窗口" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="move-note-dialog-body">
          <label className="move-note-folder-option">
            <input
              type="radio"
              name="move-note-folder"
              value=""
              checked={selectedFolderId === ""}
              onChange={() => setSelectedFolderId("")}
            />
            <span className="move-note-folder-icon" aria-hidden="true" />
            <span>全部便签</span>
          </label>

          {folders.map((folder) => (
            <label className="move-note-folder-option" key={folder.id}>
              <input
                type="radio"
                name="move-note-folder"
                value={folder.id}
                checked={selectedFolderId === folder.id}
                onChange={() => setSelectedFolderId(folder.id)}
              />
              <span className="move-note-folder-icon" aria-hidden="true" />
              <span>{folder.name}</span>
            </label>
          ))}

          <div className="move-note-new-folder">
            <input
              type="text"
              value={newFolderName}
              placeholder="新建文件夹"
              aria-label="新文件夹名称"
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleCreateFolder();
                }
              }}
            />
            <button
              type="button"
              disabled={!newFolderName.trim()}
              onClick={handleCreateFolder}
            >
              新建
            </button>
          </div>
        </div>

        <footer className="move-note-dialog-actions">
          <button type="button" className="move-note-cancel" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="move-note-confirm"
            onClick={() => {
              onMove(selectedFolderId || null);
              onClose();
            }}
          >
            转移
          </button>
        </footer>
      </section>
    </div>
  );
}
