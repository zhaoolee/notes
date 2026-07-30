import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarkdownFromAcceptedSuggestions,
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

test("AI 审阅界面只提供逐条确认和忽略，不提供批量自动改写", () => {
  const source = readFileSync("src/components/AiReviewDialog.tsx", "utf8");
  const appSource = readFileSync("src/App.tsx", "utf8");

  assert.match(source, /AI 只给建议；每一处修改都由你单独确认/);
  assert.match(source, /确认修改/);
  assert.match(source, /忽略/);
  assert.doesNotMatch(source, /全部接受|自动修改/);
  assert.match(
    source,
    /function handleAccept\(suggestion: AiSuggestion\)[\s\S]*onMarkdownChange\(nextMarkdown\)/,
  );
  assert.match(
    appSource,
    /currentMarkdown=\{markdown\}[\s\S]*onMarkdownChange=\{setMarkdown\}/,
  );
});

test("AI 主要操作复用主题按钮色，不出现大面积荧光绿", () => {
  const styles = readFileSync("src/styles.css", "utf8");

  assert.match(
    styles,
    /\.ai-review-submit\s*\{[\s\S]*?background:\s*var\(--export-button-bg\)/,
  );
  assert.match(
    styles,
    /\.ai-suggestion-actions \.is-primary\s*\{[\s\S]*?background:\s*var\(--export-button-bg\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.ai-review-submit\s*\{[\s\S]*?(?:#afcb58|#94b13c|#78902d)/,
  );
});
