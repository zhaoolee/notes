import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteSheet } from "../../src/components/NoteSheet.js";
import {
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
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );

  assert.match(html, /class="note-sheet"/);
  assert.match(html, /<strong>0x01<\/strong>/);
  assert.match(html, /支持 <strong>粗体<\/strong> 与 <code>代码<\/code>。/);
  assert.match(html, /由测试发送/);
  assert.match(html, /via Feedback/);
});
