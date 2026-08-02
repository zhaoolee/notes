import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangelogPage } from "../../src/components/ChangelogPage.js";
import { getChangelogSections } from "../../src/lib/changelog.js";

const changelog = readFileSync("CHANGELOG.md", "utf8");
const packageVersion = JSON.parse(
  readFileSync("package.json", "utf8"),
) as { version: string };

test("CHANGELOG 使用固定的人类可读格式记录正式版本", () => {
  const secondLevelHeadings = Array.from(
    changelog.matchAll(/^##\s+(.+)$/gm),
    (match) => match[1],
  );
  const categoryHeadings = Array.from(
    changelog.matchAll(/^###\s+(.+)$/gm),
    (match) => match[1],
  );
  const allowedCategories = new Set([
    "新增",
    "变更",
    "弃用",
    "移除",
    "修复",
    "安全",
  ]);

  assert.match(changelog, /^# 更新日志\n/);
  assert.equal(secondLevelHeadings[0], `[${packageVersion.version}] - 2026-08-02`);
  assert.ok(categoryHeadings.length > 0);

  for (const category of categoryHeadings) {
    assert.ok(allowedCategories.has(category), `不支持的更新日志分类：${category}`);
    assert.match(
      changelog,
      new RegExp(`^### ${category}\\n(?:\\n)?- \\S`, "m"),
      `${category} 分类不能为空`,
    );
  }

  assert.doesNotMatch(changelog, /^- [0-9a-f]{7,40}\s+/m);
  assert.doesNotMatch(changelog, /^## \[未发布\]/m);
  assert.match(
    changelog,
    /^\[1\.3\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.2\.0\.\.\.1\.3\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.2\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.1\.0\.\.\.1\.2\.0$/m,
  );
});

test("changelog 解析器保留便签分节并解析版本比较链接", () => {
  const sections = getChangelogSections(changelog);

  assert.equal(sections[0]?.heading, "");
  assert.match(sections[0]?.content ?? "", /^# 更新日志/m);
  assert.equal(
    sections[1]?.heading,
    "[1.3.0](https://github.com/zhaoolee/notes/compare/1.2.0...1.3.0) - 2026-08-02",
  );
  assert.match(sections[1]?.content ?? "", /导出全部便签/);
  assert.equal(
    sections[2]?.heading,
    "[1.2.0](https://github.com/zhaoolee/notes/compare/1.1.0...1.2.0) - 2026-08-02",
  );
  assert.match(sections[2]?.content ?? "", /设置新增“关于”栏目/);
});

test("changelog 独立页面复用锤子便签预览结构", () => {
  const html = renderToStaticMarkup(
    createElement(ChangelogPage, { markdown: changelog }),
  );

  assert.match(html, /class="app-layout changelog-page"/);
  assert.match(html, /class="app-topbar changelog-topbar"/);
  assert.match(html, /class="changelog-preview-stage"/);
  assert.match(html, /class="note-sheet"/);
  assert.match(html, /class="sheet-frame sheet-frame-outer"/);
  assert.match(html, />更新日志</);
  assert.match(html, />新增</);
  assert.match(html, /href="https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.2\.0\.\.\.1\.3\.0"/);
  assert.match(html, /href="\/" aria-label="返回锤子便签"/);
});

test("前端入口和生产镜像都包含 changelog 页面所需文件", () => {
  const mainSource = readFileSync("src/main.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");
  const frontendDockerfile = readFileSync("Dockerfile.frontend", "utf8");
  const appDockerfile = readFileSync("Dockerfile.app", "utf8");

  assert.match(mainSource, /import changelogMarkdown from "\.\.\/CHANGELOG\.md\?raw"/);
  assert.match(mainSource, /pathname === "\/changelog"/);
  assert.match(mainSource, /<ChangelogPage markdown=\{changelogMarkdown\} \/>/);
  assert.match(styles, /\.changelog-main\s*\{/);
  assert.match(
    styles,
    /\.changelog-preview-stage\s*\{[^}]*--note-sheet-width:\s*calc\(330px \* var\(--note-scale\)\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.changelog-page\[data-theme="smartisan-dark"\] \.changelog-main/s,
  );
  assert.match(frontendDockerfile, /COPY CHANGELOG\.md index\.html/);
  assert.match(appDockerfile, /COPY CHANGELOG\.md index\.html/);
});
