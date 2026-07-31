import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyMarkdownShortcut,
  continueMarkdownBlock,
} from "../../src/lib/markdown-shortcuts.js";
import { shouldUseIosFormlessEditor } from "../../src/lib/mobile-editor.js";

test("标题按钮按一级、二级、三级循环并保持光标在前缀后", () => {
  const title = applyMarkdownShortcut("", 0, 0, "title");
  const subtitle = applyMarkdownShortcut(
    title.markdown,
    title.selectionStart,
    title.selectionEnd,
    "title",
  );
  const thirdLevel = applyMarkdownShortcut(
    subtitle.markdown,
    subtitle.selectionStart,
    subtitle.selectionEnd,
    "title",
  );
  const cycled = applyMarkdownShortcut(
    thirdLevel.markdown,
    thirdLevel.selectionStart,
    thirdLevel.selectionEnd,
    "title",
  );

  assert.deepEqual(title, {
    markdown: "# ",
    selectionStart: 2,
    selectionEnd: 2,
  });
  assert.deepEqual(subtitle, {
    markdown: "## ",
    selectionStart: 3,
    selectionEnd: 3,
  });
  assert.deepEqual(thirdLevel, {
    markdown: "### ",
    selectionStart: 4,
    selectionEnd: 4,
  });
  assert.deepEqual(cycled, {
    markdown: "# ",
    selectionStart: 2,
    selectionEnd: 2,
  });
  assert.deepEqual(applyMarkdownShortcut("正文", 2, 2, "title"), {
    markdown: "# 正文",
    selectionStart: 4,
    selectionEnd: 4,
  });
});

test("居中按钮包裹当前行并复刻原版的光标位置", () => {
  assert.deepEqual(applyMarkdownShortcut("", 0, 0, "center"), {
    markdown: "[]",
    selectionStart: 1,
    selectionEnd: 1,
  });
  assert.deepEqual(applyMarkdownShortcut("正文", 2, 2, "center"), {
    markdown: "[正文]",
    selectionStart: 4,
    selectionEnd: 4,
  });
  assert.deepEqual(applyMarkdownShortcut("[正文]", 3, 3, "center"), {
    markdown: "[正文]",
    selectionStart: 3,
    selectionEnd: 3,
  });
});

test("列表和引用只添加一次当前行前缀", () => {
  assert.deepEqual(applyMarkdownShortcut("正文", 2, 2, "list"), {
    markdown: "- 正文",
    selectionStart: 4,
    selectionEnd: 4,
  });
  assert.deepEqual(applyMarkdownShortcut("- 正文", 4, 4, "list"), {
    markdown: "- 正文",
    selectionStart: 4,
    selectionEnd: 4,
  });
  assert.deepEqual(applyMarkdownShortcut("正文", 2, 2, "quote"), {
    markdown: "> 正文",
    selectionStart: 4,
    selectionEnd: 4,
  });
  assert.deepEqual(applyMarkdownShortcut("> 正文", 4, 4, "quote"), {
    markdown: "> 正文",
    selectionStart: 4,
    selectionEnd: 4,
  });
});

test("加粗仅包裹非空选区并继续选中原文字", () => {
  assert.deepEqual(applyMarkdownShortcut("B", 1, 1, "bold"), {
    markdown: "B",
    selectionStart: 1,
    selectionEnd: 1,
  });

  const firstBold = applyMarkdownShortcut("B", 0, 1, "bold");
  const nestedBold = applyMarkdownShortcut(
    firstBold.markdown,
    firstBold.selectionStart,
    firstBold.selectionEnd,
    "bold",
  );

  assert.deepEqual(firstBold, {
    markdown: "**B**",
    selectionStart: 2,
    selectionEnd: 3,
  });
  assert.deepEqual(nestedBold, {
    markdown: "****B****",
    selectionStart: 4,
    selectionEnd: 5,
  });
});

test("列表和引用回车自动续行，空项目再次回车退出", () => {
  assert.deepEqual(continueMarkdownBlock("- 第一项", 5, 5), {
    markdown: "- 第一项\n- ",
    selectionStart: 8,
    selectionEnd: 8,
  });
  assert.deepEqual(continueMarkdownBlock("- 第一项\n- ", 8, 8), {
    markdown: "- 第一项\n",
    selectionStart: 6,
    selectionEnd: 6,
  });
  assert.deepEqual(continueMarkdownBlock("> 引用", 4, 4), {
    markdown: "> 引用\n> ",
    selectionStart: 7,
    selectionEnd: 7,
  });
  assert.deepEqual(continueMarkdownBlock("普通正文", 4, 4), null);
});

test("移动端快速输入栏保持原版五等分、尺寸和键盘联动结构", () => {
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  for (const label of ["# Title", "[Center]", "- List", "**Bold**", "> Quote"]) {
    assert.match(editorSource, new RegExp(`label: "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.match(
    editorSource,
    /window\.visualViewport[\s\S]*baselineHeight - viewportHeight > 80[\s\S]*className="markdown-quick-input"[\s\S]*onPointerDown=\{\(event\) => \{\s*event\.preventDefault\(\);/s,
  );
  assert.match(
    styles,
    /@media \(max-width: 640px\)[\s\S]*\.markdown-quick-input\s*\{[^}]*height:\s*42\.6667px;[^}]*display:\s*flex;[^}]*flex:\s*0 0 42\.6667px;[^}]*border-top:\s*1px solid #c8d479;/s,
  );
  assert.match(
    styles,
    /\.markdown-quick-input button\s*\{[^}]*width:\s*20%;[^}]*flex:\s*1 1 20%;[^}]*border-right:\s*1px solid #cdd892;[^}]*color:\s*#98ae44;/s,
  );
  assert.match(
    styles,
    /\.app-layout\[data-theme="smartisan-dark"\] \.markdown-quick-input\s*\{[^}]*border-top-color:\s*#3f4d34;[^}]*background:\s*#293025;/s,
  );
});

test("非 iOS 便签正文声明为普通多行文本而不是账号或密码字段", () => {
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");

  assert.match(
    editorSource,
    /<textarea[\s\S]*id="markdown-editor"[\s\S]*name="note-content"[\s\S]*aria-label="便签正文"[\s\S]*aria-multiline="true"[\s\S]*autoComplete="off"[\s\S]*autoCapitalize="sentences"[\s\S]*inputMode="text"[\s\S]*enterKeyHint="enter"/s,
  );
  assert.doesNotMatch(
    editorSource,
    /<textarea[\s\S]*id="markdown-editor"[\s\S]*autoComplete="(?:username|current-password|new-password|one-time-code)"/s,
  );
});

test("iOS 使用无表单纯文本编辑面，避免进入 Safari 表单 AutoFill", () => {
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");

  assert.equal(
    shouldUseIosFormlessEditor({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15",
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    shouldUseIosFormlessEditor({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    shouldUseIosFormlessEditor({
      userAgent:
        "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    }),
    false,
  );
  assert.equal(
    shouldUseIosFormlessEditor({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 0,
    }),
    false,
  );

  assert.match(
    editorSource,
    /useState\(shouldUseIosFormlessEditor\)[\s\S]*<div[^>]*role="textbox"[^>]*aria-label="便签正文"[^>]*aria-multiline="true"[^>]*contentEditable="plaintext-only"/s,
  );
  assert.doesNotMatch(
    editorSource,
    /<div[^>]*contentEditable="plaintext-only"[^>]*autoComplete=/s,
  );
});
