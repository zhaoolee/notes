import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "../../src/components/SettingsPanel.js";
import { SharePanel } from "../../src/components/SharePanel.js";
import { buildHermesSkillInstallInstruction } from "../../src/lib/hermes.js";

test("设置页只保留长期偏好，不混入当前便签操作", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      footerBrand: "由测试发送",
      footerLogoUrl: "/images/test-logo.png",
      footerVia: "via Feedback",
      selectedTheme: "default",
      onFooterBrandChange: noop,
      onFooterViaChange: noop,
      onClose: noop,
      onThemeChange: noop,
    }),
  );

  assert.match(html, /id="app-settings-panel"/);
  assert.match(html, /data-settings-category="general"/);
  assert.match(html, />设置</);
  assert.match(html, /aria-label="设置分类"/);
  assert.ok(
    html.indexOf("常规") < html.indexOf("个性化") &&
      html.indexOf("个性化") < html.indexOf("账号与同步") &&
      html.indexOf("账号与同步") < html.indexOf("工具与扩展"),
    "设置分类应按常规、个性化、账号与同步、工具与扩展排列",
  );
  assert.match(html, /账号与同步/);
  assert.match(html, /登录账号/);
  assert.match(html, /数据仅保存在当前浏览器/);
  assert.match(html, /外观/);
  assert.match(html, /自动适应/);
  assert.match(html, /跟随系统日夜切换/);
  assert.match(html, /暖白纸感/);
  assert.match(html, /个性化/);
  assert.match(html, /由测试发送/);
  assert.match(html, /via Feedback/);
  assert.doesNotMatch(html, /新建空白便签/);
  assert.doesNotMatch(html, /插入图片/);
  assert.doesNotMatch(html, /加载示例/);
  assert.doesNotMatch(html, /删除当前便签/);
  assert.doesNotMatch(html, /下载归档/);
  assert.doesNotMatch(html, /复制文本/);
});

test("AI 服务可用时才在工具与扩展显示开启选项，并明确逐条确认", () => {
  const noop = () => undefined;
  const unavailableHtml = renderToStaticMarkup(
    createElement(SettingsPanel, {
      aiAvailable: false,
      selectedTheme: "default",
      onClose: noop,
      onThemeChange: noop,
    }),
  );
  const availableHtml = renderToStaticMarkup(
    createElement(SettingsPanel, {
      aiAvailable: true,
      aiEnabled: true,
      authUsername: "feedback-user",
      selectedTheme: "default",
      onAiEnabledChange: noop,
      onClose: noop,
      onThemeChange: noop,
    }),
  );

  assert.doesNotMatch(unavailableHtml, /AI 辅助审阅/);
  assert.match(availableHtml, /AI 辅助审阅/);
  assert.match(availableHtml, /role="switch"/);
  assert.match(availableHtml, /aria-checked="true"/);
  assert.match(availableHtml, /智能工具/);
  assert.match(availableHtml, /逐条确认建议，正文始终由你决定是否修改/);
  assert.ok(
    availableHtml.indexOf('id="settings-pane-extensions"') <
      availableHtml.indexOf("智能工具") &&
      availableHtml.indexOf("智能工具") <
        availableHtml.indexOf("AI 辅助审阅") &&
      availableHtml.indexOf("AI 辅助审阅") <
        availableHtml.indexOf("Hermes Skill"),
    "AI 辅助审阅应归入工具与扩展，并排在外部扩展之前",
  );
});

test("底部显示设置提供四角格、Logo 上传、双文本编辑、恢复默认与持久化", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const settingsSource = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const stateSource = readFileSync("src/lib/app-state.ts", "utf8");
  const footerSource = readFileSync("src/lib/footer.ts", "utf8");
  const wechatSource = readFileSync("src/lib/wechat.ts", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    settingsSource,
    /const SETTINGS_CATEGORIES = \[/,
  );
  assert.match(settingsSource, /id: "personalization", label: "个性化"/);
  assert.match(settingsSource, /id="settings-pane-personalization"/);
  assert.match(settingsSource, /aria-label="便签底部文字预览"/);
  assert.equal(
    (settingsSource.match(/settings-footer-preview-corner is-/g) ?? []).length,
    4,
  );
  assert.match(settingsSource, /aria-label="便签底部 Logo"/);
  assert.match(settingsSource, /aria-label="选择便签底部 Logo 图片"/);
  assert.match(settingsSource, /importImageFile\(file\)/);
  assert.match(settingsSource, /onFooterLogoChange\(imported\.path\)/);
  assert.match(settingsSource, /aria-label="便签底部发送来源"/);
  assert.match(settingsSource, /aria-label="便签底部 via 文本"/);
  assert.match(settingsSource, /恢复默认页脚/);
  assert.match(appSource, /persistFooterText\(footerBrand, footerVia\)/);
  assert.match(appSource, /persistFooterLogoUrl\(footerLogoUrl\)/);
  assert.match(appSource, /footerBrand=\{footerBrand\}/);
  assert.match(appSource, /footerLogoUrl=\{footerLogoUrl\}/);
  assert.match(appSource, /footerVia=\{footerVia\}/);
  assert.match(
    footerSource,
    /FOOTER_BRAND_STORAGE_KEY = "notes\.footerBrand"/,
  );
  assert.match(
    footerSource,
    /FOOTER_LOGO_STORAGE_KEY = "notes\.footerLogoUrl"/,
  );
  assert.match(
    footerSource,
    /FOOTER_VIA_STORAGE_KEY = "notes\.footerVia"/,
  );
  assert.match(
    stateSource,
    /function persistFooterText\(footerBrand: string, footerVia: string\)/,
  );
  assert.match(
    wechatSource,
    /JSON\.stringify\(\{ markdown, \.\.\.footer \}\)/,
  );
  assert.match(
    styles,
    /\.settings-footer-preview-corner\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;[^}]*border:\s*1px solid var\(--note-frame\);/s,
  );
  assert.match(
    styles,
    /\.settings-footer-preview\s*\{[^}]*min-height:\s*148px;[^}]*background:\s*var\(--sheet-surface\);/s,
  );
  assert.match(
    styles,
    /\.settings-footer-field input\s*\{[^}]*height:\s*36px;[^}]*background:\s*var\(--input-bg\);/s,
  );
  assert.match(
    styles,
    /\.settings-footer-logo-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
  );
});

test("分享面板承接存图、复制和归档", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SharePanel, {
      copyButtonText: "已复制文字",
      isArchiving: true,
      isCopyingWechat: false,
      isExporting: false,
      onArchiveDownload: noop,
      onClose: noop,
      onCopyMarkdown: noop,
      onCopyWechat: noop,
      onExport: noop,
      wechatButtonText: "复制到公众号",
    }),
  );

  assert.match(html, /id="app-share-panel"/);
  assert.match(html, /请选择操作/);
  assert.match(html, /以图片形式分享/);
  assert.match(html, /已复制文字/);
  assert.match(html, /复制到公众号/);
  assert.match(html, /上传图片并复制微信公众号富文本/);
  assert.match(html, /归档中\.\.\./);

  assert.ok(
    html.indexOf("已复制文字") < html.indexOf("复制到公众号") &&
      html.indexOf("复制到公众号") < html.indexOf("以图片形式分享") &&
      html.indexOf("以图片形式分享") < html.indexOf("归档中..."),
    "分享动作顺序应先文字、再公众号、图片和归档",
  );
});

test("移动分享面板复现原版贴底操作层", () => {
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.share-panel-backdrop\s*\{[^}]*inset:\s*0;[^}]*background:\s*rgba\(20,\s*18,\s*17,\s*0\.58\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.share-panel\s*\{[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*left:\s*0;[^}]*border-radius:\s*16px 16px 0 0;[^}]*background:\s*#f2f2f2;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.share-panel-header\s*\{[^}]*min-height:\s*52px;[^}]*grid-template-columns:\s*40px minmax\(0,\s*1fr\) 40px;[^}]*border-bottom:\s*1px solid #dedede;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.share-actions\s*\{[^}]*padding:\s*20px 16px 0;[^}]*gap:\s*18px;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.share-action\s*\{[^}]*min-height:\s*58px;[^}]*border-radius:\s*10px;[^}]*background:\s*#fff;[^}]*text-align:\s*center;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.share-action-description\s*\{[^}]*display:\s*none;/s,
  );
});

test("登录用户可在移动设置页修改密码或退出", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      authUsername: "feedback-user",
      canChangePassword: true,
      cloudStatusLabel: "便签已保存到云端",
      selectedTheme: "default",
      onChangePassword: noop,
      onClose: noop,
      onHermesSkillDownload: noop,
      onHermesSkillLinkCopy: noop,
      onHermesSkillLinkReset: noop,
      onLogout: noop,
      onThemeChange: noop,
    }),
  );

  assert.match(html, /feedback-user/);
  assert.match(html, /便签已保存到云端/);
  assert.match(html, /修改密码/);
  assert.match(html, /Hermes Skill/);
  assert.match(html, /下载 Skill/);
  assert.match(html, /安装指令/);
  assert.match(html, /aria-label="复制发给 Hermes 的安装指令"/);
  assert.match(html, /重置链接/);
  assert.match(html, /链接可用于多台电脑/);
  assert.match(html, /仅在主动重置或修改密码后失效/);
  assert.match(html, /把下面这句话直接发给 Hermes/);
  assert.match(html, /请帮我安装这个 Skill/);
  assert.match(html, /专属 ZIP 链接/);
  assert.match(html, /notes-workspace-api[\s\S]*~\/\.hermes\/skills\//);
  assert.match(html, /读取 SKILL\.md 并完成安装/);
  assert.match(html, /不要在回复中展示安装链接或 \.env 里的凭据/);
  assert.ok(
    html.indexOf('aria-label="复制发给 Hermes 的安装指令"') <
      html.indexOf("请帮我安装这个 Skill"),
    "复制按钮应位于安装指令正文上方的右侧工具栏",
  );
  assert.match(html, /退出登录/);
  assert.doesNotMatch(html, /登录账号/);
  assert.ok(
      html.indexOf('id="settings-pane-account"') <
      html.indexOf('id="settings-pane-extensions"') &&
      html.indexOf('id="settings-pane-extensions"') <
        html.indexOf("Hermes Skill"),
    "Hermes 下载应归入工具与扩展，而不是账号操作列表",
  );
});

test("Hermes Skill 支持下载、复制完整安装指令和主动重置安装链接", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const authSource = readFileSync("src/lib/auth.ts", "utf8");
  const settingsSource = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(settingsSource, /settings-hermes-skill-row/);
  assert.match(settingsSource, /settings-tool-prompt-action/);
  assert.match(settingsSource, /settings-tool-action-reset/);
  assert.match(settingsSource, /aria-haspopup="dialog"/);
  assert.match(
    settingsSource,
    /className="settings-tool-prompt"[\s\S]*className="settings-tool-prompt-header"[\s\S]*className="settings-tool-prompt-action"[\s\S]*className="settings-tool-prompt-text"/s,
  );
  assert.match(
    settingsSource,
    /disabled=\{Boolean\(authUsername\) && isHermesSkillDownloading\}/,
  );
  assert.match(appSource, /await downloadHermesSkillPackage\(\)/);
  assert.match(authSource, /fetch\("\/api\/hermes-skill\/download"/);
  assert.match(authSource, /method: "POST"/);
  assert.match(authSource, /credentials: "same-origin"/);
  assert.match(authSource, /link\.download = "notes-workspace-api\.zip"/);
  assert.match(authSource, /"\/api\/hermes-skill\/install-link"/);
  assert.match(authSource, /"\/api\/hermes-skill\/install-link\/reset"/);
  assert.match(appSource, /await getHermesSkillInstallLink\(\)/);
  assert.match(appSource, /await resetHermesSkillInstallLink\(\)/);
  assert.match(
    appSource,
    /await copyTextToClipboard\(buildHermesSkillInstallInstruction\(installUrl\)\)/,
  );
  assert.match(settingsSource, /hermesSkillLinkActionState === "copied"/);
  assert.match(settingsSource, /hermesSkillLinkActionState === "reset"/);
  assert.match(
    appSource,
    /onHermesSkillLinkReset=\{\(\) =>\s*setIsHermesSkillLinkResetConfirmationOpen\(true\)\s*\}/s,
  );
  assert.doesNotMatch(
    appSource,
    /onHermesSkillLinkReset=\{\(\) => void handleHermesSkillLinkReset\(\)\}/,
  );
  assert.match(appSource, /title: "重置 Hermes 安装链接？"/);
  assert.match(appSource, /当前专属链接会立即失效/);
  assert.match(appSource, /已经安装的 Skill 不受影响/);
  assert.match(appSource, /confirmLabel: "确认重置"/);
  assert.match(
    appSource,
    /pendingAction=\{\s*isHermesSkillLinkResetConfirmationOpen[\s\S]*?onClose=\{\(\) => setIsHermesSkillLinkResetConfirmationOpen\(false\)\}[\s\S]*?onConfirm=\{\(\) => void handleHermesSkillLinkReset\(\)\}/s,
  );
  assert.match(
    styles,
    /\.confirm-dialog-backdrop\s*\{[^}]*z-index:\s*150;/s,
  );

  assert.equal(
    buildHermesSkillInstallInstruction(
      " https://notes.example.com/api/hermes-skill/install/ticket/notes-workspace-api.zip ",
    ),
    "请帮我安装这个 Skill：https://notes.example.com/api/hermes-skill/install/ticket/notes-workspace-api.zip。请下载并解压 ZIP 包，把其中的 notes-workspace-api 文件夹放到 ~/.hermes/skills/，然后读取 SKILL.md 并完成安装；安装完成后请告诉我结果，不要在回复中展示安装链接或 .env 里的凭据。",
  );
});

test("设置入口复用同一个分类浮窗，并按桌面和手机切换导航布局", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    appSource,
    /className="app-brand"[\s\S]*className="desktop-brand-settings-trigger"[\s\S]*aria-controls="app-settings-panel"[\s\S]*onClick=\{handleSettingsToggle\}[\s\S]*className="app-brand-mark"/s,
  );
  assert.match(
    appSource,
    /const desktopSidebarFooter = \([\s\S]*className="desktop-sidebar-footer"[\s\S]*\{desktopAccountEntry\}[\s\S]*\);/s,
  );
  assert.doesNotMatch(appSource, /className="desktop-settings-trigger"/);
  assert.match(appSource, /desktopFooter=\{desktopSidebarFooter\}/);
  assert.match(
    appSource,
    /className="settings-panel-host" ref=\{settingsPanelHostRef\}[\s\S]*\{settingsPanel\}/s,
  );
  assert.equal(
    appSource.match(/<SettingsPanel/g)?.length,
    1,
    "桌面和移动端必须复用同一个设置面板实例",
  );
  assert.match(
    styles,
    /\.desktop-sidebar-footer\s*\{[^}]*width:\s*100%;[^}]*height:\s*49px;/s,
  );
  assert.match(
    styles,
    /\.desktop-brand-settings-trigger\s*\{[^}]*width:\s*38px;[^}]*height:\s*38px;[^}]*place-items:\s*center;/s,
  );
  assert.match(
    styles,
    /\.settings-modal-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*place-items:\s*center;/s,
  );
  assert.match(
    styles,
    /\.settings-layout\s*\{[^}]*grid-template-columns:\s*190px minmax\(0,\s*1fr\);/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.settings-panel-host \.settings-panel\s*\{[^}]*position:\s*relative;[^}]*width:\s*min\(760px,\s*calc\(100vw - 48px\)\);[^}]*height:\s*min\(620px,\s*calc\(100vh - 48px\)\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.settings-category-nav\s*\{[^}]*flex-direction:\s*row;[^}]*overflow-x:\s*auto;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.settings-tool-actions \.settings-tool-action\s*\{[^}]*padding-inline:\s*4px;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*\.settings-tool-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
  );
});

test("移动详情页按原版区分编辑态和预览态操作", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(appSource, /className="mobile-detail-action mobile-insert-image"/);
  assert.match(appSource, /className="mobile-detail-action mobile-edit-done"/);
  assert.match(appSource, /className="mobile-detail-action mobile-delete-note"/);
  assert.match(appSource, /className="share-trigger"/);
  assert.match(
    styles,
    /\.app-layout\[data-mobile-view="editor"\] \.mobile-insert-image,[\s\S]*\.app-layout\[data-mobile-view="editor"\] \.mobile-edit-done/,
  );
  assert.match(
    styles,
    /\.app-layout\[data-mobile-view="preview"\] \.mobile-delete-note,[\s\S]*\.app-layout\[data-mobile-view="preview"\] \.share-trigger/,
  );
  assert.match(
    styles,
    /\.app-layout:not\(\[data-mobile-view="notes"\]\) \.app-settings\s*\{[^}]*display:\s*none;/s,
  );

  for (const file of [
    "btn_pic.png",
    "btn_save_notes.png",
    "btn_delete_notes.png",
    "btn_share_notes.png",
  ]) {
    assert.ok(existsSync(`public/smartisan/mobile/${file}`), `${file} 应存在`);
  }
});
