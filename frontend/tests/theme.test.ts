import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "../../src/components/SettingsPanel.js";
import {
  DEFAULT_THEME_PREFERENCE_ID,
  isThemePreferenceId,
  resolveThemePreference,
  THEME_OPTIONS,
} from "../../src/lib/themes.js";

test("主题偏好区分自动适应与最终渲染主题", () => {
  assert.equal(DEFAULT_THEME_PREFERENCE_ID, "default");
  assert.deepEqual(
    THEME_OPTIONS.map((option) => option.id),
    ["system", "default", "smartisan-dark"],
  );
  assert.equal(isThemePreferenceId("system"), true);
  assert.equal(isThemePreferenceId("unknown"), false);
  assert.equal(resolveThemePreference("system", false), "default");
  assert.equal(resolveThemePreference("system", true), "smartisan-dark");
  assert.equal(resolveThemePreference("default", true), "default");
  assert.equal(
    resolveThemePreference("smartisan-dark", false),
    "smartisan-dark",
  );
});

test("自动适应选项在设置中可选择并说明会跟随系统", () => {
  const noop = () => undefined;
  const html = renderToStaticMarkup(
    createElement(SettingsPanel, {
      selectedTheme: "system",
      onClose: noop,
      onThemeChange: noop,
    }),
  );

  assert.match(html, /settings-theme-swatch-system/);
  assert.match(html, />自动适应</);
  assert.match(html, />跟随系统日夜切换</);
  assert.match(
    html,
    /settings-theme-row active[^>]*aria-pressed="true"[^>]*>[\s\S]*自动适应/,
  );
});

test("应用监听系统明暗变化并只把解析后的主题用于页面和导出", () => {
  const appSource = readFileSync("src/App.tsx", "utf8");
  const hookSource = readFileSync("src/lib/use-theme.ts", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(hookSource, /\(prefers-color-scheme: dark\)/);
  assert.match(hookSource, /mediaQuery\.addEventListener\("change", handleChange\)/);
  assert.match(hookSource, /mediaQuery\.removeEventListener\("change", handleChange\)/);
  assert.match(appSource, /const resolvedTheme = useResolvedTheme\(selectedTheme\)/);
  assert.match(appSource, /document\.documentElement\.dataset\.theme = resolvedTheme/);
  assert.match(appSource, /exportMarkdownAsPng\(markdown, resolvedTheme,/);
  assert.match(appSource, /data-theme=\{resolvedTheme\}/);
  assert.match(appSource, /data-theme-preference=\{selectedTheme\}/);
  assert.match(
    styles,
    /\.settings-theme-swatch-system\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*10px;[^}]*box-shadow:\s*none;[^}]*linear-gradient\([^}]*#f1dfc2 0 50%[^}]*#171a20 50% 100%/s,
  );
  assert.match(
    styles,
    /\.theme-selector-swatch-system\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*12px;[^}]*box-shadow:\s*none;[^}]*linear-gradient\([^}]*#f1dfc2 0 50%[^}]*#171a20 50% 100%/s,
  );
});
