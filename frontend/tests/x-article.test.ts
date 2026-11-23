import assert from "node:assert/strict";
import test from "node:test";
import { buildXArticleClipboard } from "../../src/lib/x-article.js";

test("X 文章剪贴板保留 Markdown 结构，并标出图片上传位置", () => {
  const markdown = [
    "# 标题",
    "",
    "第一行有 **粗体** 和 *斜体*",
    "第二行有 ~~删除线~~ 和 [链接](/reference)",
    "",
    "- 甲",
    "- 乙",
    "![配图](/images/picture.png)",
  ].join("\n");
  const result = buildXArticleClipboard(markdown, "https://notes.example/#note=1");

  assert.match(result.html, /<h1>标题<\/h1>/);
  assert.match(result.html, /<p>第一行有 <strong>粗体<\/strong> 和 <em>斜体<\/em><\/p>/);
  assert.match(result.html, /<p>第二行有 <del>删除线<\/del> 和 <a href="https:\/\/notes\.example\/reference">链接<\/a><\/p>/);
  assert.match(result.html, /<ul>\s*<li>甲<\/li>\s*<li>乙<\/li>\s*<\/ul>/);
  assert.match(result.html, /<p><span data-notes-x-image-url="https:\/\/notes\.example\/images\/picture\.png">【图片 1】<\/span><\/p>/);
  assert.doesNotMatch(result.html, /<img\b/);
  assert.match(result.markdown, /\n【图片 1】$/);
  assert.deepEqual(result.images, [{
    number: 1,
    marker: "【图片 1】",
    url: "https://notes.example/images/picture.png",
    alt: "配图",
  }]);
});

test("X 文章按正文顺序标记引用图片、重复图片和行内图片", () => {
  const markdown = [
    "开头 ![图 A][a] 继续",
    "",
    "> ![图 B](/images/b.gif)",
    "",
    "![重复的图 A][a]",
    "",
    '`![代码不应被替换](/images/c.png)`',
    "",
    "[a]: https://example.test/a.jpg",
  ].join("\n");
  const result = buildXArticleClipboard(markdown, "https://notes.example/");

  assert.deepEqual(result.html.match(/【图片 \d】/g), ["【图片 1】", "【图片 2】", "【图片 3】"]);
  assert.equal(
    result.markdown,
    markdown.replace("![图 A][a]", "【图片 1】")
      .replace("![图 B](/images/b.gif)", "【图片 2】")
      .replace("![重复的图 A][a]", "【图片 3】"),
  );
  assert.deepEqual(result.images.map(({ url }) => url), [
    "https://example.test/a.jpg",
    "https://notes.example/images/b.gif",
    "https://example.test/a.jpg",
  ]);
});

test("X 文章富文本跳过原始 HTML 和不可粘贴的链接协议", () => {
  const { html, images } = buildXArticleClipboard(
    '<img src="https://example.test/picture" onerror="alert(1)">\n\n' +
      "[可见文字](javascript:alert%281%29) ![图片说明](blob:temporary)",
    "https://notes.example/",
  );

  assert.equal(html, "<p>可见文字 图片说明</p>");
  assert.deepEqual(images, []);
});

test("X 文章扩展可为同一次粘贴生成独立的图片标记", () => {
  const result = buildXArticleClipboard(
    "![一](/images/one.png)\n\n![二](/images/two.jpg)",
    "https://notes.example/",
    (number) => `[draft-import-${number}]`,
  );

  assert.deepEqual(result.images.map(({ marker }) => marker), ["[draft-import-1]", "[draft-import-2]"]);
  assert.equal(result.markdown, "[draft-import-1]\n\n[draft-import-2]");
  assert.match(result.html, /<span[^>]+>\[draft-import-1\]<\/span>[\s\S]*<span[^>]+>\[draft-import-2\]<\/span>/);
});
