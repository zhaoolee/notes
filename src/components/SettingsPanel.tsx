import type { ThemeId } from "../types/app.js";
import { ThemeSelector } from "./ThemeSelector.js";

interface SettingsPanelProps {
  copyButtonText: string;
  isArchiving: boolean;
  isImportingImage: boolean;
  selectedTheme: ThemeId;
  onArchiveDownload: () => void;
  onClearMarkdown: () => void;
  onClose: () => void;
  onCopyMarkdown: () => void;
  onInsertImage: () => void;
  onLoadExample: () => void;
  onThemeChange: (themeId: ThemeId) => void;
}

interface SettingsActionProps {
  description: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function SettingsAction({
  description,
  disabled = false,
  label,
  onClick,
}: SettingsActionProps) {
  return (
    <button
      type="button"
      className="settings-action"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="settings-action-label">{label}</span>
      <span className="settings-action-description">{description}</span>
    </button>
  );
}

export function SettingsPanel({
  copyButtonText,
  isArchiving,
  isImportingImage,
  selectedTheme,
  onArchiveDownload,
  onClearMarkdown,
  onClose,
  onCopyMarkdown,
  onInsertImage,
  onLoadExample,
  onThemeChange,
}: SettingsPanelProps) {
  return (
    <div
      id="app-settings-panel"
      className="settings-panel"
      role="dialog"
      aria-labelledby="app-settings-title"
    >
      <div className="settings-panel-header">
        <div>
          <p className="settings-panel-eyebrow">Preferences</p>
          <h2 id="app-settings-title">设置</h2>
        </div>
        <button
          type="button"
          className="settings-close"
          aria-label="关闭设置"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <section className="settings-section" aria-labelledby="settings-theme-title">
        <h3 id="settings-theme-title">便签主题</h3>
        <ThemeSelector value={selectedTheme} onChange={onThemeChange} />
      </section>

      <section className="settings-section" aria-labelledby="settings-content-title">
        <h3 id="settings-content-title">内容</h3>
        <div className="settings-actions">
          <SettingsAction
            label="新建空白便签"
            description="清空当前草稿并重新开始"
            onClick={onClearMarkdown}
          />
          <SettingsAction
            label={isImportingImage ? "正在导入图片..." : "插入图片"}
            description="从本地选择图片并插入光标位置"
            disabled={isImportingImage}
            onClick={onInsertImage}
          />
          <SettingsAction
            label="加载示例"
            description="使用内置 Markdown 示例覆盖草稿"
            onClick={onLoadExample}
          />
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-share-title">
        <h3 id="settings-share-title">分享与归档</h3>
        <div className="settings-actions">
          <SettingsAction
            label={isArchiving ? "归档中..." : "下载归档"}
            description="下载 Markdown、HTML、图片和字体"
            disabled={isArchiving}
            onClick={onArchiveDownload}
          />
          <SettingsAction
            label={copyButtonText}
            description="复制当前 Markdown 源文本"
            onClick={onCopyMarkdown}
          />
        </div>
      </section>
    </div>
  );
}
