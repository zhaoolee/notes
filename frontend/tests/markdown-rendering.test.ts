import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteSheet } from "../../src/components/NoteSheet.js";
import { WechatArticle } from "../../src/components/WechatArticle.js";
import {
  detachUnindentedImagesFromLists,
  MARKDOWN_BLANK_LINE,
  preserveMarkdownBlankLines,
  splitSections,
} from "../../src/lib/markdown.js";

test("splitSections 以二级标题拆分便签区块", () => {
  const sections = splitSections(
    [
      "标题前正文",
      "## **0x01**",
      "第一段",
      "## **0x02**",
      "第二段",
    ].join("\n"),
  );

  assert.deepEqual(sections, [
    {
      heading: "",
      content: "标题前正文",
    },
    {
      heading: "**0x01**",
      content: "第一段",
    },
    {
      heading: "**0x02**",
      content: "第二段",
    },
  ]);
});

test("splitSections 将首个方括号整行标记为仅居中的正文行", () => {
  const sections = splitSections(
    [
      "",
      "[**居中标题**]",
      "",
      "正文第一行",
      "[正文中的方括号保持原样]",
      "[链接](https://example.com)",
      "## 后续分区",
      "后续正文",
    ].join("\n"),
  );

  assert.deepEqual(sections, [
    {
      heading: "**居中标题**",
      headingAlignment: "center",
      content:
        "正文第一行\n[正文中的方括号保持原样]\n[链接](https://example.com)",
    },
    {
      heading: "后续分区",
      content: "后续正文",
    },
  ]);
});

test("preserveMarkdownBlankLines 保留正文空行但不改写代码块", () => {
  const markdown = [
    "正文",
    "",
    "```text",
    "代码第一行",
    "",
    "代码第二行",
    "```",
    "",
    "结尾",
  ].join("\n");

  const expected = [
    "正文",
    "",
    MARKDOWN_BLANK_LINE,
    "",
    "```text",
    "代码第一行",
    "",
    "代码第二行",
    "```",
    "",
    MARKDOWN_BLANK_LINE,
    "",
    "结尾",
  ].join("\n");

  assert.equal(preserveMarkdownBlankLines(markdown), expected);
});

test("NoteSheet 服务端渲染复用前端 Markdown 结构", () => {
  const html = renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections("## **0x01**\n支持 **粗体** 与 `代码`。"),
      footerBrand: createElement("span", null, "由测试发送"),
      footerLogoUrl: "/images/custom-footer-logo.png",
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );

  assert.match(html, /class="note-sheet"/);
  assert.match(html, /<strong>0x01<\/strong>/);
  assert.match(html, /支持 <strong>粗体<\/strong> 与 <code>代码<\/code>。/);
  assert.match(html, /由测试发送/);
  assert.match(html, /via Feedback/);
  assert.match(html, /src="\/images\/custom-footer-logo\.png"/);
});

test("成品便签锁定官方短便签的正文、边框与署名比例", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const archiveSource = readFileSync("server/index.ts", "utf8");

  for (const token of [
    "--paper: #fffcf7;",
    "--sheet-surface: #fffcf7;",
    "--note-frame: #e8e4dc;",
    "--note-copy: #665749;",
  ]) {
    assert.ok(styles.includes(token));
    assert.ok(archiveSource.includes(token));
  }

  for (const pattern of [
    /\.sheet-frame-outer\s*\{[^}]*calc\(16px \* var\(--note-scale\)\)[^}]*calc\(9\.6667px \* var\(--note-scale\)\)[^}]*calc\(58px \* var\(--note-scale\)\);/s,
    /\.sheet-frame-inner\s*\{[^}]*calc\(18\.6667px \* var\(--note-scale\)\)[^}]*calc\(11\.6667px \* var\(--note-scale\)\)[^}]*calc\(59\.6667px \* var\(--note-scale\)\);/s,
    /\.sheet-inner\s*\{[^}]*calc\(34px \* var\(--note-scale\)\)[^}]*calc\(16px \* var\(--note-scale\)\)[^}]*calc\(14px \* var\(--note-scale\)\);/s,
    /\.note-copy\s*\{[^}]*font-size:\s*calc\(0\.76rem \* var\(--note-scale\)\);[^}]*font-weight:\s*400;[^}]*line-height:\s*1\.8;[^}]*letter-spacing:\s*0\.03em;[^}]*-webkit-text-stroke:\s*calc\(0\.15px \* var\(--note-scale\)\)\s*color-mix\(in srgb, currentColor 62%, transparent\);/s,
    /\.sheet-footer\s*\{[^}]*calc\(30px \* var\(--note-scale\)\)[^}]*calc\(0\.6667px \* var\(--note-scale\)\);[^}]*calc\(16\.6667px \* var\(--note-scale\)\);/s,
    /\.sheet-footer-brand\s*\{[^}]*font-size:\s*calc\(0\.5rem \* var\(--note-scale\)\);/s,
    /\.sheet-footer-via\s*\{[^}]*font-size:\s*calc\(0\.42rem \* var\(--note-scale\)\);/s,
  ]) {
    assert.match(styles, pattern);
    assert.match(archiveSource, pattern);
  }
});

test("NoteSheet 将无缩进列表图片提升到正文层并相对便签居中", () => {
  const html = renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections(
        [
          "9. 用 AI 做出的原型，数据逻辑不自洽",
          "![配图](https://cdn.example.com/note.png)",
          "10. 下一条",
        ].join("\n"),
      ),
      footerBrand: createElement("span", null, "由测试发送"),
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    html,
    /<ol start="9">\s*<li>用 AI 做出的原型，数据逻辑不自洽<\/li>\s*<\/ol>\s*<p><img class="note-image-frame" data-smartisan-image-frame="android"/,
  );
  assert.match(html, /<ol start="10">\s*<li>下一条<\/li>\s*<\/ol>/);
  assert.doesNotMatch(
    html,
    /<li>用 AI 做出的原型，数据逻辑不自洽\s*<img class="note-image-frame"/,
  );
  assert.match(styles, /--note-image-frame:\s*#ebe8e3;/);
  assert.match(styles, /--note-image-mat:\s*#ffffff;/);
  assert.match(
    styles,
    /\.note-copy img\.note-image-frame\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-width:\s*100%;[^}]*padding:\s*calc\(3px \* var\(--note-scale\)\);[^}]*border:\s*1px solid var\(--note-image-frame\);/s,
  );
  assert.match(
    styles,
    /\.note-copy img\.note-image-frame\s*\{[^}]*box-shadow:[^}]*var\(--note-image-shadow\);[^}]*background:\s*var\(--note-image-mat\);/s,
  );
});

test("列表图片预处理不改写代码块和有意缩进的图片", () => {
  const markdown = [
    "1. 普通条目",
    "   ![有意嵌套](nested.png)",
    "2. 下一条",
    "```md",
    "3. 代码示例",
    "![代码图片](code.png)",
    "```",
  ].join("\n");

  assert.equal(detachUnindentedImagesFromLists(markdown), markdown);
});

test("NoteSheet 移除方括号并只对该正文行应用居中", () => {
  const html = renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections("[居中正文]\n正文"),
      footerBrand: createElement("span", null, "由测试发送"),
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );
  const styles = readFileSync("src/styles.css", "utf8");

  assert.doesNotMatch(html, /class="note-index/);
  assert.doesNotMatch(html, /<header/);
  assert.doesNotMatch(html, /<strong>/);
  assert.doesNotMatch(html, /\[居中正文\]/);
  assert.match(
    html,
    /<div class="note-copy"><div class="note-centered-line"><p>居中正文<\/p><\/div><p>正文<\/p><\/div>/,
  );
  assert.match(
    styles,
    /\.note-centered-line\s*\{\s*text-align:\s*center;\s*\}/,
  );
  assert.doesNotMatch(
    styles,
    /\.note-centered-line\s*\{[^}]*(?:font-size|font-weight|color|line-height|margin|padding):/s,
  );
});

test("WechatArticle 生成公众号可粘贴的内联样式富文本", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "由方圆小站发送",
      footerHammerUrl: "https://cdn.example.com/smartisan-hammer.png",
      footerVia: "via Notes Skill",
      markdown: [
        "[公众号居中正文]",
        "",
        "正文包含 **粗体**、[链接](https://example.com) 和图片。",
        "",
        "9. **鼓励**vibe coding，但只提供 coding plan。",
        "![配图](https://cdn.example.com/article.png)",
        "10. 图片后的编号仍可见。",
        "",
        "| 项目 | 状态 |",
        "| --- | --- |",
        "| 富文本 | 可复制 |",
        "",
        "12.",
      ].join("\n"),
    }),
  );

  assert.match(html, /data-tool="锤子便签Skill"/);
  assert.match(html, /data-smartisan-theme="warm-paper"/);
  assert.match(html, /data-smartisan-paper="true"/);
  assert.match(
    html,
    /data-smartisan-paper="true" style="[^"]*padding-bottom:12%[^"]*border:0[^"]*background-color:#fffcf7/,
  );
  assert.match(html, /background-color:rgba\(239,230,216,0\.95\)/);
  assert.match(html, /background-color:#fffcf7/);
  assert.match(html, /data-smartisan-frame="outer"/);
  assert.match(html, /data-smartisan-frame="inner"/);
  assert.equal((html.match(/data-smartisan-corner=/g) ?? []).length, 4);
  assert.match(html, /data-smartisan-corner="top-left"/);
  assert.match(html, /data-smartisan-corner="bottom-right"/);
  assert.match(html, /<table data-smartisan-frame="outer"/);
  assert.match(
    html,
    /<table data-smartisan-frame="outer"[^>]*style="[^"]*border:0/,
  );
  assert.match(html, /<col width="6" style="width:6px"\/><col\/><col width="6"/);
  assert.doesNotMatch(
    html,
    /data-smartisan-corner="[^"]+"[^>]*(?:rowSpan|colSpan)=/,
  );
  assert.equal(
    (
      html.match(
        /border-bottom:1px solid #e8e4dc/g,
      ) ?? []
    ).length,
    1,
  );
  assert.equal(
    (
      html.match(/border-left:1px solid #e8e4dc/g) ??
      []
    ).length,
    1,
  );
  assert.equal(
    (
      html.match(/border-right:1px solid #e8e4dc/g) ??
      []
    ).length,
    1,
  );
  assert.equal(
    (
      html.match(/border-top:1px solid #e8e4dc/g) ??
      []
    ).length,
    1,
  );
  assert.match(html, /<td style="padding:3px;border:0"><section data-smartisan-frame="inner"/);
  assert.match(html, /<td data-smartisan-corner="top-left"/);
  assert.doesNotMatch(
    html,
    /data-smartisan-corner="[^"]+"[^>]*position:absolute/,
  );
  assert.match(html, /font-weight:400/);
  assert.doesNotMatch(html, /<header[^>]*text-align:center/);
  assert.match(
    html,
    /<p style="[^"]*font-size:15px[^"]*font-weight:400[^"]*line-height:1\.68[^"]*text-align:center[^"]*">公众号居中正文<\/p>/,
  );
  assert.match(html, /<strong[^>]*>鼓励\u2060<\/strong>vibe coding/);
  assert.doesNotMatch(html, /<\/strong>[\u00a0\u2060]vibe coding/);
  assert.match(
    html,
    /<p style="[^"]*color:#665749[^"]*line-height:1\.68/,
  );
  assert.match(html, /<a href="https:\/\/example\.com" style=/);
  assert.match(html, /data-smartisan-image="true"/);
  assert.match(html, /data-smartisan-image-frame="android"/);
  assert.match(html, /padding:4px/);
  assert.match(html, /border:1px solid #ebe8e3/);
  assert.match(html, /background-color:#ffffff/);
  assert.match(html, /box-shadow:0 1px 4px rgba\(88,70,52,0\.07\)/);
  assert.match(
    html,
    /<ol start="9" style="[^"]*box-sizing:border-box[^"]*width:100% !important[^"]*max-width:100% !important[^"]*list-style-position:outside/,
  );
  assert.match(html, /<ol start="9"/);
  assert.match(html, /<ol start="10"/);
  assert.match(html, /图片后的编号仍可见。<\/li>/);
  assert.doesNotMatch(
    html,
    /<li\b[^>]*>(?:(?!<\/li>)[\s\S])*data-smartisan-image="true"/,
  );
  assert.match(
    html,
    /<\/ol>\s*<p style="[^"]*"><span data-smartisan-image="true"[^>]*margin:14px auto/,
  );
  assert.match(html, /data-smartisan-image="true"[^>]*margin:14px auto/);
  assert.doesNotMatch(html, /<li style="[^"]*overflow:hidden/);
  assert.match(
    html,
    /<img src="https:\/\/cdn\.example\.com\/article\.png"[^>]*width="100%"/,
  );
  assert.match(
    html,
    /width:100% !important;max-width:100% !important;height:auto !important/,
  );
  assert.match(html, /<table style=/);
  assert.match(html, /由方圆小站发送/);
  assert.match(html, /via Notes Skill/);
  assert.match(
    html,
    /<section data-smartisan-footer="true" style="[^"]*margin:11px 18px 0[^"]*font-size:0[^"]*line-height:16px/,
  );
  assert.doesNotMatch(html, /<footer(?:\s|>)/);
  assert.doesNotMatch(html, /<table data-smartisan-footer="true"/);
  assert.match(html, /data-smartisan-hammer="true"/);
  assert.match(
    html,
    /src="https:\/\/cdn\.example\.com\/smartisan-hammer\.png"/,
  );
  assert.match(
    html,
    /data-smartisan-hammer="true"[^>]*border-radius:50%;background-color:transparent;object-fit:contain/,
  );
  const footerHammerAsset = readFileSync(
    "public/smartisan/web/smartisan_hammer_footer.png",
  );
  const pngColorType = footerHammerAsset[25];
  assert.equal(footerHammerAsset.readUInt32BE(16), 48);
  assert.equal(footerHammerAsset.readUInt32BE(20), 48);
  assert.ok(
    pngColorType === 4 ||
      pngColorType === 6 ||
      footerHammerAsset.includes(Buffer.from("tRNS")),
    "公众号底部锤子标识必须包含透明通道，避免暗黑模式出现浅色方块",
  );
  assert.doesNotMatch(html, /src="data:/);
  assert.doesNotMatch(html, /<li[^>]*>\s*<\/li>/);
  assert.doesNotMatch(html, /\[公众号居中正文\]/);
});
