import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "../../src/components/SettingsPanel.js";
import { SharePanel } from "../../src/components/SharePanel.js";

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
  assert.match(html, /data-settings-page="root"/);
  assert.match(html, />设置</);
  assert.match(html, /账号与同步/);
  assert.match(html, /登录账号/);
  assert.match(html, /数据仅保存在当前浏览器/);
  assert.match(html, /背景颜色/);
  assert.match(html, /暖白纸感/);
  assert.match(html, /便签底部文字/);
  assert.match(html, /当前为自定义/);
  assert.doesNotMatch(html, /新建空白便签/);
  assert.doesNotMatch(html, /插入图片/);
  assert.doesNotMatch(html, /加载示例/);
  assert.doesNotMatch(html, /删除当前便签/);
  assert.doesNotMatch(html, /下载归档/);
  assert.doesNotMatch(html, /复制文本/);
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
    /type SettingsPage = "root" \| "background" \| "footer";/,
  );
  assert.match(settingsSource, /onClick=\{\(\) => setPage\("footer"\)\}/);
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
      copyButtonText: "已复制文本",
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
  assert.match(html, /分享与导出/);
  assert.match(html, /保存为图片/);
  assert.match(html, /已复制文本/);
  assert.match(html, /复制到公众号/);
  assert.match(html, /上传图片并复制微信公众号富文本/);
  assert.match(html, /归档中\.\.\./);
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
      onLogout: noop,
      onThemeChange: noop,
    }),
  );

  assert.match(html, /feedback-user/);
  assert.match(html, /便签已保存到云端/);
  assert.match(html, /修改密码/);
  assert.match(html, /退出登录/);
  assert.doesNotMatch(html, /登录账号/);
});

test("桌面设置入口位于分类栏底部并复用移动设置面板", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    appSource,
    /const desktopSidebarFooter = \([\s\S]*className="desktop-sidebar-footer"[\s\S]*\{desktopAccountEntry\}[\s\S]*className="desktop-settings"[\s\S]*className="desktop-settings-trigger"[\s\S]*aria-controls="app-settings-panel"/s,
  );
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
    /\.desktop-sidebar-footer\s*\{[^}]*height:\s*49px;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) 50px;/s,
  );
  assert.match(
    styles,
    /\.desktop-settings-trigger\s*\{[^}]*width:\s*49px;[^}]*height:\s*49px;[^}]*place-items:\s*center;/s,
  );
  assert.match(
    styles,
    /@media \(min-width:\s*641px\)[\s\S]*\.settings-panel-host \.settings-panel\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*58px;[^}]*left:\s*10px;[^}]*width:\s*min\(340px,\s*calc\(100vw - 24px\)\);/s,
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
