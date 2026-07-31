import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectEditorImagePreviews,
  splitEditorContent,
} from "../../src/lib/editor-images.js";

test("编辑态实时收集 Markdown 与 HTML 图片并保留源码位置", () => {
  const markdown = [
    "第一段",
    "![产品截图](/images/demo.png)",
    '<img src="https://cdn.example.test/photo.jpg" alt="照片">',
  ].join("\n");
  const previews = collectEditorImagePreviews(markdown);

  assert.deepEqual(
    previews.map(({ alt, source }) => ({ alt, source })),
    [
      { alt: "产品截图", source: "/images/demo.png" },
      { alt: "照片", source: "https://cdn.example.test/photo.jpg" },
    ],
  );
  assert.equal(
    markdown.slice(previews[0].markerStart, previews[0].markerEnd),
    "![产品截图](/images/demo.png)",
  );
  assert.equal(
    markdown.slice(previews[1].markerStart, previews[1].markerEnd),
    '<img src="https://cdn.example.test/photo.jpg" alt="照片">',
  );
});

test("图片标记被拆成正文流内的独立块，并保留图片前后的可编辑文字", () => {
  const markdown = [
    "图片前",
    "![产品截图](/images/demo.png)",
    "图片中",
    '<img src="https://cdn.example.test/photo.jpg" alt="照片">',
    "图片后",
  ].join("\n");
  const blocks = splitEditorContent(markdown);

  assert.deepEqual(
    blocks.map((block) =>
      block.kind === "text"
        ? { kind: block.kind, text: block.text }
        : { kind: block.kind, source: block.source },
    ),
    [
      { kind: "text", text: "图片前\n" },
      { kind: "image", source: "/images/demo.png" },
      { kind: "text", text: "\n图片中\n" },
      { kind: "image", source: "https://cdn.example.test/photo.jpg" },
      { kind: "text", text: "\n图片后" },
    ],
  );
  assert.equal(
    blocks
      .map((block) =>
        block.kind === "text"
          ? block.text
          : markdown.slice(block.markerStart, block.markerEnd),
      )
      .join(""),
    markdown,
  );
});

test("编辑器以内联图片块复刻锤子便签，并保留原生 textarea 输入控件", () => {
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(editorSource, /splitEditorContent\(markdown\)/);
  assert.match(editorSource, /className="markdown-editor-flow"/);
  assert.match(editorSource, /className="editor-image-block"/);
  assert.match(editorSource, /className="markdown-editor editor-text-segment"/);
  assert.match(editorSource, /focusAfterImage\(block\.markerEnd\)/);
  assert.match(editorSource, /removeAdjacentImage\(/);
  assert.match(editorSource, /snapImageBlockToLineGrid\(/);
  assert.doesNotMatch(editorSource, /contentEditable/);
  assert.doesNotMatch(editorSource, /editor-image-previews/);
  assert.match(
    styles,
    /\.markdown-editor-flow\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    styles,
    /\.editor-image-block\s*\{[^}]*margin:[^;}]*calc\(var\(--editor-gutter-width\) \+ 24px\);[^}]*background:\s*var\(--note-image-mat\);/s,
  );
  assert.match(
    styles,
    /\.editor-image-handle\s*\{[^}]*top:\s*14px;[^}]*right:\s*-13px;[^}]*width:\s*32px;[^}]*height:\s*32px;/s,
  );
  assert.match(styles, /--editor-image-grid-spacer/);
});
