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

test("splitSections 可为公众号保留 H2 前后的原始空行", () => {
  const sections = splitSections(
    "第一段\n\n\n## 第一节\n\n\n第二段",
    { preserveHeadingBlankLines: true },
  );

  assert.deepEqual(sections, [
    { heading: "", content: "第一段\n\n" },
    { heading: "第一节", content: "\n\n第二段" },
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

test("公众号空行预处理不把列表分隔行变成占位段落", () => {
  const markdown = "前文\n\n- 第一项\n\n- 第二项\n\n后文\n\n结尾";
  const prepared = preserveMarkdownBlankLines(markdown, {
    suppressListAdjacentBlankLines: true,
  });

  assert.equal(
    prepared,
    `前文\n\n- 第一项\n- 第二项\n\n后文\n\n${MARKDOWN_BLANK_LINE}\n\n结尾`,
  );
  assert.equal(preserveMarkdownBlankLines("- 第一项\n\n- 第二项"),
    `- 第一项\n\n${MARKDOWN_BLANK_LINE}\n\n- 第二项`);
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
    /\.sheet-frame\s*\{[^}]*--sheet-frame-offset:\s*0px;[^}]*inset:[^}]*calc\(16px \* var\(--note-scale\) \+ var\(--sheet-frame-offset\)\)[^}]*calc\(9\.6667px \* var\(--note-scale\) \+ var\(--sheet-frame-offset\)\)[^}]*calc\(58px \* var\(--note-scale\) \+ var\(--sheet-frame-offset\)\);/s,
    /\.sheet-frame-inner\s*\{[^}]*--sheet-frame-offset:\s*calc\(2px \* var\(--note-scale\)\);/s,
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

test("WechatArticle 明暗纸框不触发微信表格加工且只包含双框和四角", () => {
  for (const theme of ["default", "smartisan-dark"] as const) {
    const html = renderToStaticMarkup(
      createElement(WechatArticle, {
        footerBrand: "由测试发送",
        footerHammerUrl: "https://cdn.example.com/hammer.png",
        footerVia: "via Feedback",
        theme,
        markdown: "# 纸框回归\n\n正文没有表格，导出不能引入装饰表格。",
      }),
    );

    assert.doesNotMatch(html, /<(?:table|caption|colgroup|col|tbody|tr|td)\b/);
    assert.equal((html.match(/data-smartisan-frame="outer"/g) ?? []).length, 1);
    assert.equal((html.match(/data-smartisan-frame="inner"/g) ?? []).length, 1);
    assert.equal((html.match(/data-smartisan-corner=/g) ?? []).length, 4);
    const borders = [...html.matchAll(/border:1px solid ([^;"<>]+)/g)];
    assert.equal(borders.length, 6, "只有内外两框与四个角方格带边框");
    assert.equal(new Set(borders.map((match) => match[1])).size, 1);
    assert.doesNotMatch(html, /dashed|dotted|position:absolute/);
    assert.match(html, /data-smartisan-corners="top"[^>]*margin:0 0 -1px/);
    assert.match(html, /data-smartisan-corners="bottom"[^>]*margin:-1px 0 0/);
  }
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
  assert.match(
    html,
    /<section data-smartisan-frame="outer" style="[^"]*margin:0 5px;padding:2\.8px;border:1px solid #e8e4dc/,
  );
  assert.doesNotMatch(html, /<table data-smartisan-frame=/);
  assert.doesNotMatch(html, /<(?:caption|colgroup)\b/);
  assert.equal((html.match(/<table\b/g) ?? []).length, 1, "保留正文的真实 Markdown 表格");
  assert.match(
    html,
    /data-smartisan-frame="inner" style="[^"]*padding:44\.1px 27\.7666px 19\.6px[^"]*background-color:#fffcf7/,
  );
  assert.match(
    html,
    /data-smartisan-theme="default" style="[^"]*color:#665749[^"]*font-size:15px[^"]*line-height:26\.25px[^"]*white-space:pre-wrap/,
  );
  assert.doesNotMatch(html, /-webkit-text-stroke/);
  assert.match(html, /<span data-smartisan-corner="top-left"/);
  assert.doesNotMatch(
    html,
    /data-smartisan-corner="[^"]+"[^>]*position:absolute/,
  );
  assert.match(html, /font-weight:400/);
  assert.doesNotMatch(html, /<header[^>]*text-align:center/);
  assert.match(
    html,
    /<p style="margin:0;font-size:15px;line-height:26\.25px;font-weight:400;text-align:center">公众号居中正文<\/p>/,
  );
  assert.match(
    html,
    /<h1 style="[^"]*font-weight:600[^"]*font-size:22px[^"]*">公众号一级标题<\/h1>/,
  );
  assert.match(
    html,
    /<h2 style="[^"]*font-weight:600[^"]*font-size:17px[^"]*line-height:23\.8px[^"]*"><strong[^>]*font-weight:600[^>]*>0x01<\/strong><\/h2>/,
  );
  assert.doesNotMatch(html, /<header[^>]*border-bottom/);
  assert.match(
    html,
    /<blockquote style="[^"]*margin:11\.2px 0[^"]*padding:0[^"]*border:0[^"]*border-left:0[^"]*color:#c0b5a7[^"]*font-size:15px[^"]*line-height:24\.6px[^"]*font-style:normal/,
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
    /<p style="margin:0;font-size:15px;line-height:26\.25px;font-weight:400">正文包含/,
  );
  assert.match(
    html,
    /data-smartisan-theme="default" style="[^"]*color:#665749[^"]*font-size:15px[^"]*line-height:26\.25px/,
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
    /<section data-smartisan-footer="true" style="[^"]*margin:42px 14px 0[^"]*font-size:11\.2px[^"]*line-height:14\.336px[^"]*white-space:normal/,
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
    const expectedBodyFontSizePx = style.layout === "telegraph" ? 18 : 15;
    const expectedBodyLineHeightRatio =
      style.layout === "telegraph"
        ? 1.58
        : style.layout === "bear"
          ? 1.755
          : style.layout === "bazhahei"
            ? 1.8
            : 1.75;
    const expectedBodyLineHeight = `${Number(
      (expectedBodyFontSizePx * expectedBodyLineHeightRatio).toFixed(4),
    )}px`;
    assert.match(
      html,
      new RegExp(
        `<p style="margin:0;font-size:${expectedBodyFontSizePx}px;line-height:${expectedBodyLineHeight};font-weight:400">正文与`,
      ),
      `${theme} 的正文段落必须自行携带主题字号和 px 行高，不能只依赖父容器继承`,
    );
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
  assert.match(html, /font-size:18px;[^\"]*line-height:28\.44px/);
  assert.match(html, /font-size:32px;[^\"]*line-height:34px/);
  assert.match(
    html,
    /<p style="margin:0;min-height:28\.44px;line-height:28\.44px;font-size:18px;font-weight:400">\u2800<\/p>/,
  );
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

test("WechatArticle 长文只在段落重复微信需要的字号与行高且不超过长度限制", () => {
  const markdown = [
    "# 程序员狠话｜长度回归",
    ...Array.from({ length: 10 }, (_, index) =>
      [
        `## **0x${String(index + 1).padStart(2, "0")}**`,
        `> 话题：第 ${index + 1} 条长文章主题保持原有排版`,
        "这是一段用于验证公众号草稿长度的正文。系统应保留标题、引用、正文、链接与空行的主题样式，让段落直接携带行高，同时继续从文章容器继承字体、字号和颜色，避免为每一段重复写入整套内联声明。",
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
    Array.from(html).length < 17_000,
    `使用完整字号与行高保留空行后，十节长文的公众号 HTML 应少于 1.7 万字符，实际为 ${Array.from(html).length}`,
  );
  assert.equal((html.match(/<h2\b/g) ?? []).length, 10);
  assert.equal((html.match(/<blockquote\b/g) ?? []).length, 10);
  assert.equal((html.match(/来源：<a /g) ?? []).length, 10);
  assert.doesNotMatch(html, /data-smartisan-frame="outer"/);
  assert.doesNotMatch(html, /<p style="[^"]*font-family:/);
  assert.match(html, /<p style="margin:0;font-size:15px;line-height:26\.25px;font-weight:400">/);
  assert.match(
    html,
    /data-smartisan-theme="apple-notes" style="[^"]*font-size:15px[^"]*line-height:26\.25px[^"]*white-space:pre-wrap/,
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

  assert.match(bearHtml, /<p style="margin:0;min-height:26\.32px;line-height:26\.32px;font-size:15px;font-weight:400">\u2800<\/p>/);
  assert.match(bearHtml, /margin:0\.704em 0 0/);
  assert.match(bearHtml, /margin:0 0 0\.704em/);
  assert.match(defaultHtml, /<p style="margin:0;min-height:26\.25px;line-height:26\.25px;font-size:15px;font-weight:400">\u2800<\/p>/);
  assert.doesNotMatch(defaultHtml, /margin:0\.704em 0 0/);
  assert.doesNotMatch(defaultHtml, /margin:0 0 0\.704em/);
});

test("WechatArticle 连续空行有可保留的内容且正文与粗体字重分明", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "空行与字重测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "普通文字\n\n\n第二段 **重点** 后续",
      theme: "default",
    }),
  );

  assert.equal(
    (html.match(/<p style="margin:0;min-height:26\.25px;line-height:26\.25px;font-size:15px;font-weight:400">\u2800<\/p>/g) ?? [])
      .length,
    2,
  );
  assert.doesNotMatch(html, /<span style="display:block;height:0\.704em"><\/span>/);
  assert.match(
    html,
    /<p style="margin:0;font-size:15px;line-height:26\.25px;font-weight:400">第二段 <strong style="font-weight:600">重点<\/strong> 后续<\/p>/,
  );
});

test("WechatArticle 保留公众号草稿中小标题两侧的连续空行", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "小标题空行测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "第一段\n\n\n## 第一节\n\n\n第二段",
      theme: "default",
    }),
  );

  assert.equal(
    (html.match(/<p style="margin:0;min-height:26\.25px;line-height:26\.25px;font-size:15px;font-weight:400">\u2800<\/p>/g) ?? [])
      .length,
    4,
  );
});

test("WechatArticle 区分单次换行与真正的 Markdown 空行", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "换行与空行测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "第一行\n第二行\n\n第三行",
      theme: "default",
    }),
  );

  assert.match(html, /第一行<\/p>\s*<p style="margin:0;font-size:15px;line-height:26\.25px;font-weight:400">第二行<\/p>/);
  assert.equal((html.match(/>\u2800<\/p>/g) ?? []).length, 1);
  assert.match(html, /第二行<\/p>\s*<p style="margin:0;min-height:26\.25px;line-height:26\.25px;font-size:15px;font-weight:400">\u2800<\/p>\s*<p style="margin:0;font-size:15px;line-height:26\.25px;font-weight:400">第三行<\/p>/);
});

test("WechatArticle 列表项间的空行不会成为公众号中的空圆点", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "列表空行测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "## 想进步了\n\n国庆节推荐\n\n- 适合学生党\n\n- 适合自媒体\n\n- 适合办公党\n\n后续正文",
      theme: "default",
    }),
  );

  assert.equal((html.match(/<ul\b/g) ?? []).length, 1);
  assert.equal((html.match(/<li\b/g) ?? []).length, 3);
  assert.equal((html.match(/>\u2800<\/p>/g) ?? []).length, 1);
  assert.match(html, /适合学生党<\/li>\s*<li[^>]*>适合自媒体<\/li>\s*<li[^>]*>适合办公党<\/li>/);
  assert.doesNotMatch(html, /<li[^>]*>\s*(?:<p[^>]*>)?\u2800/);
});

test("WechatArticle 分节边界的列表空行不会产生空圆点", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "列表边界测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "## 第一节\n\n1. 第一项\n\n2. 第二项\n\n## 第二节\n\n普通正文",
      theme: "default",
    }),
  );

  assert.equal((html.match(/<ol\b/g) ?? []).length, 1);
  assert.equal((html.match(/<li\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<p[^>]*>\u2800<\/p>\s*<ol\b/);
  assert.doesNotMatch(html, /<\/ol>\s*<p[^>]*>\u2800<\/p>/);
});

test("WechatArticle 列表后接图片时不插入空圆点", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "列表图片测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "## 想进步了\n\n推荐\n\n- 适合学生党\n\n- 适合自媒体\n\n- 适合办公党\n\n![演示图](https://example.com/p.png)",
      theme: "default",
    }),
  );

  assert.equal((html.match(/<ul\b/g) ?? []).length, 1);
  assert.equal((html.match(/<li\b/g) ?? []).length, 3);
  assert.match(html, /适合办公党<\/li>\s*<\/ul>\s*<p[^>]*><span data-smartisan-image=/);
});

test("WechatArticle 列表项间的物理空行转为视觉间距而不是新的空列表项", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "列表间距测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "1. 第一条\n\n\n2. 第二条\n\n\n3. 第三条",
      theme: "default",
    }),
  );

  assert.equal((html.match(/<ol\b/g) ?? []).length, 1);
  assert.equal((html.match(/<li\b/g) ?? []).length, 3);
  assert.equal((html.match(/<p\b/g) ?? []).length, 0);
  assert.match(
    html,
    /<li[^>]*padding-bottom:52\.5px[^>]*>第一条<\/li><li[^>]*padding-bottom:52\.5px[^>]*>第二条<\/li><li[^>]*>第三条<\/li>/,
  );
  assert.equal((html.match(/<li[^>]*padding-bottom/g) ?? []).length, 2);
  // 容器内不能残留可能被微信加工为额外列表项目的换行文本节点或空占位段落。
  assert.doesNotMatch(html, /<\/li>\s*\n\s*<li/);
  assert.doesNotMatch(html, /<li[^>]*>\s*<\/li>/);
  assert.doesNotMatch(html, /\u2800/);
});

test("WechatArticle 紧凑列表不写间距且保持内联文本", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "紧凑列表测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- 一\n- 二\n- 三",
      theme: "default",
    }),
  );

  assert.equal((html.match(/<ul\b/g) ?? []).length, 1);
  assert.equal((html.match(/<li\b/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<li[^>]*padding-bottom/);
  assert.match(html, /<li[^>]*>一<\/li><li[^>]*>二<\/li><li[^>]*>三<\/li>/);
});

test("WechatArticle 按每个列表项的空行数写入不同间距", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "混合间距测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "1. a\n\n2. b\n\n\n\n3. c\n\n4. d",
      theme: "default",
    }),
  );

  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*>a<\/li><li[^>]*padding-bottom:78\.75px[^>]*>b<\/li><li[^>]*padding-bottom:26\.25px[^>]*>c<\/li><li[^>]*>d<\/li>/,
  );
});

test("WechatArticle 有序列表保留起始编号并单独计算间距", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "起始编号测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "7. 起\n\n\n8. 次",
      theme: "default",
    }),
  );

  assert.match(html, /<ol start="7"/);
  assert.equal((html.match(/<li\b/g) ?? []).length, 2);
  assert.match(
    html,
    /<li[^>]*padding-bottom:52\.5px[^>]*>起<\/li><li[^>]*>次<\/li>/,
  );
});

test("WechatArticle 嵌套列表分别记录各自空行间距", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "嵌套列表测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- 外层\n\n  - 内层一\n\n  - 内层二\n\n- 结尾",
      theme: "default",
    }),
  );

  assert.equal((html.match(/<ul\b/g) ?? []).length, 2);
  assert.equal((html.match(/<li\b/g) ?? []).length, 4);
  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*><p[^>]*>外层<\/p><ul/,
  );
  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*>内层一<\/li><li[^>]*>内层二<\/li>/,
  );
  assert.match(html, /<li[^>]*>结尾<\/li>/);
});

test("WechatArticle 多行与多段列表项保留段落结构", () => {
  const multilineHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "多行列表测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "1. 第一行\n   第二行\n\n2. 下一项",
      theme: "default",
    }),
  );

  assert.match(
    multilineHtml,
    /<li[^>]*padding-bottom:26\.25px[^>]*><p[^>]*>第一行<\/p><p[^>]*>第二行<\/p><\/li><li[^>]*>下一项<\/li>/,
  );

  const complexHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "多段列表测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "1. 第一段\n\n   第二段\n\n2. 下一项",
      theme: "default",
    }),
  );

  assert.match(
    complexHtml,
    /<li[^>]*padding-bottom:26\.25px[^>]*><p[^>]*>第一段<\/p><p[^>]*>第二段<\/p><\/li><li[^>]*>下一项<\/li>/,
  );
  assert.doesNotMatch(complexHtml, /\u2800/);
});

test("WechatArticle 列表内代码块保留空行且不插入占位段落", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "列表代码测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- 条目\n\n  ```text\n  第一行\n\n  第二行\n  ```\n\n- 其他",
      theme: "default",
    }),
  );

  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*><p[^>]*>条目<\/p><pre/,
  );
  assert.match(html, /第一行\n\n第二行/);
  assert.match(html, /<li[^>]*>其他<\/li>/);
  assert.doesNotMatch(html, /\u2800/);
});

test("WechatArticle 任务列表与行内空格保持原样", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "任务列表测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- [ ] 待办\n\n- [x] 完成",
      theme: "default",
    }),
  );

  assert.equal((html.match(/<input type="checkbox"/g) ?? []).length, 2);
  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*><input type="checkbox" disabled=""[^>]*\/> 待办<\/li>/,
  );
  assert.match(
    html,
    /<li[^>]*><input type="checkbox" disabled=""[^>]*checked=""[^>]*\/> 完成<\/li>/,
  );

  const spacesHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "行内空格测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- 保留  两个空格\n\n- 第二个",
      theme: "default",
    }),
  );

  assert.match(spacesHtml, /<li[^>]*>保留  两个空格<\/li>/);
});

test("WechatArticle 紧凑列表保留格式化节点之间的行内空格", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "紧凑行内空格测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- **one** *two* `three`\n- second",
      theme: "default",
    }),
  );

  // strong → em 边界可能存在 WORD JOINER，但分隔普通空格必须保留。
  assert.match(
    html,
    /<li[^>]*><strong[^>]*>one<\/strong> \u2060?<em[^>]*>two<\/em> <code[^>]*>three<\/code><\/li><li[^>]*>second<\/li>/,
  );
  assert.doesNotMatch(html, /<\/strong><em/);
  assert.doesNotMatch(html, /<\/em><code/);
});

test("WechatArticle 松散列表保留格式化节点之间的行内空格", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "松散行内空格测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- **one** *two* `three`\n\n- second",
      theme: "default",
    }),
  );

  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*><strong[^>]*>one<\/strong> \u2060?<em[^>]*>two<\/em> <code[^>]*>three<\/code><\/li><li[^>]*>second<\/li>/,
  );
  assert.doesNotMatch(html, /<\/strong><em/);
  assert.doesNotMatch(html, /<\/em><code/);
});

test("WechatArticle 紧凑多行列表项保留行内换行", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "紧凑多行换行测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "- 第一行\n  第二行\n- 下一项",
      theme: "default",
    }),
  );

  assert.match(html, /<li[^>]*>第一行\n第二行<\/li><li[^>]*>下一项<\/li>/);
  assert.doesNotMatch(html, /第一行第二行/);
});

test("WechatArticle 列表内行内代码空白保持不变", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "行内代码空白测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "1. `code  with  spaces`\n\n2. next",
      theme: "default",
    }),
  );

  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*><code[^>]*>code  with  spaces<\/code><\/li><li[^>]*>next<\/li>/,
  );
});

test("WechatArticle 处理 CRLF 列表空行并去掉换行文本节点", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "CRLF 列表测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "1. 甲\r\n\r\n\r\n2. 乙",
      theme: "default",
    }),
  );

  assert.match(
    html,
    /<li[^>]*padding-bottom:52\.5px[^>]*>甲<\/li><li[^>]*>乙<\/li>/,
  );
  assert.doesNotMatch(html, /<\/li>\s*\n\s*<li/);
});

test("WechatArticle 保留列表外空行且跳过列表相邻空行", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "列表边界间距测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "前文\n\n\n列表前\n\n- 甲\n\n- 乙\n\n列表后\n\n\n结尾",
      theme: "default",
    }),
  );

  assert.equal((html.match(/>\u2800<\/p>/g) ?? []).length, 4);
  assert.match(
    html,
    /<li[^>]*padding-bottom:26\.25px[^>]*>甲<\/li><li[^>]*>乙<\/li>/,
  );
  assert.doesNotMatch(html, /<p[^>]*>\u2800<\/p>\s*<ul/);
  assert.doesNotMatch(html, /<\/ul>\s*<p[^>]*>\u2800<\/p>/);
});

test("WechatArticle 只用空行占位段落处理引用外侧而不进入引用内部", () => {
  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "引用空行测试",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "> 引用一\n>\n> 引用二\n\n正文",
      theme: "default",
    }),
  );

  assert.equal((html.match(/>\u2800<\/p>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<blockquote[^>]*>[\s\S]*?\u2800[\s\S]*?<\/blockquote>/);
});

test("WechatArticle 为七种主题的普通与居中正文写入明确字号和像素行高", () => {
  const themes = Object.keys(NOTE_CARD_THEME_STYLES) as NoteCardThemeId[];

  for (const theme of themes) {
    const style = NOTE_CARD_THEME_STYLES[theme];
    const bodyFontSizePx = style.layout === "telegraph" ? 18 : 15;
    const html = renderToStaticMarkup(
      createElement(WechatArticle, {
        footerBrand: "字号行高测试",
        footerHammerUrl: "https://cdn.example.com/hammer.png",
        footerVia: "via Feedback",
        markdown: "[居中正文]\n\n普通正文",
        theme,
      }),
    );

    for (const text of ["居中正文", "普通正文"]) {
      assert.match(
        html,
        new RegExp(
          `<p style="[^"]*font-size:${bodyFontSizePx}px[^"]*line-height:\\d+(?:\\.\\d+)?px[^"]*"[^>]*>${text}`,
        ),
        `${theme} 的“${text}”段落必须自带字号和 px 行高，避免微信重建段落后继承丢失`,
      );
    }
  }
});

test("WechatArticle 为长链接、长段落、无语言代码、引用标题和表格写入安全排版", () => {
  const markdown = [
    "# 一级标题",
    "",
    "## 二级标题",
    "",
    "### 三级标题",
    "",
    "#### 四级标题",
    "",
    "##### 五级标题",
    "",
    "###### 六级标题",
    "",
    "> ## 引用中的标题",
    "> ",
    "> 这是一段中文引用内容 English quoted content that is intentionally long enough to wrap on narrow phone screens without collapsing.",
    "",
    "这是一段中英文混合的长段落，包含一个很长的链接：[长链接](https://example.com/a/very/long/path/that/keeps/going?query=abcdefghijklmnopqrstuvwxyz) 以及 English words that should wrap naturally inside the WeChat editor without overlapping the next line.",
    "",
    "```",
    "const answer = 42;",
    "console.log(answer);",
    "```",
    "",
    "| 项目 | 状态 |",
    "| --- | --- |",
    "| 单元格 | 正常 |",
  ].join("\n");

  const html = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand:
        "很长的自定义署名，用于验证换行不会与 via 标记重叠-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown,
      theme: "default",
    }),
  );

  // 标题必须自带字号与 px 行高。
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    const match = new RegExp(`<${tag} style="([^"]*)"`).exec(html);
    assert.ok(match, `${tag} 必须存在`);
    assert.match(match[1], /font-size:\d+(?:\.\d+)?px/, `${tag} 必须自带字号`);
    assert.match(
      match[1],
      /line-height:\d+(?:\.\d+)?px/,
      `${tag} 必须自带 px 行高`,
    );
  }

  // 引用中的标题行高按标题自身字号计算，而不是被压成正文行高。
  const quoteHeading = /<blockquote[\s\S]*?<h2 style="([^"]*)"/.exec(html);
  assert.ok(quoteHeading, "引用中必须保留标题");
  assert.match(quoteHeading[1], /font-size:17px/);
  assert.match(quoteHeading[1], /line-height:27\.88px/);

  // 长段落与长链接仍直接携带正文的字号和 px 行高。
  const longParagraph = /<p style="([^"]*)"[^>]*>这是一段中英文混合的长段落/.exec(
    html,
  );
  assert.ok(longParagraph, "长段落必须存在");
  assert.match(longParagraph[1], /font-size:15px/);
  assert.match(longParagraph[1], /line-height:26\.25px/);
  assert.match(
    html,
    /<a href="https:\/\/example\.com\/a\/very\/long\/path\/that\/keeps\/going\?query=abcdefghijklmnopqrstuvwxyz" style=/,
  );

  // 无语言代码围栏的 code 字号和行高必须与 pre 一致，不能被相对字号放大。
  const codeBlock =
    /<pre style="([^"]*)"[^>]*>\s*<code(?: class="[^"]*")? style="([^"]*)"/.exec(
      html,
    );
  assert.ok(codeBlock, "必须渲染无语言代码围栏");
  assert.match(codeBlock[1], /font-size:13px/);
  assert.match(codeBlock[1], /line-height:21\.06px/);
  assert.match(codeBlock[2], /font-size:13px/);
  assert.match(codeBlock[2], /line-height:21\.06px/);

  // 表格单元格自带字号与安全行高。
  for (const tag of ["th", "td"]) {
    const match = new RegExp(`<${tag} style="([^"]*)"`).exec(html);
    assert.ok(match, `${tag} 必须存在`);
    assert.match(match[1], /font-size:14px/, `${tag} 必须自带字号`);
    assert.match(
      match[1],
      /line-height:21\.28px/,
      `${tag} 必须自带 px 行高`,
    );
  }

  // 大引号行高不小于字号。
  const quoteMark = /<span aria-hidden="true" style="([^"]*)">“<\/span>/.exec(
    html,
  );
  assert.ok(quoteMark, "默认主题必须渲染大引号");
  assert.match(quoteMark[1], /font-size:26px/);
  assert.match(quoteMark[1], /line-height:26px/);

  // 四角装饰是真正的无文字装饰，且不再用零字号/零行高控布局。
  assert.doesNotMatch(html, /\u00a0/);
  assert.match(html, /<span data-smartisan-corner="top-left"[^>]*><\/span>/);
  for (const attr of ["data-smartisan-corner", "data-smartisan-corners"]) {
    for (const match of html.matchAll(
      new RegExp(`${attr}="[^"]+"[^>]*style="([^"]*)"`, "g"),
    )) {
      assert.doesNotMatch(match[1], /font-size:0(?:px)?(?:;|$)/);
      assert.doesNotMatch(match[1], /line-height:0(?:px)?(?:;|$)/);
    }
  }

  // 页脚不再用 font-size:0 控制布局，长署名允许换行，行高不小于最大字号。
  const footer = /<section data-smartisan-footer="true" style="([^"]*)"/.exec(
    html,
  );
  assert.ok(footer, "必须渲染页脚");
  assert.match(footer[1], /font-size:11\.2px/);
  assert.match(footer[1], /white-space:normal/);
  assert.doesNotMatch(footer[1], /font-size:0(?:px)?(?:;|$)/);
  const footerLineHeight = Number(
    /line-height:([\d.]+)px/.exec(footer[1])?.[1],
  );
  assert.ok(
    footerLineHeight >= 11.2,
    `页脚行高不能小于署名最大字号，实际为 ${footerLineHeight}px`,
  );
});

test("WechatArticle 的大引号行高不小于字号且 Bear 标记保持 18px", () => {
  const defaultHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "署名",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "> 引用内容",
      theme: "default",
    }),
  );
  const bearHtml = renderToStaticMarkup(
    createElement(WechatArticle, {
      footerBrand: "署名",
      footerHammerUrl: "https://cdn.example.com/hammer.png",
      footerVia: "via Feedback",
      markdown: "> 引用内容",
      theme: "bear",
    }),
  );

  const defaultMark = /<span aria-hidden="true" style="([^"]*)">“<\/span>/.exec(
    defaultHtml,
  );
  assert.ok(defaultMark);
  assert.match(defaultMark[1], /width:18px/);
  assert.match(defaultMark[1], /font-size:26px/);
  assert.match(defaultMark[1], /line-height:26px/);

  const bearMark = /<span aria-hidden="true" style="([^"]*)">▎<\/span>/.exec(
    bearHtml,
  );
  assert.ok(bearMark);
  assert.match(bearMark[1], /width:18px/);
  assert.match(bearMark[1], /font-size:18px/);
  assert.match(bearMark[1], /line-height:18px/);
});
