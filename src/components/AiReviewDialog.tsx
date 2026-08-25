import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reviewMarkdownWithAi } from "../lib/ai";
import {
  buildSuggestionTextDiff,
  buildMarkdownFromAcceptedSuggestions,
  getAcceptedSuggestionIdsAfterAcceptAll,
  type AiSuggestion,
  type TextDiffPart,
} from "../lib/ai-suggestions";
import {
  buildAiReviewInstruction,
  QUICK_REVIEW_MODES,
  type QuickReviewModeId,
} from "../lib/ai-review-modes";

interface AiReviewDialogProps {
  currentMarkdown: string;
  currentNoteId: string;
  onClose: () => void;
  onMarkdownChange: (markdown: string) => void;
}

interface ReviewSession {
  acceptedIds: Set<string>;
  expectedMarkdown: string;
  ignoredIds: Set<string>;
  isPunctuationOnly: boolean;
  sourceMarkdown: string;
  sourceNoteId: string;
  suggestions: AiSuggestion[];
}

function renderTextDiffParts(parts: TextDiffPart[]) {
  return parts.map((part, index) => {
    if (part.type === "removed") {
      return (
        <del
          key={`${part.type}-${index}`}
          className="ai-diff-removed"
          aria-label={`删除：${part.value}`}
        >
          {part.value}
        </del>
      );
    }

    if (part.type === "added") {
      return (
        <ins
          key={`${part.type}-${index}`}
          className="ai-diff-added"
          aria-label={`新增：${part.value}`}
        >
          {part.value}
        </ins>
      );
    }

    return (
      <span key={`${part.type}-${index}`} className="ai-diff-unchanged">
        {part.value}
      </span>
    );
  });
}

function SuggestionDiff({
  original,
  replacement,
}: Pick<AiSuggestion, "original" | "replacement">) {
  const textDiff = useMemo(
    () => buildSuggestionTextDiff(original, replacement),
    [original, replacement],
  );

  return (
    <div className="ai-suggestion-diff">
      <div>
        <div className="ai-suggestion-diff-label">
          <span>原文</span>
          <small>删除</small>
        </div>
        <pre>{renderTextDiffParts(textDiff.original)}</pre>
      </div>
      <div>
        <div className="ai-suggestion-diff-label">
          <span>建议改为</span>
          <small>新增 · {textDiff.changeCount} 处修改</small>
        </div>
        <pre>{renderTextDiffParts(textDiff.replacement)}</pre>
      </div>
    </div>
  );
}

export function AiReviewDialog({
  currentMarkdown,
  currentNoteId,
  onClose,
  onMarkdownChange,
}: AiReviewDialogProps) {
  const [selectedModeIds, setSelectedModeIds] = useState<
    Set<QuickReviewModeId>
  >(
    () => new Set(["punctuation"]),
  );
  const [customInstruction, setCustomInstruction] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<ReviewSession | null>(null);
  const currentMarkdownRef = useRef(currentMarkdown);
  const currentNoteIdRef = useRef(currentNoteId);
  currentMarkdownRef.current = currentMarkdown;
  currentNoteIdRef.current = currentNoteId;
  const instruction = useMemo(
    () => buildAiReviewInstruction(selectedModeIds, customInstruction),
    [customInstruction, selectedModeIds],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleReview() {
    const normalizedInstruction = instruction.trim();

    if (!normalizedInstruction || !currentMarkdown) {
      return;
    }

    const sourceMarkdown = currentMarkdown;
    const sourceNoteId = currentNoteId;
    const isPunctuationOnly =
      selectedModeIds.size === 1 &&
      selectedModeIds.has("punctuation") &&
      !customInstruction.trim();

    try {
      setIsLoading(true);
      setError("");
      setSession(null);
      const result = await reviewMarkdownWithAi(
        sourceMarkdown,
        normalizedInstruction,
      );

      if (
        currentNoteIdRef.current !== sourceNoteId ||
        currentMarkdownRef.current !== sourceMarkdown
      ) {
        setError("便签内容已变化，请重新发起审阅。");
        return;
      }

      setSession({
        acceptedIds: new Set(),
        expectedMarkdown: sourceMarkdown,
        ignoredIds: new Set(),
        isPunctuationOnly,
        sourceMarkdown,
        sourceNoteId,
        suggestions: result.suggestions,
      });
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "AI 暂时无法生成建议，请稍后重试。",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleModeToggle(modeId: QuickReviewModeId) {
    setSelectedModeIds((currentModeIds) => {
      const nextModeIds = new Set(currentModeIds);

      if (nextModeIds.has(modeId)) {
        nextModeIds.delete(modeId);
      } else {
        nextModeIds.add(modeId);
      }

      return nextModeIds;
    });
  }

  function handleAccept(suggestion: AiSuggestion) {
    if (!session) {
      return;
    }

    if (
      currentNoteId !== session.sourceNoteId ||
      currentMarkdown !== session.expectedMarkdown
    ) {
      setError("便签内容已变化，为避免覆盖你的编辑，请重新审阅。");
      return;
    }

    const acceptedIds = new Set(session.acceptedIds);
    acceptedIds.add(suggestion.id);

    try {
      const nextMarkdown = buildMarkdownFromAcceptedSuggestions(
        session.sourceMarkdown,
        session.suggestions,
        acceptedIds,
      );
      onMarkdownChange(nextMarkdown);
      setError("");
      setSession({
        ...session,
        acceptedIds,
        expectedMarkdown: nextMarkdown,
      });
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "这条建议已失效，请重新审阅。",
      );
    }
  }

  function handleIgnore(suggestion: AiSuggestion) {
    if (!session) {
      return;
    }

    const ignoredIds = new Set(session.ignoredIds);
    ignoredIds.add(suggestion.id);
    setSession({ ...session, ignoredIds });
  }

  function handleAcceptAll() {
    if (!session) {
      return;
    }

    if (
      currentNoteId !== session.sourceNoteId ||
      currentMarkdown !== session.expectedMarkdown
    ) {
      setError("便签内容已变化，为避免覆盖你的编辑，请重新审阅。");
      return;
    }

    const acceptedIds = getAcceptedSuggestionIdsAfterAcceptAll(
      session.suggestions,
      session.acceptedIds,
      session.ignoredIds,
    );

    try {
      const nextMarkdown = buildMarkdownFromAcceptedSuggestions(
        session.sourceMarkdown,
        session.suggestions,
        acceptedIds,
      );
      onMarkdownChange(nextMarkdown);
      setError("");
      setSession({
        ...session,
        acceptedIds,
        expectedMarkdown: nextMarkdown,
      });
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "这些建议已失效，请重新审阅。",
      );
    }
  }

  const pendingSuggestionCount = session
    ? session.suggestions.filter(
        (suggestion) =>
          !session.acceptedIds.has(suggestion.id) &&
          !session.ignoredIds.has(suggestion.id),
      ).length
    : 0;

  return createPortal(
    <div className="ai-review-backdrop" role="presentation">
      <section
        className="ai-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-review-title"
      >
        <header className="ai-review-header">
          <div>
            <h2 id="ai-review-title">AI 辅助审阅</h2>
            <p>支持逐条确认，也可以一键接受剩余待处理建议。</p>
          </div>
          <button type="button" aria-label="关闭 AI 审阅" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ai-review-body">
          <fieldset className="ai-review-quick-actions">
            <legend>选择审阅功能（可多选）</legend>
            {QUICK_REVIEW_MODES.map((mode) => (
              <label
                key={mode.id}
                className={[
                  selectedModeIds.has(mode.id) ? "is-active" : "",
                  isLoading ? "is-disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <input
                  type="checkbox"
                  checked={selectedModeIds.has(mode.id)}
                  disabled={isLoading}
                  onChange={() => handleModeToggle(mode.id)}
                />
                <span>{mode.label}</span>
              </label>
            ))}
            <p className="ai-review-mode-hint" aria-live="polite">
              {selectedModeIds.size > 0
                ? `已选 ${selectedModeIds.size} 项，将合并到一次请求中完成`
                : "未选择预设功能，可填写下方补充要求"}
            </p>
          </fieldset>

          <label className="ai-review-instruction">
            <span>补充要求（可选）</span>
            <textarea
              value={customInstruction}
              maxLength={1_500}
              rows={2}
              placeholder="例如：保留文中的英文产品名"
              disabled={isLoading}
              onChange={(event) => setCustomInstruction(event.target.value)}
            />
          </label>

          <button
            type="button"
            className="ai-review-submit"
            disabled={isLoading || !instruction.trim() || !currentMarkdown}
            onClick={() => void handleReview()}
          >
            {isLoading ? "正在生成建议…" : "生成修改建议"}
          </button>

          {error ? (
            <p className="ai-review-error" role="alert">
              {error}
            </p>
          ) : null}

          {session ? (
            <div className="ai-suggestion-list" aria-live="polite">
              {session.suggestions.length > 0 ? (
                <>
                  <div className="ai-suggestion-summary">
                    <p>
                      共 {session.suggestions.length} 条建议，尚有{" "}
                      {pendingSuggestionCount} 条等待确认
                    </p>
                  </div>

                  {session.suggestions.map((suggestion, index) => {
                    const isAccepted = session.acceptedIds.has(suggestion.id);
                    const isIgnored = session.ignoredIds.has(suggestion.id);

                    return (
                      <article
                        key={suggestion.id}
                        className="ai-suggestion-card"
                        data-status={
                          isAccepted
                            ? "accepted"
                            : isIgnored
                              ? "ignored"
                              : "pending"
                        }
                      >
                        <div className="ai-suggestion-heading">
                          <strong>建议 {index + 1}</strong>
                          <span>
                            {isAccepted
                              ? "已确认"
                              : isIgnored
                                ? "已忽略"
                                : "等待确认"}
                          </span>
                        </div>
                        <p className="ai-suggestion-reason">
                          {suggestion.reason}
                        </p>
                        <SuggestionDiff
                          original={suggestion.original}
                          replacement={suggestion.replacement}
                        />
                        <div className="ai-suggestion-actions">
                          <button
                            type="button"
                            disabled={isAccepted || isIgnored}
                            onClick={() => handleIgnore(suggestion)}
                          >
                            忽略
                          </button>
                          <button
                            type="button"
                            className="is-primary"
                            disabled={isAccepted || isIgnored}
                            onClick={() => handleAccept(suggestion)}
                          >
                            确认修改
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </>
              ) : (
                <p className="ai-review-empty">
                  {session.isPunctuationOnly
                    ? "大模型已检查，无需纠正"
                    : "大模型已检查，暂无修改建议"}
                </p>
              )}
            </div>
          ) : null}
        </div>

        {session && session.suggestions.length > 0 ? (
          <footer className="ai-review-footer">
            <p aria-live="polite">
              {pendingSuggestionCount > 0
                ? `尚有 ${pendingSuggestionCount} 条等待确认`
                : "全部建议已处理"}
            </p>
            <button
              type="button"
              className="is-primary"
              disabled={pendingSuggestionCount === 0}
              onClick={handleAcceptAll}
            >
              {pendingSuggestionCount > 0
                ? `接受剩余 ${pendingSuggestionCount} 条`
                : "全部建议已处理"}
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
