import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "../../src/components/SettingsPanel.js";

test("设置面板收纳除存图外的全局操作", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      copyButtonText: "复制文本",
      isArchiving: false,
      isImportingImage: false,
      selectedTheme: "default",
      onArchiveDownload: noop,
      onClearMarkdown: noop,
      onClose: noop,
      onCopyMarkdown: noop,
      onInsertImage: noop,
      onLoadExample: noop,
      onThemeChange: noop,
    }),
  );

  assert.match(html, /id="app-settings-panel"/);
  assert.match(html, /便签主题/);
  assert.match(html, /新建空白便签/);
  assert.match(html, /插入图片/);
  assert.match(html, /加载示例/);
  assert.match(html, /下载归档/);
  assert.match(html, /复制文本/);
  assert.doesNotMatch(html, />存图</);
});

test("设置面板呈现进行中的操作状态", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      copyButtonText: "已复制文本",
      isArchiving: true,
      isImportingImage: true,
      selectedTheme: "smartisan-dark",
      onArchiveDownload: noop,
      onClearMarkdown: noop,
      onClose: noop,
      onCopyMarkdown: noop,
      onInsertImage: noop,
      onLoadExample: noop,
      onThemeChange: noop,
    }),
  );

  assert.match(html, /归档中\.\.\./);
  assert.match(html, /正在导入图片\.\.\./);
  assert.match(html, /已复制文本/);
  assert.match(html, /锤子暗黑/);
});
