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
    `[${packageVersion.version}] - 2026-10-31`,
  );
  assert.ok(categoryHeadings.length > 0);

  if (hasUnreleasedSection) {
    assert.match(changelog, /^## \[未发布\]\n\n### \S+\n\n- \S/m);
    assert.match(
      changelog,
      new RegExp(
        `^\\[未发布\\]: https://github\\.com/zhaoolee/notes/compare/${packageVersion.version.replaceAll(".", "\\.")}\\.\\.\\.HEAD$`,
        "m",
      ),
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
    /^\[1\.11\.1\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.11\.0\.\.\.1\.11\.1$/m,
  );
  assert.match(
    changelog,
    /^\[1\.11\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.10\.7\.\.\.1\.11\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.9\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.8\.4\.\.\.1\.9\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.8\.2\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.8\.1\.\.\.1\.8\.2$/m,
  );
  assert.match(
    changelog,
    /^\[1\.8\.1\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.8\.0\.\.\.1\.8\.1$/m,
  );
  assert.match(
    changelog,
    /^\[1\.8\.0\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.7\.2\.\.\.1\.8\.0$/m,
  );
  assert.match(
    changelog,
    /^\[1\.7\.2\]: https:\/\/github\.com\/zhaoolee\/notes\/compare\/1\.7\.1\.\.\.1\.7\.2$/m,
  );
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

  const releaseHeadings = sections
    .map((section) => section.heading.match(/^\[([^\]]+)\]\(/)?.[1])
    .filter(
      (version): version is string => Boolean(version) && version !== "未发布",
    );

  const releases: Array<{
    version: string;
    heading: string;
    content: RegExp[];
  }> = [
    {
      version: "1.15.0",
      heading: "[1.15.0](https://github.com/zhaoolee/notes/compare/1.14.1...1.15.0) - 2026-10-31",
      content: [/图片占位.*单张上传进度/s, /同时上传 5 张.*自动排队/s, /单张失败可重试.*切换便签/s],
    },
    {
      version: "1.14.1",
      heading: "[1.14.1](https://github.com/zhaoolee/notes/compare/1.14.0...1.14.1) - 2026-10-28",
      content: [/刷新便签.*刷新整个页面.*重新读取便签与文件夹/s, /未保存的编辑.*重试/s],
    },
    {
      version: "1.14.0",
      heading:
        "[1.14.0](https://github.com/zhaoolee/notes/compare/1.13.0...1.14.0) - 2026-10-23",
      content: [
        /发布为网站.*Hugo 网站 ZIP/s,
        /按登录账号保存.*换浏览器.*恢复/s,
        /站长名.*自定义 Logo.*basePath/s,
        /默认折叠的“高级设置”/,
        /首页简介只在首页显示一次/,
      ],
    },
    {
      version: "1.13.0",
      heading:
        "[1.13.0](https://github.com/zhaoolee/notes/compare/1.12.0...1.13.0) - 2026-10-22",
      content: [/微信公众号公开文章链接.*Markdown/s, /浏览器兜底/, /匿名请求.*401/],
    },
    {
      version: "1.12.0",
      heading:
        "[1.12.0](https://github.com/zhaoolee/notes/compare/1.11.2...1.12.0) - 2026-10-11",
      content: [/REQUIRE_LOGIN=true.*登录页.*匿名.*业务 API.*Skill Token/s],
    },
    {
      version: "1.11.2",
      heading:
        "[1.11.2](https://github.com/zhaoolee/notes/compare/1.11.1...1.11.2) - 2026-10-08",
      content: [
        /复制到公众号.*列表.*空行.*视觉间距.*额外列表项目.*正文空行/s,
        /### 安全[\s\S]*sharp.*SVG.*GHSA-wq5f-xc86-pv6w/s,
      ],
    },
    {
      version: "1.11.1",
      heading:
        "[1.11.1](https://github.com/zhaoolee/notes/compare/1.11.0...1.11.1) - 2026-10-06",
      content: [
        /复制到公众号.*发布草稿.*行高.*手机端.*重叠.*署名.*换行/s,
        /### 安全[\s\S]*更新代理地址解析依赖.*客户端 IP 伪造漏洞/,
      ],
    },
    {
      version: "1.11.0",
      heading:
        "[1.11.0](https://github.com/zhaoolee/notes/compare/1.10.7...1.11.0) - 2026-10-06",
      content: [
        /网页编辑器.*Ctrl\+S.*Cmd\+S.*手动保存.*拦截.*本地工作区/s,
        /图片.*塌缩.*删除.*操作按钮/s,
      ],
    },
    {
      version: "1.10.7",
      heading:
        "[1.10.7](https://github.com/zhaoolee/notes/compare/1.10.6...1.10.7) - 2026-10-02",
      content: [/公众号.*Markdown 列表.*空行.*多余圆点.*列表外.*正文空行/s],
    },
    {
      version: "1.10.6",
      heading:
        "[1.10.6](https://github.com/zhaoolee/notes/compare/1.10.5...1.10.6) - 2026-09-29",
      content: [/公众号.*Markdown 空行.*完整高度.*普通换行.*连续空行/s],
    },
    {
      version: "1.10.5",
      heading:
        "[1.10.5](https://github.com/zhaoolee/notes/compare/1.10.4...1.10.5) - 2026-09-26",
      content: [/公众号草稿.*Markdown 小标题前后的连续空行.*换行.*分节时丢失/s],
    },
    {
      version: "1.10.4",
      heading:
        "[1.10.4](https://github.com/zhaoolee/notes/compare/1.10.3...1.10.4) - 2026-09-26",
      content: [/公众号.*连续 Markdown 空行.*占位段落.*正常字重.*加粗文字/s],
    },
    {
      version: "1.10.3",
      heading:
        "[1.10.3](https://github.com/zhaoolee/notes/compare/1.10.2...1.10.3) - 2026-09-12",
      content: [/微信公众号草稿.*直接上传原图.*七牛中转.*复用.*首图.*GIF/s],
    },
    {
      version: "1.10.2",
      heading:
        "[1.10.2](https://github.com/zhaoolee/notes/compare/1.10.1...1.10.2) - 2026-09-12",
      content: [/锤子明暗主题.*双线纸框.*装饰表格.*虚线.*额外表格边框/s],
    },
    {
      version: "1.10.1",
      heading:
        "[1.10.1](https://github.com/zhaoolee/notes/compare/1.10.0...1.10.1) - 2026-08-29",
      content: [/GIF 动图.*微信公众号草稿.*单帧静态图片.*原始动画.*首图封面.*重复上传/s],
    },
    {
      version: "1.10.0",
      heading:
        "[1.10.0](https://github.com/zhaoolee/notes/compare/1.9.1...1.10.0) - 2026-08-25",
      content: [/AI 辅助审阅.*可同时勾选.*同一轮 AI 请求.*正文段落.*微信.*行高.*引用/s],
    },
    {
      version: "1.9.1",
      heading:
        "[1.9.1](https://github.com/zhaoolee/notes/compare/1.9.0...1.9.1) - 2026-08-24",
      content: [
        /老罗巴扎嘿.*OPPO Sans.*PNG.*文泉驿正黑.*Liberation Sans.*网页预览.*离线归档.*微信公众号富文本/s,
      ],
    },
    {
      version: "1.9.0",
      heading:
        "[1.9.0](https://github.com/zhaoolee/notes/compare/1.8.4...1.9.0) - 2026-08-24",
      content: [
        /老罗巴扎嘿.*Bear 便签.*editing-skill.*网页预览.*保存图片.*离线归档.*微信公众号富文本/s,
      ],
    },
    {
      version: "1.8.4",
      heading:
        "[1.8.4](https://github.com/zhaoolee/notes/compare/1.8.3...1.8.4) - 2026-08-22",
      content: [/引用.*默认灰色左边线.*主题大引号.*Telegra\.ph.*清除.*引用边框和缩进/s],
    },
    {
      version: "1.8.3",
      heading:
        "[1.8.3](https://github.com/zhaoolee/notes/compare/1.8.2...1.8.3) - 2026-08-22",
      content: [/无正文图片.*ENOENT.*前 20 个可见字符.*当前主题.*专属封面.*不再依赖.*固定 Logo/s],
    },
    {
      version: "1.8.2",
      heading:
        "[1.8.2](https://github.com/zhaoolee/notes/compare/1.8.1...1.8.2) - 2026-08-22",
      content: [/iPhone.*Bear.*Telegra\.ph.*四角表格.*36600.*11913.*40%/s],
    },
    {
      version: "1.8.1",
      heading:
        "[1.8.1](https://github.com/zhaoolee/notes/compare/1.8.0...1.8.1) - 2026-08-22",
      content: [/公众号主题.*段落样式.*超过 2 万字符.*继承.*缩短 HTML/s],
    },
    {
      version: "1.8.0",
      heading:
        "[1.8.0](https://github.com/zhaoolee/notes/compare/1.7.2...1.8.0) - 2026-08-22",
      content: [/每个登录账号.*AppID.*AppSecret.*发布为公众号草稿/s],
    },
    {
      version: "1.7.2",
      heading:
        "[1.7.2](https://github.com/zhaoolee/notes/compare/1.7.1...1.7.2) - 2026-08-18",
      content: [/桌面分享预览.*顶部操作按钮.*文字.*单行显示/s],
    },
    {
      version: "1.7.1",
      heading:
        "[1.7.1](https://github.com/zhaoolee/notes/compare/1.7.0...1.7.1) - 2026-08-17",
      content: [/粘贴普通网址.*远程图片.*正文.*图片导入流程/s],
    },
    {
      version: "1.7.0",
      heading:
        "[1.7.0](https://github.com/zhaoolee/notes/compare/1.6.1...1.7.0) - 2026-08-17",
      content: [/DeepSeek Harness.*Apple 原生导航栏.*Markdown 加粗/s],
    },
    {
      version: "1.6.1",
      heading:
        "[1.6.1](https://github.com/zhaoolee/notes/compare/1.6.0...1.6.1) - 2026-08-05",
      content: [/宣传页.*嵌套路由.*静态资源.*空白/],
    },
    {
      version: "1.6.0",
      heading:
        "[1.6.0](https://github.com/zhaoolee/notes/compare/1.5.1...1.6.0) - 2026-08-05",
      content: [/单图聚焦.*多页层叠.*2048 × 920.*高清 PNG/],
    },
    {
      version: "1.5.1",
      heading:
        "[1.5.1](https://github.com/zhaoolee/notes/compare/1.5.0...1.5.1) - 2026-08-05",
      content: [/Bear 主题.*粗体.*超链接.*另外五种主题/],
    },
    {
      version: "1.5.0",
      heading:
        "[1.5.0](https://github.com/zhaoolee/notes/compare/1.4.0...1.5.0) - 2026-08-05",
      content: [/第六种.*Telegra\.ph.*公众号复制/],
    },
    {
      version: "1.4.0",
      heading:
        "[1.4.0](https://github.com/zhaoolee/notes/compare/1.3.3...1.4.0) - 2026-08-05",
      content: [/五种便签样式.*相互隔离/],
    },
    {
      version: "1.3.3",
      heading:
        "[1.3.3](https://github.com/zhaoolee/notes/compare/1.3.2...1.3.3) - 2026-08-04",
      content: [/公众号.*过大过粗/],
    },
    {
      version: "1.3.2",
      heading:
        "[1.3.2](https://github.com/zhaoolee/notes/compare/1.3.1...1.3.2) - 2026-08-03",
      content: [/跨端同步文章排序/],
    },
    {
      version: "1.3.1",
      heading:
        "[1.3.1](https://github.com/zhaoolee/notes/compare/1.3.0...1.3.1) - 2026-08-03",
      content: [/AI“重点加粗”/],
    },
    {
      version: "1.3.0",
      heading:
        "[1.3.0](https://github.com/zhaoolee/notes/compare/1.2.0...1.3.0) - 2026-08-02",
      content: [/导出全部便签/],
    },
    {
      version: "1.2.0",
      heading:
        "[1.2.0](https://github.com/zhaoolee/notes/compare/1.1.0...1.2.0) - 2026-08-02",
      content: [/设置新增.*关于.*GitHub 开源地址和更新日志/s],
    },
    {
      version: "1.1.0",
      heading:
        "[1.1.0](https://github.com/zhaoolee/notes/compare/1.0.0...1.1.0) - 2026-08-02",
      content: [/自动适应.*浅色.*深色/s],
    },
  ];

  assert.equal(sections[0]?.heading, "");
  assert.match(sections[0]?.content ?? "", /^# 更新日志/m);
  if (hasUnreleasedSection) {
    assert.equal(
      sections[1]?.heading,
      `[未发布](https://github.com/zhaoolee/notes/compare/${packageVersion.version}...HEAD)`,
    );
  }

  assert.deepEqual(
    releaseHeadings,
    releases.map((release) => release.version),
  );

  for (const release of releases) {
    const section = sections.find((candidate) =>
      candidate.heading.startsWith(`[${release.version}](`),
    );

    assert.ok(section, `未找到版本 ${release.version} 的更新日志分节`);
    assert.equal(section.heading, release.heading);

    for (const pattern of release.content) {
      assert.match(section.content, pattern);
    }
  }
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
