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
  selectedTheme: ThemeId;
  onAiEnabledChange?: (enabled: boolean) => void;
  onChangePassword?: () => void;
  onClose: () => void;
  onFooterBrandChange?: (footerBrand: string) => void;
  onFooterLogoChange?: (footerLogoUrl: string) => void;
  onFooterViaChange?: (footerVia: string) => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onThemeChange: (themeId: ThemeId) => void;
}

type SettingsPage = "root" | "background" | "footer";

function getThemeName(themeId: ThemeId): string {
  return THEME_OPTIONS.find((option) => option.id === themeId)?.description ?? "暖白纸感";
}

export function SettingsPanel({
  aiAvailable = false,
  aiEnabled = false,
  authUsername = null,
  canChangePassword = false,
  cloudStatusLabel = "数据仅保存在当前浏览器",
  footerBrand = DEFAULT_FOOTER_BRAND,
  footerLogoUrl = DEFAULT_FOOTER_LOGO_URL,
  footerVia = DEFAULT_FOOTER_VIA,
  selectedTheme,
  onAiEnabledChange = () => undefined,
  onChangePassword,
  onClose,
  onFooterBrandChange = () => undefined,
  onFooterLogoChange = () => undefined,
  onFooterViaChange = () => undefined,
  onLogin,
  onLogout,
  onThemeChange,
}: SettingsPanelProps) {
  const [page, setPage] = useState<SettingsPage>("root");
  const [isFooterLogoUploading, setIsFooterLogoUploading] = useState(false);
  const [footerLogoError, setFooterLogoError] = useState("");
  const footerLogoInputRef = useRef<HTMLInputElement | null>(null);
  const isRootPage = page === "root";
  const isDefaultFooterLogo = footerLogoUrl === DEFAULT_FOOTER_LOGO_URL;
  const isDefaultFooter =
    footerBrand === DEFAULT_FOOTER_BRAND &&
    isDefaultFooterLogo &&
    footerVia === DEFAULT_FOOTER_VIA;
  const footerSummary =
    !footerBrand && !footerVia ? "不显示" : isDefaultFooter ? "默认" : "自定义";
  const pageTitle =
    page === "root" ? "设置" : page === "background" ? "背景颜色" : "底部显示";

  function handleBack() {
    if (isRootPage) {
      onClose();
      return;
    }

    setPage("root");
  }

  function handleThemeChange(themeId: ThemeId) {
    onThemeChange(themeId);
    setPage("root");
  }

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
      id="app-settings-panel"
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-settings-title"
      data-settings-page={page}
    >
      <header className="settings-panel-header">
        <button
          type="button"
          className="settings-back"
          aria-label={isRootPage ? "关闭设置" : "返回设置"}
          onClick={handleBack}
        >
          <span aria-hidden="true" />
        </button>
        <h2 id="app-settings-title">{pageTitle}</h2>
        <button
          type="button"
          className="settings-close"
          aria-label="关闭设置"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="settings-content">
        {isRootPage ? (
          <>
            <section
              className="settings-card settings-account-card"
              aria-label="账号与同步"
            >
              {authUsername ? (
                <>
                  <div className="settings-row settings-account-summary">
                    <span className="settings-row-label">
                      {authUsername}
                      <small>{cloudStatusLabel}</small>
                    </span>
                    <span className="settings-row-value">已登录</span>
                  </div>
                  {canChangePassword ? (
                    <button
                      type="button"
                      className="settings-row"
                      onClick={onChangePassword}
                    >
                      <span className="settings-row-label">修改密码</span>
                      <span className="settings-row-value">
                        <span className="settings-row-chevron" aria-hidden="true">
                          ›
                        </span>
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
                      <span className="settings-row-chevron" aria-hidden="true">
                        ›
                      </span>
                    </span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="settings-row"
                  onClick={onLogin}
                >
                  <span className="settings-row-label">
                    登录账号
                    <small>{cloudStatusLabel}</small>
                  </span>
                  <span className="settings-row-value">
                    登录
                    <span className="settings-row-chevron" aria-hidden="true">
                      ›
                    </span>
                  </span>
                </button>
              )}
            </section>

            <section
              className="settings-card settings-preferences-card"
              aria-label="便签偏好"
            >
              <button
                type="button"
                className="settings-row"
                aria-label={`背景颜色，当前为${getThemeName(selectedTheme)}`}
                onClick={() => setPage("background")}
              >
                <span className="settings-row-label">背景颜色</span>
                <span className="settings-row-value">
                  {getThemeName(selectedTheme)}
                  <span className="settings-row-chevron" aria-hidden="true">
                    ›
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="settings-row"
                aria-label={`便签底部文字，当前为${footerSummary}`}
                onClick={() => setPage("footer")}
              >
                <span className="settings-row-label">便签底部文字</span>
                <span className="settings-row-value">
                  {footerSummary}
                  <span className="settings-row-chevron" aria-hidden="true">
                    ›
                  </span>
                </span>
              </button>
              {aiAvailable ? (
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
                        ? "逐条确认或同意所有，修改前由你决定"
                        : "逐条确认或同意所有，登录后可使用"}
                    </small>
                  </span>
                  <span
                    className={`settings-switch${aiEnabled ? " is-on" : ""}`}
                    aria-hidden="true"
                  >
                    <span />
                  </span>
                </button>
              ) : null}
            </section>
          </>
        ) : page === "background" ? (
          <section className="settings-card settings-theme-list" aria-label="选择背景颜色">
            {THEME_OPTIONS.map((option) => {
              const isActive = option.id === selectedTheme;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={`settings-theme-row${isActive ? " active" : ""}`}
                  aria-pressed={isActive}
                  onClick={() => handleThemeChange(option.id)}
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
          </section>
        ) : (
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
        )}
      </div>
    </div>
  );
}
