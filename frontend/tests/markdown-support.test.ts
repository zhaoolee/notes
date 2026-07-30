import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteSheet } from "../../src/components/NoteSheet.js";
import { splitSections } from "../../src/lib/markdown.js";

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

test("Markdown 兼容性矩阵生成预期语义结构", async () => {
  const markdown = await readFile(
    new URL("./markdown-support-visual.md", import.meta.url),
    "utf8",
  );
  const styles = await readFile("src/styles.css", "utf8");
  const notes = splitSections(markdown);
  const html = renderToStaticMarkup(
    createElement(NoteSheet, {
      notes,
      footerBrand: createElement("span", null, "Markdown Visual Test"),
      footerVia: createElement("span", null, "via Feedback"),
    }),
  );

  assert.equal(notes.length, 13);
  assert.equal(notes[1]?.heading, "01 行内文本");
  assert.equal(notes[12]?.heading, "12 综合嵌套");

  assert.match(html, /<h1>/);
  assert.match(html, /<h3>/);
  assert.match(html, /<h4>/);
  assert.match(html, /<h5>/);
  assert.match(html, /<h6>/);

  assert.match(html, /<strong>/);
  assert.match(html, /<em>/);
  assert.match(html, /<del>/);
  assert.match(html, /<code>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /href="https:\/\/example\.org"/);

  assert.ok(countMatches(html, /<blockquote>/g) >= 3);
  assert.match(
    styles,
    /\.note-copy blockquote\s*\{[^}]*margin:\s*calc\(8px \* var\(--note-scale\)\)\s*0\s*calc\(8px \* var\(--note-scale\)\);/s,
  );
  assert.ok(countMatches(html, /<ul/g) >= 4);
  assert.ok(countMatches(html, /<ol/g) >= 5);
  assert.match(html, /class="contains-task-list"/);
  assert.equal(countMatches(html, /type="checkbox"/g), 2);
  assert.equal(countMatches(html, /<pre>/g), 3);
  assert.match(html, /class="language-javascript"/);
  assert.match(html, /class="language-text"/);
  assert.match(html, /class="language-bash"/);

  assert.equal(countMatches(html, /<table>/g), 2);
  assert.match(html, /text-align:center/);
  assert.match(html, /text-align:right/);
  assert.match(html, /<hr\/>/);
  assert.match(html, /src="\/example-assets\/dog\.jpeg"/);

  assert.match(html, /data-footnotes/);
  assert.match(html, /id="user-content-fn-note"/);
  assert.match(html, /MARKDOWN_VISUAL_TEST_END/);

  assert.doesNotMatch(html, /<mark>HTML mark 标签<\/mark>/);
  assert.match(html, /&lt;mark&gt;HTML mark 标签&lt;\/mark&gt;/);
});
