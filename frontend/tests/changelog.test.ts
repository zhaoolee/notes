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

test("CHANGELOG 使用固定的人类可读格式记录未发布与正式版本", () => {
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
  const hasUnreleasedSection = secondLevelHeadings[0] === "[未发布]";
  const latestReleaseIndex = hasUnreleasedSection ? 1 : 0;

  assert.match(changelog, /^# 更新日志\n/);
  assert.equal(
    secondLevelHeadings[latestReleaseIndex],
    `[${packageVersion.version}] - 2026-08-17`,
  );
  assert.ok(categoryHeadings.length > 0);

  if (hasUnreleasedSection) {
    assert.match(changelog, /^## \[未发布\]\n\n### \S+\n\n- \S/m);
    assert.match(
      changelog,
      /^\[未发布\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.7\.1\.\.\.HEAD$/m,
    );
  }

  for (const category of categoryHeadings) {
    assert.ok(allowedCategories.has(category), `不支持的更新日志分类：${category}`);
    assert.match(
      changelog,
      new RegExp(`^### ${category}\\n(?:\\n)?- \\S`, "m"),
      `${category} 分类不能为空`,
    );
  }

  assert.doesNotMatch(changelog, /^- [0-9a-f]{7,40}\s+/m);
  assert.match(
    changelog,
    /^\[1\.7\.1\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.7\.0\.\.\.1\.7\.1$/m,
  );
  assert.match(
    changelog,
    /^\[1\.7\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.6\.1\.\.\.1\.7\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.6\.1\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.6\.0\.\.\.1\.6\.1$/m,
  );
  assert.match(
    changelog,
    /^\[1\.6\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.5\.1\.\.\.1\.6\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.5\.1\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.5\.0\.\.\.1\.5\.1$/m,
  );
  assert.match(
    changelog,
    /^\[1\.5\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.4\.0\.\.\.1\.5\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.4\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.3\.3\.\.\.1\.4\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.3\.3\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.3\.2\.\.\.1\.3\.3$/m,
  );
  assert.match(
    changelog,
    /^\[1\.3\.2\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.3\.1\.\.\.1\.3\.2$/m,
  );
  assert.match(
    changelog,
    /^\[1\.3\.1\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.3\.0\.\.\.1\.3\.1$/m,
  );
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
  const hasUnreleasedSection = /^## \[未发布\]/m.test(changelog);
  const latestReleaseSectionIndex = hasUnreleasedSection ? 2 : 1;

  assert.equal(sections[0]?.heading, "");
  assert.match(sections[0]?.content ?? "", /^# 更新日志/m);
  if (hasUnreleasedSection) {
    assert.equal(
      sections[1]?.heading,
      "[未发布](https://github.com/zhaoolee/notes/compare/1.7.1...HEAD)",
    );
  }
  assert.equal(
    sections[latestReleaseSectionIndex]?.heading,
    "[1.7.1](https://github.com/zhaoolee/notes/compare/1.7.0...1.7.1) - 2026-08-17",
  );
  assert.match(
    sections[latestReleaseSectionIndex]?.content ?? "",
    /粘贴普通网址.*远程图片.*正文.*图片导入流程/s,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 1]?.heading,
    "[1.7.0](https://github.com/zhaoolee/notes/compare/1.6.1...1.7.0) - 2026-08-17",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 1]?.content ?? "",
    /DeepSeek Harness.*Apple 原生导航栏.*Markdown 加粗/s,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 2]?.heading,
    "[1.6.1](https://github.com/zhaoolee/notes/compare/1.6.0...1.6.1) - 2026-08-05",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 2]?.content ?? "",
    /宣传页.*嵌套路由.*静态资源.*空白/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 3]?.heading,
    "[1.6.0](https://github.com/zhaoolee/notes/compare/1.5.1...1.6.0) - 2026-08-05",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 3]?.content ?? "",
    /单图聚焦.*多页层叠.*2048 × 920.*高清 PNG/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 4]?.heading,
    "[1.5.1](https://github.com/zhaoolee/notes/compare/1.5.0...1.5.1) - 2026-08-05",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 4]?.content ?? "",
    /Bear 主题.*粗体.*超链接.*另外五种主题/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 5]?.heading,
    "[1.5.0](https://github.com/zhaoolee/notes/compare/1.4.0...1.5.0) - 2026-08-05",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 5]?.content ?? "",
    /第六种.*Telegra\.ph.*公众号复制/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 6]?.heading,
    "[1.4.0](https://github.com/zhaoolee/notes/compare/1.3.3...1.4.0) - 2026-08-05",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 6]?.content ?? "",
    /五种便签样式.*相互隔离/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 7]?.heading,
    "[1.3.3](https://github.com/zhaoolee/notes/compare/1.3.2...1.3.3) - 2026-08-04",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 7]?.content ?? "",
    /公众号.*过大过粗/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 8]?.heading,
    "[1.3.2](https://github.com/zhaoolee/notes/compare/1.3.1...1.3.2) - 2026-08-03",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 8]?.content ?? "",
    /跨端同步文章排序/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 9]?.heading,
    "[1.3.1](https://github.com/zhaoolee/notes/compare/1.3.0...1.3.1) - 2026-08-03",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 9]?.content ?? "",
    /AI“重点加粗”/,
  );
  assert.equal(
    sections[latestReleaseSectionIndex + 10]?.heading,
    "[1.3.0](https://github.com/zhaoolee/notes/compare/1.2.0...1.3.0) - 2026-08-02",
  );
  assert.match(
    sections[latestReleaseSectionIndex + 10]?.content ?? "",
    /导出全部便签/,
  );
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
  assert.match(html, /href="https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.3\.0\.\.\.1\.3\.1"/);
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
  assert.match(
    styles,
    /@media \(min-width: 641px\)\s*\{\s*\.changelog-page\s*\{[^}]*height:\s*100dvh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.changelog-main\s*\{[^}]*overflow:\s*auto;[^}]*overscroll-behavior:\s*contain;/s,
  );
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
