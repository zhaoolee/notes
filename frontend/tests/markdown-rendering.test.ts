import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";
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
import {
  buildNoteCardThemeCssVariables,
  NOTE_CARD_THEME_STYLES,
} from "../../src/lib/note-card-theme-styles.js";
import type { NoteCardThemeId } from "../../src/types/app.js";

function readRgbaPngAlpha(
  png: Buffer,
  targetX: number,
  targetY: number,
): number {
  assert.equal(png.toString("ascii", 1, 4), "PNG");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  const idatChunks: Buffer[] = [];
  let offset = 8;

  while (offset < png.length) {
    const chunkLength = png.readUInt32BE(offset);
    const chunkType = png.toString("ascii", offset + 4, offset + 8);
    const chunkDataStart = offset + 8;

    if (chunkType === "IDAT") {
      idatChunks.push(png.subarray(chunkDataStart, chunkDataStart + chunkLength));
    }

    offset = chunkDataStart + chunkLength + 4;
  }

  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6);
  assert.ok(targetX >= 0 && targetX < width);
  assert.ok(targetY >= 0 && targetY < height);

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(idatChunks));
  const decoded = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (stride + 1)];
    const sourceStart = y * (stride + 1) + 1;
    const rowStart = y * stride;

    for (let x = 0; x < stride; x += 1) {
      const source = filtered[sourceStart + x];
      const left = x >= bytesPerPixel ? decoded[rowStart + x - bytesPerPixel] : 0;
      const above = y > 0 ? decoded[rowStart + x - stride] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? decoded[rowStart + x - stride - bytesPerPixel]
          : 0;
      const paethBase = left + above - upperLeft;
      const paethLeft = Math.abs(paethBase - left);
      const paethAbove = Math.abs(paethBase - above);
      const paethUpperLeft = Math.abs(paethBase - upperLeft);
      const predictor =
        paethLeft <= paethAbove && paethLeft <= paethUpperLeft
          ? left
          : paethAbove <= paethUpperLeft
            ? above
            : upperLeft;
      const reconstructed =
        filter === 0
          ? source
          : filter === 1
            ? source + left
            : filter === 2
              ? source + above
              : filter === 3
                ? source + Math.floor((left + above) / 2)
                : source + predictor;

      assert.ok(filter >= 0 && filter <= 4);
      decoded[rowStart + x] = reconstructed & 0xff;
    }
  }

  return decoded[targetY * stride + targetX * bytesPerPixel + 3];
}

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

test("splitSections 将 H2 边界空行交给标题间距而不渲染在标题下方", () => {
  const sections = splitSections(
    [
      "标题前正文",
      "",
      "",
      "## 第一节",
      "",
      "",
      "第一节正文",
      "",
      "## 第二节",
      "",
      "第二节正文",
    ].join("\n"),
  );

  assert.deepEqual(sections, [
    { heading: "", content: "标题前正文" },
    { heading: "第一节", content: "第一节正文" },
    { heading: "第二节", content: "第二节正文" },
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
  assert.doesNotMatch(html, /is-default-footer-logo/);
});

test("二级标题保持 H2 语义且数字开头不会误判为有序列表", () => {
  const html = renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections("正文\n## 1. **开发了自己的 APP**\n标题后正文"),
      footerBrand: createElement("span", null, "由测试发送"),
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );

  assert.match(
    html,
    /<header class="note-index"><h2>1\. <strong>开发了自己的 APP<\/strong><\/h2><\/header>/,
  );
  assert.doesNotMatch(html, /<header class="note-index"><ol>/);
});

test("暗黑主题只降低内置便签 Logo 的亮度，不强制改色自定义 Logo", () => {
  const defaultHtml = renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections("暗黑页脚"),
      footerBrand: createElement("span", null, "由测试发送"),
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    defaultHtml,
    /class="sheet-footer-icon is-default-footer-logo"/,
  );
  assert.match(
    styles,
    /:root\[data-theme="smartisan-dark"\]\s*\{[^}]*--default-footer-logo-filter:\s*grayscale\(1\) brightness\(0\.56\) contrast\(2\.4\);[^}]*--default-footer-logo-opacity:\s*0\.72;/s,
  );
  assert.match(
    styles,
    /\.sheet-footer-icon\.is-default-footer-logo img,[\s\S]*\.settings-footer-preview-copy img\.is-default-footer-logo,[\s\S]*\.settings-footer-logo-card > img\.is-default-footer-logo\s*\{[^}]*filter:\s*var\(--default-footer-logo-filter\);[^}]*opacity:\s*var\(--default-footer-logo-opacity\);/s,
  );
});

test("成品便签锁定官方短便签的正文、边框与署名比例", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  const archiveSource = readFileSync("server/index.ts", "utf8");
  const defaultArchiveThemeCss = buildNoteCardThemeCssVariables("default");

  for (const token of [
    "--paper: #fffcf7;",
    "--sheet-surface: #fffcf7;",
    "--note-frame: #e8e4dc;",
    "--note-copy: #665749;",
  ]) {
    assert.ok(styles.includes(token));
    assert.ok(defaultArchiveThemeCss.includes(token));
  }

  assert.match(archiveSource, /buildNoteCardThemeCssVariables\(theme\)/);

  for (const pattern of [
    /\.sheet-frame-outer\s*\{[^}]*calc\(16px \* var\(--note-scale\)\)[^}]*calc\(9\.6667px \* var\(--note-scale\)\)[^}]*calc\(58px \* var\(--note-scale\)\);/s,
    /\.sheet-frame-inner\s*\{[^}]*calc\(18\.6667px \* var\(--note-scale\)\)[^}]*calc\(11\.6667px \* var\(--note-scale\)\)[^}]*calc\(59\.6667px \* var\(--note-scale\)\);/s,
    /\.sheet-inner\s*\{[^}]*calc\(34px \* var\(--note-scale\)\)[^}]*calc\(16px \* var\(--note-scale\)\)[^}]*calc\(14px \* var\(--note-scale\)\);/s,
    /\.note-copy\s*\{[^}]*font-size:\s*calc\(0\.76rem \* var\(--note-scale\)\);[^}]*font-weight:\s*400;[^}]*line-height:\s*1\.8;[^}]*letter-spacing:\s*0\.03em;[^}]*-webkit-text-stroke:\s*calc\(0\.15px \* var\(--note-scale\)\)\s*color-mix\(in srgb, currentColor 62%, transparent\);/s,
    /\.note-copy blockquote\s*\{[^}]*margin:\s*calc\(8px \* var\(--note-scale\)\)\s*0\s*calc\(8px \* var\(--note-scale\)\);/s,
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

test("NoteSheet 为首个居中 H1 使用上窄下宽的文档标题间距", () => {
  const html = renderToStaticMarkup(
    createElement(NoteSheet, {
      notes: splitSections("[# **主标题**]\n正文\n\n## 小标题"),
      footerBrand: createElement("span", null, "由测试发送"),
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    html,
    /<article class="note-section is-document-title">[\s\S]*?<div class="note-centered-line"><h1><strong>主标题<\/strong><\/h1><\/div><p>正文<\/p>/,
  );
  assert.match(
    styles,
    /\.note-section\.is-document-title\s*\{[^}]*margin-top:\s*calc\(-24px \* var\(--note-scale\)\);/s,
  );
  assert.match(
    styles,
    /\.note-section\.is-document-title \.note-centered-line\s*\{[^}]*margin-bottom:\s*calc\(10px \* var\(--note-scale\)\);/s,
  );
});

test("WechatArticle 生成公众号可粘贴的内联样式富文本", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "由方圆小站发送",
      footerHammerUrl: "https://cdn.example.com/smartisan-hammer.png",
      footerVia: "via Notes Skill",
      theme: "default",
      markdown: [
        "[公众号居中正文]",
        "",
        "# 公众号一级标题",
        "",
        "## **0x01**",
        "",
        "> 话题：AI 理财建议",
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

  assert.match(html, /data-tool="开源版锤子便签"/);
  assert.match(html, /data-note-card-theme="default"/);
  assert.match(html, /data-smartisan-theme="default"/);
  assert.match(
    html,
    /data-smartisan-theme="default" style="[^"]*padding:0[^"]*background-color:transparent/,
  );
  assert.doesNotMatch(html, /background-color:rgba\(239,230,216,0\.95\)/);
  assert.match(html, /data-smartisan-paper="true"/);
  assert.match(
    html,
    /data-smartisan-paper="true" style="[^"]*padding:21px 9\.3334px 0[^"]*padding-bottom:12%[^"]*max-width:462px[^"]*border:0[^"]*background-color:#fffcf7/,
  );
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
  assert.match(html, /<td style="padding:2\.8px;border:0"><section data-smartisan-frame="inner"/);
  assert.match(
    html,
    /data-smartisan-frame="inner" style="[^"]*padding:44\.1px 27\.7666px 19\.6px[^"]*background-color:#fffcf7/,
  );
  assert.match(
    html,
    /data-smartisan-theme="default" style="[^"]*color:#665749[^"]*font-size:15px[^"]*line-height:1\.75[^"]*white-space:pre-wrap/,
  );
  assert.doesNotMatch(html, /-webkit-text-stroke/);
  assert.match(html, /<td data-smartisan-corner="top-left"/);
  assert.doesNotMatch(
    html,
    /data-smartisan-corner="[^"]+"[^>]*position:absolute/,
  );
  assert.match(html, /font-weight:400/);
  assert.doesNotMatch(html, /<header[^>]*text-align:center/);
  assert.match(
    html,
    /<p style="margin:0;text-align:center">公众号居中正文<\/p>/,
  );
  assert.match(
    html,
    /<h1 style="[^"]*font-weight:600[^"]*font-size:22px[^"]*">公众号一级标题<\/h1>/,
  );
  assert.match(
    html,
    /<h2 style="[^"]*font-weight:600[^"]*line-height:1\.4[^"]*font-size:17px[^"]*"><strong[^>]*font-weight:600[^>]*>0x01<\/strong><\/h2>/,
  );
  assert.doesNotMatch(html, /<header[^>]*border-bottom/);
  assert.match(
    html,
    /<blockquote style="[^"]*margin:11\.2px 0[^"]*padding:0[^"]*border:0[^"]*border-left:0[^"]*color:#c0b5a7[^"]*line-height:1\.64[^"]*font-style:normal/,
  );
  assert.match(
    html,
    /<span aria-hidden="true" style="[^"]*width:18px[^"]*font-size:26px[^>]*>“<\/span>话题：AI 理财建议/,
  );
  assert.match(html, /<strong[^>]*font-weight:600[^>]*>粗体<\/strong>/);
  assert.match(html, /<strong[^>]*>鼓励\u2060<\/strong>vibe coding/);
  assert.doesNotMatch(html, /<\/strong>[\u00a0\u2060]vibe coding/);
  assert.match(
    html,
    /<p style="margin:0">正文包含/,
  );
  assert.match(
    html,
    /data-smartisan-theme="default" style="[^"]*color:#665749[^"]*font-size:15px[^"]*line-height:1\.75/,
  );
  assert.match(html, /<a href="https:\/\/example\.com" style=/);
  assert.match(html, /data-smartisan-image="true"/);
  assert.match(html, /data-smartisan-image-frame="android"/);
  assert.match(html, /padding:4\.2px/);
  assert.match(html, /border:1px solid #ebe8e3/);
  assert.match(html, /background-color:#ffffff/);
  assert.match(html, /box-shadow:0 1\.4px 4\.2px rgba\(88,70,52,0\.07\)/);
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
  assert.match(html, /data-smartisan-image="true"[^>]*margin:16\.8px auto 2\.8px/);
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
    /<section data-smartisan-footer="true" style="[^"]*margin:42px 14px 0[^"]*font-size:0[^"]*line-height:14\.336px/,
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
  const footerHammerHash = createHash("sha256")
    .update(footerHammerAsset)
    .digest("hex");
  const serverSource = readFileSync("server/index.ts", "utf8");
  const pngColorType = footerHammerAsset[25];
  assert.equal(footerHammerAsset.readUInt32BE(16), 48);
  assert.equal(footerHammerAsset.readUInt32BE(20), 48);
  assert.ok(
    pngColorType === 4 ||
      pngColorType === 6 ||
      footerHammerAsset.includes(Buffer.from("tRNS")),
    "公众号底部锤子标识必须包含透明通道，避免暗黑模式出现浅色方块",
  );
  for (const [x, y] of [
    [0, 0],
    [47, 0],
    [0, 47],
    [47, 47],
  ]) {
    assert.equal(
      readRgbaPngAlpha(footerHammerAsset, x, y),
      0,
      `锤子标识四角必须透明：${x},${y}`,
    );
  }
  assert.equal(
    footerHammerHash,
    "b5d3bd9587fa9a1226b25a0709ff61a450df29d96ca2f127c6afc0b8e193a60e",
  );
  assert.match(
    serverSource,
    new RegExp(
      `https://notes\\.fangyuanxiaozhan\\.com/images/${footerHammerHash}\\.png`,
    ),
  );
  assert.doesNotMatch(html, /src="data:/);
  assert.doesNotMatch(html, /<li[^>]*>\s*<\/li>/);
  assert.doesNotMatch(html, /\[公众号居中正文\]/);
});

test("WechatArticle 为七种卡片主题生成互不共享的内联配色", () => {
  const themes = Object.keys(NOTE_CARD_THEME_STYLES) as NoteCardThemeId[];

  assert.deepEqual(themes, [
    "default",
    "smartisan-dark",
    "apple-notes",
    "apple-notes-light",
    "bear",
    "bazhahei",
    "telegraph",
  ]);

  for (const theme of themes) {
    const style = NOTE_CARD_THEME_STYLES[theme];
    const html = renderToStaticMarkup(
      createElement(WechatArticle, {
        footerBrand: "主题隔离测试",
        footerHammerUrl: "https://cdn.example.com/hammer.png",
        footerVia: "via Feedback",
        markdown: "> 引用\n\n正文与[链接](https://example.com)",
        theme,
      }),
    );

    assert.match(html, new RegExp(`data-note-card-theme="${theme}"`));
    assert.match(
      html,
      new RegExp(`background-color:${style.colors.paper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.match(
      html,
      new RegExp(`color:${style.colors.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.match(
      html,
      new RegExp(`color:${style.colors.accent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.equal(
      html.includes('data-note-apple-toolbar="true"'),
      style.layout === "apple",
    );
    assert.equal(html.includes(">▎</span>"), style.layout === "bear");
  }
});

test("WechatArticle 为老罗巴扎嘿保留暖色杂志排版", () => {
  assert.equal(
    NOTE_CARD_THEME_STYLES.bazhahei.fontFamily,
    NOTE_CARD_THEME_STYLES.default.fontFamily,
  );
  assert.equal(
    NOTE_CARD_THEME_STYLES.bazhahei.headingFontFamily,
    NOTE_CARD_THEME_STYLES.default.headingFontFamily,
  );

  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "老罗巴扎嘿排版测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "# 杂志标题\n\n## 核心判断\n\n> 摘要卡片\n\n正文与**重点**、[链接](https://example.com)",
      theme: "bazhahei",
    }),
  );

  assert.match(html, /data-note-card-theme="bazhahei"/);
  assert.match(html, /background-color:#faf9f5/);
  assert.match(html, /font-family:&quot;OPPOSans&quot;/);
  assert.match(html, /font-size:30px;[^\"]*text-align:center/);
  assert.match(html, />■ <\/span>核心判断/);
  assert.match(html, /background:#efe9de/);
  assert.match(html, /border-radius:8px/);
  assert.match(html, /<strong style="[^"]*color:#141413;[^"]*font-weight:700/);
  assert.match(html, /border-bottom:0\.1em solid #d4734b/);
  assert.doesNotMatch(html, />[“▎]<\/span>摘要卡片/);
});

test("WechatArticle 为 Telegra.ph 保留原站正文节奏与引用线", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "Telegra.ph 排版测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "# Telegraph 标题\n\n正文与[链接](https://example.com)\n\n> 引用内容",
      theme: "telegraph",
    }),
  );

  assert.match(html, /data-note-card-theme="telegraph"/);
  assert.match(html, /font-size:18px;[^\"]*line-height:1\.58/);
  assert.match(html, /line-height:1\.0625;[^\"]*font-size:32px/);
  assert.match(html, /height:0\.667em/);
  assert.match(html, /border-bottom:0\.1em solid rgba\(0,0,0,0\.7\)/);
  assert.match(html, /margin:18px 21px 16px 6px/);
  assert.match(html, /padding:0 0 0 15px/);
  assert.match(html, /border:0/);
  assert.match(html, /border-left:3px solid #000000/);
  assert.match(html, /font-style:italic/);
  assert.doesNotMatch(html, />[“▎]<\/span>引用内容/);
});

test("WechatArticle 只把 Bear 粗体渲染为链接红色", () => {
  const markdown = "普通正文，**重点文字**，以及[链接](https://example.com)";
  const bearHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "Bear 粗体测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown,
      theme: "bear",
    }),
  );
  const defaultHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "默认粗体测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown,
      theme: "default",
    }),
  );

  assert.match(
    bearHtml,
    /<strong style="[^"]*color:#dd4c4f;[^"]*font-weight:700[^"]*">重点文字<\/strong>/,
  );
  assert.match(
    bearHtml,
    /<a href="https:\/\/example\.com" style="[^"]*color:#dd4c4f[^"]*">链接<\/a>/,
  );
  assert.match(
    defaultHtml,
    /<strong style="font-weight:600">重点文字<\/strong>/,
  );
  assert.doesNotMatch(defaultHtml, /<strong style="[^"]*color:#dd4c4f/);
});

test("WechatArticle 让长文章继承主题样式而不是逐段重复到超过微信限制", () => {
  const markdown = [
    "# 程序员狠话｜长度回归",
    ...Array.from({ length: 10 }, (_, index) =>
      [
        `## **0x${String(index + 1).padStart(2, "0")}**`,
        `> 话题：第 ${index + 1} 条长文章主题保持原有排版`,
        "这是一段用于验证公众号草稿长度的正文。系统应保留标题、引用、正文、链接与空行的主题样式，同时让段落从文章容器继承相同的字体、字号、颜色和行高，避免为每一段重复写入完全相同的内联声明。",
        `来源：https://example.com/items/${index + 1}`,
      ].join("\n\n"),
    ),
  ].join("\n\n");
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "由方圆小站发送",
      footerHammerUrl: "https://cdn.example.com/smartisan-hammer.png",
      footerVia: "via Notes Skill",
      markdown,
      theme: "apple-notes",
    }),
  );

  assert.ok(
    Array.from(html).length < 13_000,
    `十节长文的公众号 HTML 应少于 1.3 万字符，实际为 ${Array.from(html).length}`,
  );
  assert.equal((html.match(/<h2\b/g) ?? []).length, 10);
  assert.equal((html.match(/<blockquote\b/g) ?? []).length, 10);
  assert.equal((html.match(/来源：<a /g) ?? []).length, 10);
  assert.doesNotMatch(html, /data-smartisan-frame="outer"/);
  assert.doesNotMatch(html, /<p style="[^"]*font-family:/);
  assert.match(
    html,
    /data-smartisan-theme="apple-notes" style="[^"]*font-size:15px[^"]*line-height:1\.75[^"]*white-space:pre-wrap/,
  );
});

test("WechatArticle 只为 Bear 收紧分节间隔并保持既有空行", () => {
  const markdown = "正文一\n\n正文二\n\n## Bear 分节\n\n正文三";
  const bearHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "Bear 排版测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown,
      theme: "bear",
    }),
  );
  const defaultHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "默认排版测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown,
      theme: "default",
    }),
  );

  assert.match(bearHtml, /height:0\.704em/);
  assert.match(bearHtml, /margin:0\.704em 0 0/);
  assert.match(bearHtml, /margin:0 0 0\.704em/);
  assert.match(defaultHtml, /height:0\.704em/);
  assert.doesNotMatch(defaultHtml, /margin:0\.704em 0 0/);
  assert.doesNotMatch(defaultHtml, /margin:0 0 0\.704em/);
});
