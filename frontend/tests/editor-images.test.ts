import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectEditorImagePreviews } from "../../src/lib/editor-images.js";

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

test("编辑器显示正文图片预览，点击缩略图可定位原 Markdown 标记", () => {
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    editorSource,
    /collectEditorImagePreviews\(markdown\)/,
  );
  assert.match(editorSource, /aria-label="正文图片实时预览"/);
  assert.match(
    editorSource,
    /focusImageMarker\(image\.markerStart, image\.markerEnd\)/,
  );
  assert.match(
    styles,
    /\.markdown-editor-frame\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s,
  );
  assert.match(
    styles,
    /\.editor-image-previews\s*\{[^}]*overflow-x:\s*auto;[^}]*background:\s*var\(--editor-paper-base\);/s,
  );
});
