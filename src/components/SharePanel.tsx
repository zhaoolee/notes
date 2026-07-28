interface SharePanelProps {
  copyButtonText: string;
  isArchiving: boolean;
  isCopyingWechat: boolean;
  isExporting: boolean;
  onArchiveDownload: () => void;
  onClose: () => void;
  onCopyMarkdown: () => void;
  onCopyWechat: () => void;
  onExport: () => void;
  wechatButtonText: string;
}

interface ShareActionProps {
  description: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function ShareAction({
  description,
  disabled = false,
  label,
  onClick,
}: ShareActionProps) {
  return (
    <button
      type="button"
      className="share-action"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="share-action-label">{label}</span>
      <span className="share-action-description">{description}</span>
    </button>
  );
}

export function SharePanel({
  copyButtonText,
  isArchiving,
  isCopyingWechat,
  isExporting,
  onArchiveDownload,
  onClose,
  onCopyMarkdown,
  onCopyWechat,
  onExport,
  wechatButtonText,
}: SharePanelProps) {
  return (
    <>
      <button
        type="button"
        className="share-panel-backdrop"
        aria-label="关闭分享面板"
        onClick={onClose}
      />
      <div
        id="app-share-panel"
        className="share-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-share-title"
      >
        <header className="share-panel-header">
          <h2 id="app-share-title">分享与导出</h2>
          <button
            type="button"
            className="share-panel-close"
            aria-label="关闭分享面板"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="share-actions">
          <ShareAction
            label={isExporting ? "正在存图..." : "保存为图片"}
            description="导出当前便签长图"
            disabled={isExporting}
            onClick={onExport}
          />
          <ShareAction
            label={copyButtonText}
            description="复制当前 Markdown 源文本"
            onClick={onCopyMarkdown}
          />
          <ShareAction
            label={wechatButtonText}
            description="上传图片并复制微信公众号富文本"
            disabled={isCopyingWechat}
            onClick={onCopyWechat}
          />
          <ShareAction
            label={isArchiving ? "归档中..." : "下载归档"}
            description="下载 Markdown、HTML、图片和字体"
            disabled={isArchiving}
            onClick={onArchiveDownload}
          />
        </div>
      </div>
    </>
  );
}
