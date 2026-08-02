import { useId } from "react";

export interface ConfirmDialogAction {
  confirmLabel: string;
  description: string;
  title: string;
}

interface ConfirmDialogProps {
  pendingAction: ConfirmDialogAction | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  pendingAction,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();

  if (!pendingAction) {
    return null;
  }

  return (
    <div className="confirm-dialog-backdrop" onClick={onClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId}>{pendingAction.title}</h3>
        <p>{pendingAction.description}</p>
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" onClick={onConfirm}>
            {pendingAction.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
