import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "../../src/components/MarkdownText.js";
import {
  buildSuggestionTextDiff,
  buildMarkdownFromAcceptedSuggestions,
  getAcceptedSuggestionIdsAfterAcceptAll,
  normalizeMarkdownStrongWhitespace,
  validateAiSuggestions,
  type AiSuggestion,
} from "../../src/lib/ai-suggestions.js";

const sourceMarkdown = "这里有一个错字。\n这行应该加粗。";
const suggestions: AiSuggestion[] = [
  {
    id: "typo",
    start: 5,
    end: 7,
    original: "错字",
    replacement: "别字",
    reason: "修正错别字",
  },
  {
    id: "bold",
    start: 9,
    end: 15,
    original: "这行应该加粗",
    replacement: "**这行应该加粗**",
    reason: "突出重要内容",
  },
];

test("AI 建议到达时不改变正文，逐条确认才构造新 Markdown", () => {
  assert.equal(validateAiSuggestions(sourceMarkdown, suggestions), true);
  assert.equal(
    buildMarkdownFromAcceptedSuggestions(
      sourceMarkdown,
      suggestions,
      new Set(),
    ),
    sourceMarkdown,
  );
  assert.equal(
    buildMarkdownFromAcceptedSuggestions(
      sourceMarkdown,
      suggestions,
      new Set(["bold"]),
    ),
    "这里有一个错字。\n**这行应该加粗**。",
  );
  assert.equal(
    buildMarkdownFromAcceptedSuggestions(
      sourceMarkdown,
      suggestions,
      new Set(["typo"]),
    ),
    "这里有一个别字。\n这行应该加粗。",
  );
});

test("任意顺序确认多个建议都按源快照稳定应用", () => {
  assert.equal(
    buildMarkdownFromAcceptedSuggestions(
      sourceMarkdown,
      suggestions,
      new Set(["bold", "typo"]),
    ),
    "这里有一个别字。\n**这行应该加粗**。",
  );
});

test("AI 加粗建议把结束标记前的空白移到标记外并能正常渲染", () => {
  const malformed = [
    "正常情况下，可以把周额度想象成一桶水：**7 天后把原来的桶补满。 **如果你喝光了，就补一整桶。",
    "另一个例子：** 实际只是把喝掉的部分补回来。**",
    "`代码中的 ** 空白 ** 保持原样`",
    "```md",
    "** 围栏代码 **",
    "```",
  ].join("\n");
  const normalized = normalizeMarkdownStrongWhitespace(malformed);

  assert.equal(
    normalized,
    [
      "正常情况下，可以把周额度想象成一桶水：**7 天后把原来的桶补满。** 如果你喝光了，就补一整桶。",
      "另一个例子： **实际只是把喝掉的部分补回来。**",
      "`代码中的 ** 空白 ** 保持原样`",
      "```md",
      "** 围栏代码 **",
      "```",
    ].join("\n"),
  );
  assert.equal(normalizeMarkdownStrongWhitespace(normalized), normalized);

  const html = renderToStaticMarkup(
    createElement(MarkdownText, { children: normalized }),
  );
  assert.match(html, /<strong>7 天后把原来的桶补满。<\/strong> 如果你喝光了/);
  assert.match(html, /<strong>实际只是把喝掉的部分补回来。<\/strong>/);
});

test("接受剩余建议只处理仍待确认项并保留已忽略项", () => {
  const acceptedIds = getAcceptedSuggestionIdsAfterAcceptAll(
    suggestions,
    new Set(["typo"]),
    new Set(["bold"]),
  );

  assert.deepEqual([...acceptedIds], ["typo"]);
  assert.equal(
    buildMarkdownFromAcceptedSuggestions(
      sourceMarkdown,
      suggestions,
      acceptedIds,
    ),
    "这里有一个别字。\n这行应该加粗。",
  );
});

test("AI 建议以字符级差异标注删除、新增和修改次数", () => {
  const diff = buildSuggestionTextDiff(
    "我非常喜欢这款应用，**UI 漂亮**。",
    "我非常喜欢这款应用。**UI 漂亮**。",
  );

  assert.equal(diff.changeCount, 1);
  assert.deepEqual(
    diff.original.filter((part) => part.type === "removed"),
    [{ type: "removed", value: "，" }],
  );
  assert.deepEqual(
    diff.replacement.filter((part) => part.type === "added"),
    [{ type: "added", value: "。" }],
  );
  assert.equal(
    diff.original.map((part) => part.value).join(""),
    "我非常喜欢这款应用，**UI 漂亮**。",
  );
  assert.equal(
    diff.replacement.map((part) => part.value).join(""),
    "我非常喜欢这款应用。**UI 漂亮**。",
  );
});

test("越界、原文不符和重叠建议会被拒绝", () => {
  assert.equal(
    validateAiSuggestions(sourceMarkdown, [
      { ...suggestions[0], end: 99 },
    ]),
    false,
  );
  assert.equal(
    validateAiSuggestions(sourceMarkdown, [
      { ...suggestions[0], original: "不存在" },
    ]),
    false,
  );
  assert.equal(
    validateAiSuggestions(sourceMarkdown, [
      suggestions[0],
      {
        id: "overlap",
        start: 6,
        end: 9,
        original: "字。\n",
        replacement: "字！\n",
        reason: "重叠测试",
      },
    ]),
    false,
  );
});

test("AI 审阅支持三种快捷模式、逐条确认和底部接受剩余建议", () => {
  const source = readFileSync("src/components/AiReviewDialog.tsx", "utf8");
  const appSource = readFileSync("src/App.tsx", "utf8");
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(source, /纠正标点语法/);
  assert.match(source, /重点加粗/);
  assert.match(source, /通俗化润色/);
  assert.doesNotMatch(source, /让公众更易读/);
  assert.match(source, /把过长、结构复杂或信息过密的句子拆成自然、易读的短句/);
  assert.match(source, /把专业术语、抽象表达和行业黑话改用公众容易理解的简单概念表达/);
  assert.match(source, /保持原意、事实、语气和 Markdown 结构/);
  assert.match(
    source,
    /session\.instruction === QUICK_REVIEW_MODES\[0\]\.instruction[\s\S]*"大模型已检查，无需纠正"[\s\S]*"大模型已检查，暂无修改建议"/s,
  );
  assert.doesNotMatch(source, /AI 没有发现需要修改的地方/);
  assert.match(source, /支持逐条确认，也可以一键接受剩余待处理建议/);
  assert.match(source, /确认修改/);
  assert.match(source, /忽略/);
  assert.match(source, /className="ai-review-footer"/);
  assert.match(source, /接受剩余 \$\{pendingSuggestionCount\} 条/);
  assert.match(source, /全部建议已处理/);
  assert.match(source, /className="ai-diff-removed"/);
  assert.match(source, /className="ai-diff-added"/);
  assert.match(source, /新增 · \{textDiff\.changeCount\} 处修改/);
  assert.match(
    styles,
    /\.ai-review-footer\s*\{[^}]*flex:\s*0 0 auto;[^}]*border-top:/s,
  );
  assert.match(
    styles,
    /\.ai-diff-removed\s*\{[^}]*text-decoration-line:\s*line-through;/s,
  );
  assert.match(
    styles,
    /\.ai-diff-added\s*\{[^}]*text-decoration-line:\s*underline;/s,
  );
  assert.match(
    source,
    /function handleAccept\(suggestion: AiSuggestion\)[\s\S]*onMarkdownChange\(nextMarkdown\)/,
  );
  assert.match(
    source,
    /function handleAcceptAll\(\)[\s\S]*getAcceptedSuggestionIdsAfterAcceptAll\([\s\S]*onMarkdownChange\(nextMarkdown\)/,
  );
  assert.match(
    source,
    /!session\.acceptedIds\.has\(suggestion\.id\)[\s\S]*!session\.ignoredIds\.has\(suggestion\.id\)/,
  );
  assert.match(
    appSource,
    /currentMarkdown=\{markdown\}[\s\S]*onMarkdownChange=\{setMarkdown\}/,
  );
});

test("移动端 AI 触摸在视口重排前打开，并通过 body portal 避免被编辑器裁剪", () => {
  const source = readFileSync("src/components/AiReviewDialog.tsx", "utf8");
  const appSource = readFileSync("src/App.tsx", "utf8");

  assert.match(source, /import \{ createPortal \} from "react-dom"/);
  assert.match(source, /return createPortal\([\s\S]*document\.body/);
  assert.match(
    appSource,
    /const \[aiReviewNoteId, setAiReviewNoteId\] = useState<string \| null>\(null\)/,
  );
  assert.match(
    appSource,
    /function handleAiReviewPointerDown\([\s\S]*event\.pointerType !== "touch"[\s\S]*event\.preventDefault\(\);[\s\S]*handleOpenAiReview\(\);/,
  );
  assert.match(
    appSource,
    /onClick=\{handleOpenAiReview\}[\s\S]*onPointerDown=\{handleAiReviewPointerDown\}/,
  );
  assert.doesNotMatch(appSource, /aiReviewNoteIdRef|isAiReviewOpen/);
});

test("AI 主要操作复用主题按钮色，不出现大面积荧光绿", () => {
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    styles,
    /\.ai-review-submit\s*\{[\s\S]*?background:\s*var\(--export-button-bg\)/,
  );
  assert.match(
    styles,
    /\.ai-suggestion-actions \.is-primary,\s*\.ai-review-footer \.is-primary\s*\{[\s\S]*?background:\s*var\(--export-button-bg\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.ai-review-submit\s*\{[\s\S]*?(?:#afcb58|#94b13c|#78902d)/,
  );
});
