import type { PendingAction } from "../types/app";

interface ConfirmDialogProps {
  pendingAction: PendingAction | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  pendingAction,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  if (!pendingAction) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="confirm-dialog-title">{pendingAction.title}</h3>
        <p>{pendingAction.description}</p>
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            确认覆盖
          </button>
        </div>
      </div>
    </div>
  );
}
