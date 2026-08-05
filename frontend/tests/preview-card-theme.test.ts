import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewPanel } from "../../src/components/PreviewPanel.js";
import {
  isNoteCardThemeId,
  NOTE_CARD_THEME_OPTIONS,
  NOTE_CARD_THEME_STORAGE_KEY,
} from "../../src/lib/themes.js";

test("预览主题清单只包含可直接渲染的主题", () => {
  assert.deepEqual(
    NOTE_CARD_THEME_OPTIONS.map(({ id, label }) => ({ id, label })),
    [
      { id: "default", label: "暖白质感" },
      { id: "smartisan-dark", label: "深夜便签" },
      { id: "apple-notes-light", label: "iPhone 浅色" },
      { id: "apple-notes", label: "iPhone 深色" },
      { id: "bear", label: "Bear 便签" },
      { id: "telegraph", label: "Telegra.ph" },
    ],
  );
  assert.equal(NOTE_CARD_THEME_STORAGE_KEY, "notes.previewCardTheme");
  assert.equal(isNoteCardThemeId("default"), true);
  assert.equal(isNoteCardThemeId("smartisan-dark"), true);
  assert.equal(isNoteCardThemeId("apple-notes"), true);
  assert.equal(isNoteCardThemeId("apple-notes-light"), true);
  assert.equal(isNoteCardThemeId("bear"), true);
  assert.equal(isNoteCardThemeId("telegraph"), true);
  assert.equal(isNoteCardThemeId("system"), false);
});

test("PreviewPanel 把独立配色限定在便签卡片并提供浮动入口", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(PreviewPanel, {
      notes: [{ heading: "深夜记录", content: "只改变这张便签。" }],
      exportError: "",
      footerBrand: "由开源版锤子便签发送",
      footerLogoUrl: "/smartisan/web/smartisan_hammer_footer.png",
      footerVia: "Powered by zhaoolee/notes",
      noteCardTheme: "smartisan-dark",
      onFooterBrandChange: noop,
      onFooterViaChange: noop,
      onNoteCardThemeChange: noop,
    }),
  );

  assert.match(
    html,
    /class="preview-card-theme" data-preview-theme="smartisan-dark"/,
  );
  assert.match(html, /class="preview-theme-control"/);
  assert.match(html, /class="preview-theme-trigger"/);
  assert.match(html, /aria-label="切换预览主题，当前深夜便签"/);
  assert.match(html, />主题</);
  assert.doesNotMatch(html, /卡片配色|>配色</);
  assert.doesNotMatch(html, /class="preview-stage"[^>]*data-preview-theme=/);
});

test("预览主题浮窗支持移动端点按、点外关闭和 Escape 收起", () => {
  const previewSource = readFileSync("src/components/PreviewPanel.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(previewSource, /NOTE_CARD_THEME_OPTIONS\.map\(\(option\) =>/);
  assert.match(previewSource, /role="menuitemradio"/);
  assert.match(previewSource, /aria-checked=\{isActive\}/);
  assert.match(previewSource, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(previewSource, /document\.addEventListener\("keydown", handleKeyDown, true\)/);
  assert.match(previewSource, /event\.key !== "Escape"/);
  assert.match(
    styles,
    /\.preview-theme-control\s*\{[^}]*position:\s*absolute;[^}]*right:[^}]*safe-area-inset-right[^}]*bottom:[^}]*safe-area-inset-bottom/s,
  );
  assert.match(
    styles,
    /\.preview-theme-trigger\s*\{[^}]*height:\s*46px;[^}]*touch-action:\s*manipulation;/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.preview-theme-trigger\s*\{[^}]*height:\s*48px;/s,
  );
  assert.match(
    styles,
    /\.preview-theme-option\s*\{[^}]*min-height:\s*52px;[^}]*touch-action:\s*manipulation;/s,
  );
});

test("锤子便签明暗配色共用用户指定图标并仅给暗色叠加遮罩", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const icon = readFileSync("public/smartisan-theme-icon.png");

  assert.equal(icon.toString("ascii", 1, 4), "PNG");
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="default"\],\s*\.preview-theme-swatch\[data-preview-theme="default"\]\s*\{[^}]*background:\s*#e5c486 url\("\/smartisan-theme-icon\.png"\) center \/ cover\s*no-repeat;/s,
  );
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="smartisan-dark"\],\s*\.preview-theme-swatch\[data-preview-theme="smartisan-dark"\]\s*\{[^}]*background-image:\s*linear-gradient\(rgba\(0, 0, 0, 0\.52\), rgba\(0, 0, 0, 0\.52\)\),\s*url\("\/smartisan-theme-icon\.png"\);[^}]*background-size:\s*cover;/s,
  );
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="default"\] i,\s*\.preview-theme-trigger-swatch\[data-preview-theme="smartisan-dark"\] i,[\s\S]*?\{[^}]*display:\s*none;/s,
  );
});

test("Bear 配色入口使用用户指定的内置图标", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const icon = readFileSync("public/bear-theme-icon.png");

  assert.equal(icon.toString("ascii", 1, 4), "PNG");
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="bear"\],\s*\.preview-theme-swatch\[data-preview-theme="bear"\]\s*\{[^}]*background:\s*#cb1622 url\("\/bear-theme-icon\.png"\) center \/ cover no-repeat;/s,
  );
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="bear"\] i\s*\{[^}]*display:\s*none;/s,
  );
});

test("Telegra.ph 配色入口使用官网声明的 T 字母图标", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const icon = readFileSync("public/telegraph-theme-icon.png");

  assert.equal(icon.toString("ascii", 1, 4), "PNG");
  assert.equal(icon.readUInt32BE(16), 512);
  assert.equal(icon.readUInt32BE(20), 512);
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="telegraph"\],\s*\.preview-theme-swatch\[data-preview-theme="telegraph"\]\s*\{[^}]*background:\s*#ffffff url\("\/telegraph-theme-icon\.png"\) center \/ cover no-repeat;/s,
  );
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="telegraph"\] i\s*\{[^}]*display:\s*none;/s,
  );
});

test("iPhone 备忘录明暗配色共用用户指定图标并仅给暗色叠加遮罩", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const icon = readFileSync("public/apple-notes-theme-icon.png");

  assert.equal(icon.toString("ascii", 1, 4), "PNG");
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="apple-notes-light"\],\s*\.preview-theme-swatch\[data-preview-theme="apple-notes-light"\]\s*\{[^}]*background:\s*#ffffff url\("\/apple-notes-theme-icon\.png"\) center \/ cover\s*no-repeat;/s,
  );
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="apple-notes"\],\s*\.preview-theme-swatch\[data-preview-theme="apple-notes"\]\s*\{[^}]*background-image:\s*linear-gradient\(rgba\(0, 0, 0, 0\.52\), rgba\(0, 0, 0, 0\.52\)\),\s*url\("\/apple-notes-theme-icon\.png"\);[^}]*background-size:\s*cover;/s,
  );
  assert.match(
    styles,
    /\.preview-theme-trigger-swatch\[data-preview-theme="apple-notes"\] i,\s*\.preview-theme-trigger-swatch\[data-preview-theme="apple-notes-light"\] i\s*\{[^}]*display:\s*none;/s,
  );
});

test("卡片主题覆盖完整纸张 token，页面其余区域继续使用全局主题", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    appSource,
    /const noteCardTheme = noteCardThemeOverride \?\? resolvedTheme;/,
  );
  assert.match(
    appSource,
    /localStorage\.setItem\([\s\S]*NOTE_CARD_THEME_STORAGE_KEY,[\s\S]*noteCardThemeOverride/s,
  );
  assert.match(appSource, /exportMarkdownAsPng\(markdown, noteCardTheme,/);
  assert.match(appSource, /exportMarkdownArchive\(markdown, noteCardTheme,/);
  assert.match(appSource, /copyMarkdownForWechat\(markdown, noteCardTheme,/);
  assert.match(appSource, /noteCardTheme=\{noteCardTheme\}/);
  const exportSource = readFileSync("src/lib/export.ts", "utf8");
  assert.match(
    exportSource,
    /response\.headers\.get\("X-Export-Theme"\)[\s\S]*renderedTheme !== theme[\s\S]*导出服务尚未更新到当前主题版本/s,
  );
  assert.match(
    exportSource,
    /body:\s*JSON\.stringify\(\{[\s\S]*markdown,[\s\S]*theme,[\s\S]*X-Archive-Theme[\s\S]*!== theme/s,
  );
  const wechatSource = readFileSync("src/lib/wechat.ts", "utf8");
  assert.match(
    wechatSource,
    /JSON\.stringify\(\{ markdown, theme, \.\.\.footer \}\)[\s\S]*result\.theme !== theme/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="default"\]\s*\{[^}]*--sheet-surface:\s*#fffcf7;[^}]*--note-copy:\s*#665749;[^}]*--footer-copy:\s*#d7cec1;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="smartisan-dark"\]\s*\{[^}]*--sheet-surface:\s*#1c1a1c;[^}]*--note-copy:\s*#cecece;[^}]*--footer-copy:\s*#777477;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="apple-notes"\]\s*\{[^}]*--apple-notes-accent:\s*#ebb800;[^}]*--sheet-surface:\s*#181818;[^}]*--note-heading:\s*#e8e8e8;[^}]*--note-copy:\s*#dcdcdc;[^}]*--note-link:\s*var\(--apple-notes-accent\);/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="apple-notes-light"\]\s*\{[^}]*--apple-notes-accent:\s*#ebb800;[^}]*--sheet-surface:\s*#ffffff;[^}]*--note-heading:\s*#1c1c1e;[^}]*--note-copy:\s*#2c2c2e;[^}]*--note-link:\s*var\(--apple-notes-accent\);[^}]*--default-footer-logo-filter:\s*none;[^}]*--default-footer-logo-opacity:\s*1;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\]\s*\{[^}]*--bear-accent:\s*#dd4c4f;[^}]*--sheet-surface:\s*#ffffff;[^}]*--note-heading:\s*#444444;[^}]*--note-copy:\s*#444444;[^}]*--note-link:\s*var\(--bear-accent\);[^}]*--note-code-bg:\s*#f3f5f7;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="telegraph"\]\s*\{[^}]*--telegraph-block-gap:\s*max\(calc\(0\.375rem \* var\(--note-scale\)\), 10\.5px\);[^}]*--sheet-surface:\s*#ffffff;[^}]*--note-heading:\s*rgba\(0, 0, 0, 0\.8\);[^}]*--note-copy:\s*rgba\(0, 0, 0, 0\.8\);[^}]*--note-code-bg:\s*#f5f8fc;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\]\s*\{[^}]*--bear-block-gap:\s*max\(calc\(0\.33rem \* var\(--note-scale\)\), 8\.448px\);/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\] \.note-copy\s*\{[^}]*font-size:\s*max\(calc\(0\.46875rem \* var\(--note-scale\)\), 12px\);[^}]*line-height:\s*1\.755;[^}]*letter-spacing:\s*0;[^}]*-webkit-text-stroke:\s*0;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\] \.note-copy strong\s*\{[^}]*color:\s*var\(--bear-accent\);[^}]*font-weight:\s*700;/s,
  );
  assert.doesNotMatch(
    styles,
    /\.preview-card-theme\[data-preview-theme="(?:default|smartisan-dark|apple-notes|apple-notes-light|telegraph)"\] \.note-copy strong\s*\{[^}]*color:\s*var\(--bear-accent\);/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\] \.note-copy blockquote::before\s*\{[^}]*content:\s*"";[^}]*box-sizing:\s*content-box;[^}]*top:\s*0\.2em;[^}]*bottom:\s*auto;[^}]*left:\s*0;[^}]*width:\s*0\.13em;[^}]*height:\s*calc\(100% - 0\.4em\);[^}]*border:\s*0\.0667em solid var\(--bear-accent\);[^}]*font-size:\s*inherit;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\] \.note-copy \.markdown-blank-line\s*\{[^}]*height:\s*var\(--bear-block-gap\);/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\] \.note-section\.has-heading\s*\{[^}]*margin-top:\s*var\(--bear-block-gap\);/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\] \.note-index\s*\{[^}]*margin-bottom:\s*var\(--bear-block-gap\);/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="bear"\] \.note-copy h1\s*\{[^}]*padding-block:\s*0\.8em 0\.33em;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="telegraph"\] \.note-copy\s*\{[^}]*font-size:\s*max\(calc\(0\.5625rem \* var\(--note-scale\)\), 16px\);[^}]*line-height:\s*1\.58;[^}]*letter-spacing:\s*0;[^}]*-webkit-text-stroke:\s*0;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="telegraph"\] \.note-copy blockquote\s*\{[^}]*margin:\s*calc\(9px \* var\(--note-scale\)\)\s*calc\(10\.5px \* var\(--note-scale\)\)\s*calc\(8px \* var\(--note-scale\)\)\s*calc\(3px \* var\(--note-scale\)\);[^}]*padding-left:\s*calc\(7\.5px \* var\(--note-scale\)\);[^}]*border-left:\s*calc\(1\.5px \* var\(--note-scale\)\) solid #000000;[^}]*font-style:\s*italic;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme="telegraph"\] \.note-copy a\s*\{[^}]*color:\s*inherit;[^}]*border-bottom:\s*0\.1em solid rgba\(0, 0, 0, 0\.7\);/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme\^="apple-notes"\] \.note-sheet\s*\{[^}]*padding-right:\s*calc\(12px \* var\(--note-scale\)\);[^}]*padding-left:\s*calc\(12px \* var\(--note-scale\)\);[^}]*border-radius:\s*0;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme\^="apple-notes"\] \.sheet-inner\s*\{[^}]*padding-right:\s*0;[^}]*padding-left:\s*0;/s,
  );
  assert.match(
    styles,
    /\.preview-card-theme\[data-preview-theme\^="apple-notes"\] \.note-apple-toolbar\s*\{[^}]*display:\s*flex;/s,
  );
  assert.match(
    readFileSync("src/components/NoteSheet.tsx", "utf8"),
    /className="note-apple-toolbar"[\s\S]*className="note-apple-action-icon note-apple-share"[\s\S]*viewBox="0 0 86\.6722412109375 117\.4306640625"[\s\S]*className="note-apple-action-icon note-apple-compose"[\s\S]*viewBox="0 0 106\.68408203125 103\.19677734375"/s,
  );
  assert.doesNotMatch(
    readFileSync("src/components/NoteSheet.tsx", "utf8"),
    /note-apple-more|•••/,
  );
  assert.doesNotMatch(styles, /\.note-apple-share::before/);
  const serverSource = readFileSync("server/index.ts", "utf8");
  assert.match(
    serverSource,
    /body\[data-note-card-theme\^="apple-notes"\] \.sheet-inner\s*\{[^}]*padding-right:\s*0;[^}]*padding-left:\s*0;[^}]*\}\s*body\[data-note-card-theme\^="apple-notes"\] \.note-sheet\s*\{[^}]*padding-right:\s*calc\(12px \* var\(--note-scale\)\);[^}]*padding-left:\s*calc\(12px \* var\(--note-scale\)\);/s,
  );
  assert.match(
    serverSource,
    /new Set<NoteCardThemeId>\([\s\S]*Object\.keys\(NOTE_CARD_THEME_STYLES\)/s,
  );
  assert.match(
    serverSource,
    /response\.setHeader\("X-Export-Theme", theme\)/,
  );
  assert.match(
    serverSource,
    /throw new UnsupportedExportThemeError\(body\.theme\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.app-layout\[data-preview-theme=/,
  );
});
