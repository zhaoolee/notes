import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reviewMarkdownWithAi } from "../lib/ai";
import {
  buildMarkdownFromAcceptedSuggestions,
  getAcceptedSuggestionIdsAfterAcceptAll,
  type AiSuggestion,
} from "../lib/ai-suggestions";

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
  sourceMarkdown: string;
  sourceNoteId: string;
  suggestions: AiSuggestion[];
}

const QUICK_REVIEW_MODES = [
  {
    id: "punctuation",
    instruction:
      "请纠正文章中的错别字、病句和标点错误，只提出必要的最小修改，并保持原意和 Markdown 结构。",
    label: "纠正标点语法",
  },
  {
    id: "bold",
    instruction:
      "请识别对公众阅读最重要的短语或句子，并用 Markdown **粗体**突出，避免过度加粗或改变原意。",
    label: "重点加粗",
  },
  {
    id: "readability",
    instruction:
      "请让文章更适合公众阅读：优先把过长、信息过密的句子拆成自然、易读的短句，保持原意、语气和 Markdown 结构，不扩写，也不改写无关内容。",
    label: "让公众更易读",
  },
] as const;

export function AiReviewDialog({
  currentMarkdown,
  currentNoteId,
  onClose,
  onMarkdownChange,
}: AiReviewDialogProps) {
  const [instruction, setInstruction] = useState<string>(
    QUICK_REVIEW_MODES[0].instruction,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<ReviewSession | null>(null);
  const currentMarkdownRef = useRef(currentMarkdown);
  const currentNoteIdRef = useRef(currentNoteId);
  currentMarkdownRef.current = currentMarkdown;
  currentNoteIdRef.current = currentNoteId;

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
            <p>支持逐条确认，也可以一键同意所有待处理建议。</p>
          </div>
          <button type="button" aria-label="关闭 AI 审阅" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ai-review-body">
          <label className="ai-review-instruction">
            <span>你希望 AI 做什么？</span>
            <textarea
              value={instruction}
              maxLength={2_000}
              rows={3}
              placeholder="例如：请检查文章的错别字和标点"
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>

          <div className="ai-review-quick-actions" aria-label="常用审阅要求">
            {QUICK_REVIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                aria-pressed={instruction === mode.instruction}
                className={
                  instruction === mode.instruction ? "is-active" : undefined
                }
                onClick={() => setInstruction(mode.instruction)}
              >
                {mode.label}
              </button>
            ))}
          </div>

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
                    <button
                      type="button"
                      className="is-primary"
                      disabled={pendingSuggestionCount === 0}
                      onClick={handleAcceptAll}
                    >
                      同意所有
                    </button>
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
                        <div className="ai-suggestion-diff">
                          <div>
                            <span>原文</span>
                            <pre>{suggestion.original}</pre>
                          </div>
                          <div>
                            <span>建议改为</span>
                            <pre>{suggestion.replacement}</pre>
                          </div>
                        </div>
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
                  AI 没有发现需要修改的地方。正文未发生任何变化。
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
