import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarkdownFromAcceptedSuggestions,
  getAcceptedSuggestionIdsAfterAcceptAll,
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

test("同意所有只接受仍待处理的建议并保留已忽略项", () => {
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

test("AI 审阅支持三种快捷模式、逐条确认和安全的同意所有", () => {
  const source = readFileSync("src/components/AiReviewDialog.tsx", "utf8");
  const appSource = readFileSync("src/App.tsx", "utf8");

  assert.match(source, /纠正标点语法/);
  assert.match(source, /重点加粗/);
  assert.match(source, /让公众更易读/);
  assert.match(source, /把过长、信息过密的句子拆成自然、易读的短句/);
  assert.match(source, /保持原意、语气和 Markdown 结构/);
  assert.match(source, /支持逐条确认，也可以一键同意所有待处理建议/);
  assert.match(source, /确认修改/);
  assert.match(source, /忽略/);
  assert.match(source, /同意所有/);
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
    /\.ai-suggestion-actions \.is-primary,\s*\.ai-suggestion-summary \.is-primary\s*\{[\s\S]*?background:\s*var\(--export-button-bg\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.ai-review-submit\s*\{[\s\S]*?(?:#afcb58|#94b13c|#78902d)/,
  );
});
