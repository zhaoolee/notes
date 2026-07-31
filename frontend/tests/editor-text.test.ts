import assert from "node:assert/strict";
import test from "node:test";
import {
  EDITOR_EMPTY_LINE_MARKER,
  editorOffsetToSourceOffset,
  sourceOffsetToEditorOffset,
  stripEditorDisplayMarkers,
  toEditorDisplayText,
} from "../../src/lib/editor-text.js";

test("编辑器只为空行加入原生光标字体度量占位", () => {
  assert.equal(toEditorDisplayText(""), EDITOR_EMPTY_LINE_MARKER);
  assert.equal(toEditorDisplayText("正文"), "正文");
  assert.equal(
    toEditorDisplayText("第一行\n\n第三行\n"),
    `第一行\n${EDITOR_EMPTY_LINE_MARKER}\n第三行\n${EDITOR_EMPTY_LINE_MARKER}`,
  );
  assert.equal(
    stripEditorDisplayMarkers(
      `第一行\n${EDITOR_EMPTY_LINE_MARKER}\n第三行\n${EDITOR_EMPTY_LINE_MARKER}`,
    ),
    "第一行\n\n第三行\n",
  );
});

test("显示占位不会改变 Markdown 选区索引", () => {
  const source = "第一行\n\n第三行\n";
  const displayText = toEditorDisplayText(source);

  for (let sourceOffset = 0; sourceOffset <= source.length; sourceOffset += 1) {
    const displayOffset = sourceOffsetToEditorOffset(source, sourceOffset);

    assert.equal(
      editorOffsetToSourceOffset(displayText, displayOffset),
      sourceOffset,
    );
  }

  const blankLineSourceOffset = "第一行\n".length;
  const blankLineDisplayOffset = sourceOffsetToEditorOffset(
    source,
    blankLineSourceOffset,
  );

  assert.equal(displayText[blankLineDisplayOffset], EDITOR_EMPTY_LINE_MARKER);
  assert.equal(
    editorOffsetToSourceOffset(displayText, blankLineDisplayOffset + 1),
    blankLineSourceOffset,
  );
});
