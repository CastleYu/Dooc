import { useRef, useEffect } from "react";
import type { PendingSelection } from "./types";

interface FloatingCommentBoxProps {
  pending: PendingSelection;
  submitting: boolean;
  errorMessage: string | null;
  draft: string;
  onDraftChange: (content: string) => void;
  onSubmit: (content: string) => void;
  onClose: () => void;
  onRetry: () => void;
}

export function FloatingCommentBox({
  pending,
  submitting,
  errorMessage,
  draft,
  onDraftChange,
  onSubmit,
  onClose,
  onRetry,
}: FloatingCommentBoxProps) {
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Compute position relative to page scroll
  const rangeRect = pending.rect;
  const boxWidth = Math.min(340, window.innerWidth - 32);

  const scrollX = window.scrollX || window.pageXOffset;

  const top = rangeRect.bottom + 8;

  // Center horizontally with respect to selection, clamped to viewport margins
  const centerLeft = (rangeRect.left + rangeRect.right) / 2 - boxWidth / 2;
  const minLeft = 16 + scrollX;
  const maxLeft = window.innerWidth - boxWidth - 16 + scrollX;
  const left = Math.max(minLeft, Math.min(centerLeft, maxLeft));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "Enter") {
      if (isComposingRef.current || e.nativeEvent.isComposing) {
        return;
      }
      // Shift+Enter creates a new line
      if (e.shiftKey) {
        return;
      }
      // Enter or Ctrl/Cmd+Enter submits
      e.preventDefault();
      if (draft.trim() && !submitting) {
        onSubmit(draft.trim());
      }
    }
  };

  return (
    <div
      className="dooc-floating-box-wrapper"
      style={{
        position: "absolute",
        top: `${top}px`,
        left: `${left}px`,
        width: `${boxWidth}px`,
        zIndex: 100,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="dooc-floating-box">
        <textarea
          ref={textareaRef}
          className="dooc-floating-input"
          aria-label="批注内容"
          placeholder="添加批注..."
          rows={1}
          value={draft}
          disabled={submitting}
          onChange={(e) => onDraftChange(e.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="dooc-floating-actions">
          <button
            type="button"
            className="dooc-floating-btn dooc-floating-submit"
            aria-label="提交批注"
            title="提交批注 (Enter)"
            disabled={submitting || !draft.trim()}
            onClick={() => {
              if (draft.trim() && !submitting) {
                onSubmit(draft.trim());
              }
            }}
          >
            {submitting ? (
              <svg className="dooc-spinner" viewBox="0 0 24 24" width="16" height="16">
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray="42"
                  strokeDashoffset="14"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="dooc-floating-btn dooc-floating-close"
            aria-label="关闭输入框"
            title="关闭 (Esc)"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="dooc-floating-error" role="alert">
          <span className="dooc-error-text">{errorMessage}</span>
          <button
            type="button"
            className="dooc-retry-btn"
            aria-label="重试提交"
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}
