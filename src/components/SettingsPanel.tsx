import { useRef, useState, type ChangeEvent } from "react";
import {
  DEFAULT_FOOTER_BRAND,
  DEFAULT_FOOTER_LOGO_URL,
  DEFAULT_FOOTER_VIA,
  FOOTER_TEXT_MAX_LENGTH,
} from "../lib/footer.js";
import { importImageFile } from "../lib/images.js";
import { THEME_OPTIONS } from "../lib/themes.js";
import type { ThemeId } from "../types/app.js";

interface SettingsPanelProps {
  aiAvailable?: boolean;
  aiEnabled?: boolean;
  authUsername?: string | null;
  canChangePassword?: boolean;
  cloudStatusLabel?: string;
  footerBrand?: string;
  footerLogoUrl?: string;
  footerVia?: string;
  hermesSkillLinkActionState?:
    | "idle"
    | "copying"
    | "copied"
    | "resetting"
    | "reset";
  isHermesSkillDownloading?: boolean;
  selectedTheme: ThemeId;
  onAiEnabledChange?: (enabled: boolean) => void;
  onChangePassword?: () => void;
  onClose: () => void;
  onFooterBrandChange?: (footerBrand: string) => void;
  onFooterLogoChange?: (footerLogoUrl: string) => void;
  onFooterViaChange?: (footerVia: string) => void;
  onHermesSkillDownload?: () => void;
  onHermesSkillLinkCopy?: () => void;
  onHermesSkillLinkReset?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onThemeChange: (themeId: ThemeId) => void;
}

const SETTINGS_CATEGORIES = [
  { id: "general", label: "常规" },
  { id: "personalization", label: "个性化" },
  { id: "account", label: "账号与同步" },
  { id: "extensions", label: "工具与扩展" },
] as const;

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]["id"];

export function SettingsPanel({
  aiAvailable = false,
  aiEnabled = false,
  authUsername = null,
  canChangePassword = false,
  cloudStatusLabel = "数据仅保存在当前浏览器",
  footerBrand = DEFAULT_FOOTER_BRAND,
  footerLogoUrl = DEFAULT_FOOTER_LOGO_URL,
  footerVia = DEFAULT_FOOTER_VIA,
  hermesSkillLinkActionState = "idle",
  isHermesSkillDownloading = false,
  selectedTheme,
  onAiEnabledChange = () => undefined,
  onChangePassword,
  onClose,
  onFooterBrandChange = () => undefined,
  onFooterLogoChange = () => undefined,
  onFooterViaChange = () => undefined,
  onHermesSkillDownload,
  onHermesSkillLinkCopy,
  onHermesSkillLinkReset,
  onLogin,
  onLogout,
  onThemeChange,
}: SettingsPanelProps) {
  const [category, setCategory] = useState<SettingsCategory>("general");
  const [isFooterLogoUploading, setIsFooterLogoUploading] = useState(false);
  const [footerLogoError, setFooterLogoError] = useState("");
  const footerLogoInputRef = useRef<HTMLInputElement | null>(null);
  const isDefaultFooterLogo = footerLogoUrl === DEFAULT_FOOTER_LOGO_URL;
  const isDefaultFooter =
    footerBrand === DEFAULT_FOOTER_BRAND &&
    isDefaultFooterLogo &&
    footerVia === DEFAULT_FOOTER_VIA;
  const accountInitial =
    authUsername?.trim().charAt(0).toLocaleUpperCase("zh-CN") || "便";

  async function handleFooterLogoFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsFooterLogoUploading(true);
      setFooterLogoError("");
      const imported = await importImageFile(file);
      onFooterLogoChange(imported.path);
    } catch (error) {
      setFooterLogoError(
        error instanceof Error ? error.message : "Logo 上传失败",
      );
    } finally {
      setIsFooterLogoUploading(false);
      input.value = "";
    }
  }

  return (
    <div
      className="settings-modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        id="app-settings-panel"
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        data-settings-category={category}
      >
        <header className="settings-panel-header">
          <h2 id="app-settings-title">设置</h2>
          <button
            type="button"
            className="settings-close"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-category-nav" aria-label="设置分类">
            {SETTINGS_CATEGORIES.map((item) => {
              const isActive = category === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={isActive ? "active" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  aria-controls={`settings-pane-${item.id}`}
                  onClick={() => setCategory(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="settings-content">
            <section
              id="settings-pane-general"
              className="settings-pane"
              aria-labelledby="settings-general-title"
              hidden={category !== "general"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-general-title">常规</h3>
                <p>调整便签的外观和日常使用体验。</p>
              </header>

              <section className="settings-group" aria-label="外观">
                <div className="settings-group-heading">
                  <strong>外观</strong>
                  <small>选择适合当前环境的便签纸张风格。</small>
                </div>
                <div className="settings-card settings-theme-list">
                  {THEME_OPTIONS.map((option) => {
                    const isActive = option.id === selectedTheme;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`settings-theme-row${isActive ? " active" : ""}`}
                        aria-pressed={isActive}
                        onClick={() => onThemeChange(option.id)}
                      >
                        <span
                          className={`settings-theme-swatch settings-theme-swatch-${option.id}`}
                          aria-hidden="true"
                        />
                        <span className="settings-theme-copy">
                          <strong>{option.description}</strong>
                          <span>{option.label}</span>
                        </span>
                        <span className="settings-theme-check" aria-hidden="true">
                          {isActive ? "✓" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {aiAvailable ? (
                <section className="settings-group" aria-label="智能功能">
                  <div className="settings-group-heading">
                    <strong>智能功能</strong>
                  </div>
                  <div className="settings-card">
                    <button
                      type="button"
                      className="settings-row settings-ai-row"
                      role="switch"
                      aria-checked={aiEnabled}
                      aria-label={`AI 辅助审阅，当前${aiEnabled ? "已开启" : "已关闭"}`}
                      onClick={() => onAiEnabledChange(!aiEnabled)}
                    >
                      <span className="settings-row-label">
                        AI 辅助审阅
                        <small>
                          {authUsername
                            ? "逐条确认建议，正文始终由你决定是否修改"
                            : "登录后可逐条确认 AI 提供的修改建议"}
                        </small>
                      </span>
                      <span
                        className={`settings-switch${aiEnabled ? " is-on" : ""}`}
                        aria-hidden="true"
                      >
                        <span />
                      </span>
                    </button>
                  </div>
                </section>
              ) : null}
            </section>

            <section
              id="settings-pane-personalization"
              className="settings-pane"
              aria-labelledby="settings-personalization-title"
              hidden={category !== "personalization"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-personalization-title">个性化</h3>
                <p>定制导出图片和公众号内容中的便签署名。</p>
              </header>

              <div className="settings-footer-page">
                <div
                  className="settings-footer-preview"
                  aria-label="便签底部文字预览"
                >
                  <span className="settings-footer-preview-frame is-outer" />
                  <span className="settings-footer-preview-frame is-inner" />
                  <span className="settings-footer-preview-corner is-top-left" />
                  <span className="settings-footer-preview-corner is-top-right" />
                  <span className="settings-footer-preview-corner is-bottom-left" />
                  <span className="settings-footer-preview-corner is-bottom-right" />
                  <div className="settings-footer-preview-copy">
                    <img
                      className={isDefaultFooterLogo ? "is-default-footer-logo" : undefined}
                      src={footerLogoUrl}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                    />
                    <strong>{footerBrand || "\u00a0"}</strong>
                    <span>{footerVia || "\u00a0"}</span>
                  </div>
                </div>

                <section
                  className="settings-card settings-footer-logo-card"
                  aria-label="便签底部 Logo"
                >
                  <img
                    className={isDefaultFooterLogo ? "is-default-footer-logo" : undefined}
                    src={footerLogoUrl}
                    alt="当前便签底部 Logo"
                    draggable={false}
                  />
                  <span className="settings-footer-logo-copy">
                    <strong>底部 Logo</strong>
                    <small>支持 PNG、JPG、WebP 或 GIF</small>
                  </span>
                  <span className="settings-footer-logo-actions">
                    <input
                      ref={footerLogoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      aria-label="选择便签底部 Logo 图片"
                      hidden
                      onChange={(event) => {
                        void handleFooterLogoFileChange(event);
                      }}
                    />
                    <button
                      type="button"
                      disabled={isFooterLogoUploading}
                      onClick={() => footerLogoInputRef.current?.click()}
                    >
                      {isFooterLogoUploading ? "上传中…" : "上传更换"}
                    </button>
                    <button
                      type="button"
                      disabled={footerLogoUrl === DEFAULT_FOOTER_LOGO_URL}
                      onClick={() => {
                        setFooterLogoError("");
                        onFooterLogoChange(DEFAULT_FOOTER_LOGO_URL);
                      }}
                    >
                      恢复默认
                    </button>
                  </span>
                  {footerLogoError ? (
                    <span className="settings-footer-logo-error" role="alert">
                      {footerLogoError}
                    </span>
                  ) : null}
                </section>

                <section
                  className="settings-card settings-footer-fields"
                  aria-label="编辑便签底部文字"
                >
                  <label className="settings-footer-field">
                    <span className="settings-footer-field-heading">
                      <strong>发送来源</strong>
                      <small>{footerBrand.length}/{FOOTER_TEXT_MAX_LENGTH}</small>
                    </span>
                    <input
                      type="text"
                      value={footerBrand}
                      maxLength={FOOTER_TEXT_MAX_LENGTH}
                      aria-label="便签底部发送来源"
                      placeholder={DEFAULT_FOOTER_BRAND}
                      onChange={(event) =>
                        onFooterBrandChange(event.target.value)
                      }
                    />
                  </label>
                  <label className="settings-footer-field">
                    <span className="settings-footer-field-heading">
                      <strong>via 文本</strong>
                      <small>{footerVia.length}/{FOOTER_TEXT_MAX_LENGTH}</small>
                    </span>
                    <input
                      type="text"
                      value={footerVia}
                      maxLength={FOOTER_TEXT_MAX_LENGTH}
                      aria-label="便签底部 via 文本"
                      placeholder={DEFAULT_FOOTER_VIA}
                      onChange={(event) => onFooterViaChange(event.target.value)}
                    />
                  </label>
                </section>

                <button
                  type="button"
                  className="settings-footer-reset"
                  disabled={isDefaultFooter}
                  onClick={() => {
                    onFooterBrandChange(DEFAULT_FOOTER_BRAND);
                    onFooterLogoChange(DEFAULT_FOOTER_LOGO_URL);
                    onFooterViaChange(DEFAULT_FOOTER_VIA);
                    setFooterLogoError("");
                  }}
                >
                  恢复默认页脚
                </button>
              </div>
            </section>

            <section
              id="settings-pane-account"
              className="settings-pane"
              aria-labelledby="settings-account-title"
              hidden={category !== "account"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-account-title">账号与同步</h3>
                <p>管理登录状态、云端同步和账号安全。</p>
              </header>

              <section className="settings-card settings-account-card" aria-label="账号信息">
                {authUsername ? (
                  <>
                    <div className="settings-account-identity">
                      <span className="settings-account-avatar" aria-hidden="true">
                        {accountInitial}
                      </span>
                      <span className="settings-account-copy">
                        <strong>{authUsername}</strong>
                        <small>{cloudStatusLabel}</small>
                      </span>
                      <span className="settings-status-badge">已登录</span>
                    </div>
                    {canChangePassword ? (
                      <button
                        type="button"
                        className="settings-row"
                        onClick={onChangePassword}
                      >
                        <span className="settings-row-label">
                          修改密码
                          <small>更新密码后，其他设备和旧 Skill Token 会失效</small>
                        </span>
                        <span className="settings-row-value">
                          <span className="settings-row-chevron" aria-hidden="true">›</span>
                        </span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="settings-row settings-logout-row"
                      onClick={onLogout}
                    >
                      <span className="settings-row-label">退出登录</span>
                      <span className="settings-row-value">
                        <span className="settings-row-chevron" aria-hidden="true">›</span>
                      </span>
                    </button>
                  </>
                ) : (
                  <button type="button" className="settings-row" onClick={onLogin}>
                    <span className="settings-row-label">
                      登录账号
                      <small>{cloudStatusLabel}</small>
                    </span>
                    <span className="settings-row-value">
                      登录
                      <span className="settings-row-chevron" aria-hidden="true">›</span>
                    </span>
                  </button>
                )}
              </section>
            </section>

            <section
              id="settings-pane-extensions"
              className="settings-pane"
              aria-labelledby="settings-extensions-title"
              hidden={category !== "extensions"}
            >
              <header className="settings-pane-header">
                <h3 id="settings-extensions-title">工具与扩展</h3>
                <p>把当前账号的便签能力安全地接入本地 AI 工具。</p>
              </header>

              <article className="settings-tool-card">
                <span className="settings-tool-icon" aria-hidden="true">H</span>
                <div className="settings-tool-copy">
                  <h4>Hermes Skill</h4>
                  <p>
                    下载包含当前账号授权的工作区 Skill。解压到{" "}
                    <code>~/.hermes/skills</code>{" "}后即可使用。
                  </p>
                  <small>
                    当前链接可用于多台电脑；仅在主动重置或修改密码后失效。
                  </small>
                </div>
                <div className="settings-tool-actions" aria-live="polite">
                  <button
                    type="button"
                    className="settings-tool-action settings-hermes-skill-row"
                    disabled={Boolean(authUsername) && isHermesSkillDownloading}
                    onClick={authUsername ? onHermesSkillDownload : onLogin}
                  >
                    {authUsername
                      ? isHermesSkillDownloading
                        ? "生成中…"
                        : "下载 Skill"
                      : "登录后使用"}
                  </button>
                  {authUsername ? (
                    <>
                      <button
                        type="button"
                        className="settings-tool-action settings-tool-action-secondary"
                        disabled={
                          hermesSkillLinkActionState === "copying" ||
                          hermesSkillLinkActionState === "resetting"
                        }
                        onClick={onHermesSkillLinkCopy}
                      >
                        {hermesSkillLinkActionState === "copying"
                          ? "生成中…"
                          : hermesSkillLinkActionState === "copied"
                            ? "已复制"
                            : "复制链接"}
                      </button>
                      <button
                        type="button"
                        className="settings-tool-action settings-tool-action-reset"
                        disabled={
                          hermesSkillLinkActionState === "copying" ||
                          hermesSkillLinkActionState === "resetting"
                        }
                        onClick={onHermesSkillLinkReset}
                      >
                        {hermesSkillLinkActionState === "resetting"
                          ? "重置中…"
                          : hermesSkillLinkActionState === "reset"
                            ? "已重置"
                            : "重置链接"}
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
