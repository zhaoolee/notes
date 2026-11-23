import assert from "node:assert/strict";
import test from "node:test";
import { buildXArticleClipboard } from "../../src/lib/x-article.js";

test("X 文章剪贴板保留 Markdown 结构及可跨站引用的网址", () => {
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
  assert.match(result.html, /<img src="https:\/\/notes\.example\/images\/picture\.png" alt="配图"/);
  assert.equal(result.markdown, markdown);
});

test("X 文章富文本跳过原始 HTML 和不可粘贴的链接协议", () => {
  const { html } = buildXArticleClipboard(
    '<img src="https://example.test/picture" onerror="alert(1)">\n\n' +
      "[可见文字](javascript:alert%281%29) ![图片说明](blob:temporary)",
    "https://notes.example/",
  );

  assert.equal(html, "<p>可见文字 图片说明</p>");
});
