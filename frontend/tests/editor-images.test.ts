import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectEditorImagePreviews,
  isLikelyImageUrl,
  moveEditorImage,
  replaceEditorImageAlt,
  replaceEditorImageSource,
  splitEditorContent,
} from "../../src/lib/editor-images.js";

test("普通网址粘贴不会被误判为图片，明确图片地址仍可导入", () => {
  assert.equal(isLikelyImageUrl("https://x.com/thsottiaux"), false);
  assert.equal(isLikelyImageUrl("https://example.com/article/image-guide"), false);
  assert.equal(
    isLikelyImageUrl("https://cdn.example.test/photo.PNG?width=1200#preview"),
    true,
  );
  assert.equal(isLikelyImageUrl("https://cdn.example.test/vector.svg"), true);
  assert.equal(isLikelyImageUrl("ftp://cdn.example.test/photo.png"), false);
});

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

test("图片标注只更新 Markdown 中括号或 HTML alt，不改动图片地址", () => {
  const markdown = [
    "前文",
    "![旧标注](/images/demo.png \"标题\")",
    '<img src="/images/html.png">',
    "后文",
  ].join("\n");
  const [markdownImage, htmlImage] = collectEditorImagePreviews(markdown);
  const withMarkdownAlt = replaceEditorImageAlt(
    markdown,
    markdownImage,
    "新标注 ] 保留",
  );
  const currentHtmlImage = collectEditorImagePreviews(withMarkdownAlt)[1];
  const withBothAlts = replaceEditorImageAlt(
    withMarkdownAlt,
    currentHtmlImage,
    'HTML "标注"',
  );

  assert.match(withBothAlts, /!\[新标注 \\] 保留]\(\/images\/demo\.png "标题"\)/);
  assert.match(
    withBothAlts,
    /<img src="\/images\/html\.png" alt="HTML &quot;标注&quot;">/,
  );
  assert.deepEqual(
    collectEditorImagePreviews(withBothAlts).map(({ alt, source }) => ({ alt, source })),
    [
      { alt: "新标注 ] 保留", source: "/images/demo.png" },
      { alt: 'HTML "标注"', source: "/images/html.png" },
    ],
  );
});

test("裁剪替换图片地址并支持把图片按正文行重新插入", () => {
  const markdown = [
    "第一行",
    "![图片](/images/original.png)",
    "第二行",
    "第三行",
  ].join("\n");
  const image = collectEditorImagePreviews(markdown)[0];
  const cropped = replaceEditorImageSource(
    markdown,
    image,
    "/images/cropped.png",
  );
  const currentImage = collectEditorImagePreviews(cropped)[0];
  const targetOffset = cropped.indexOf("第三行");

  assert.equal(
    moveEditorImage(cropped, currentImage, targetOffset),
    ["第一行", "第二行", "![图片](/images/cropped.png)", "第三行"].join(
      "\n",
    ),
  );
});

test("编辑器以内联图片块复刻锤子便签，并保留原生 textarea 输入控件", () => {
  const editorSource = readFileSync("src/components/EditorPanel.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(editorSource, /splitEditorContent\(markdown\)/);
  assert.match(editorSource, /className="markdown-editor-flow"/);
  assert.match(editorSource, /className={`editor-image-block\$\{/);
  assert.match(
    editorSource,
    /className=\{`markdown-editor editor-text-segment\$\{/,
  );
  assert.match(editorSource, /focusAfterImage\(image\.markerEnd\)/);
  assert.match(editorSource, /removeAdjacentImage\(/);
  assert.match(editorSource, /function requestImageDeletion\(/);
  assert.match(
    editorSource,
    /if \(activeImageKey !== imageKey\) \{[\s\S]*setActiveImageKey\(imageKey\);[\s\S]*return;/,
  );
  assert.match(editorSource, /setPendingImageDeletion\(\{ focusOffset, imageKey \}\)/);
  assert.match(editorSource, /requestImageDeletion\(previousBlock, block\.start\)/);
  assert.match(editorSource, /requestImageDeletion\(nextBlock, block\.end\)/);
  assert.match(editorSource, /<ConfirmDialog/);
  assert.match(editorSource, /confirmLabel: "删除图片"/);
  assert.match(editorSource, /onClose=\{closeImageDeletionConfirmation\}/);
  assert.match(editorSource, /onConfirm=\{confirmImageDeletion\}/);
  assert.match(
    editorSource,
    /function closeImageDeletionConfirmation\(\): void \{[\s\S]*setPendingImageDeletion\(null\);[\s\S]*focusGlobalSelection\(markdown, focusOffset\);/,
  );
  assert.match(editorSource, /replaceEditorImageAlt\(/);
  assert.match(editorSource, /replaceEditorImageSource\(/);
  assert.match(editorSource, /moveEditorImage\(/);
  assert.match(editorSource, /const imageMarkdown = `!\[\]\(\$\{imageUrl\}\)`/);
  assert.match(editorSource, /aria-label="图片操作"/);
  assert.match(editorSource, /aria-label="编辑图片标注"/);
  assert.match(editorSource, /aria-label="下载这张图片"/);
  assert.match(editorSource, /aria-label="放大查看这张图片"/);
  assert.match(editorSource, /aria-label="裁剪这张图片"/);
  assert.match(editorSource, /aria-label="拖动图片位置"/);
  assert.match(editorSource, /<ImageCropDialog/);
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
    /\.editor-image-handle\s*\{[^}]*top:\s*6px;[^}]*right:\s*-27px;[^}]*width:\s*51px;[^}]*height:\s*51px;/s,
  );
  assert.match(
    styles,
    /\.editor-image-block\.is-active \.editor-image-main\s*\{[^}]*filter:\s*blur\(12px\);/s,
  );
  assert.match(
    styles,
    /\.editor-image-actions button\s*\{[^}]*width:\s*51px;[^}]*height:\s*51px;/s,
  );
  assert.match(styles, /\.editor-image-preview\s*\{/);
  assert.match(styles, /\.image-crop-selection\s*\{/);
  assert.match(styles, /--editor-image-grid-spacer/);
});
