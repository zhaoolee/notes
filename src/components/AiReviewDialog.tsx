import { useEffect, useRef, useState } from "react";
import { reviewMarkdownWithAi } from "../lib/ai";
import {
  buildMarkdownFromAcceptedSuggestions,
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

const QUICK_INSTRUCTIONS = [
  "请检查文章的错别字和标点",
  "请对重要的内容添加粗体符号",
] as const;

export function AiReviewDialog({
  currentMarkdown,
  currentNoteId,
  onClose,
  onMarkdownChange,
}: AiReviewDialogProps) {
  const [instruction, setInstruction] = useState<string>(QUICK_INSTRUCTIONS[0]);
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

  return (
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
            <p>AI 只给建议；每一处修改都由你单独确认。</p>
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
            {QUICK_INSTRUCTIONS.map((quickInstruction) => (
              <button
                key={quickInstruction}
                type="button"
                onClick={() => setInstruction(quickInstruction)}
              >
                {quickInstruction}
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
                session.suggestions.map((suggestion, index) => {
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
                })
              ) : (
                <p className="ai-review-empty">
                  AI 没有发现需要修改的地方。正文未发生任何变化。
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
