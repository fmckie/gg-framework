import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "./dialog-focus";
import { theme } from "./theme";
import { YourPlanLogo } from "./PlanModeLogo";
import { Markdown } from "./Markdown";

interface Props {
  /** Plan markdown to review. */
  content: string;
  /** True while Autopilot Ken is reviewing this plan himself — shows a small
   *  indicator above the actions. Buttons stay ENABLED: a manual Accept/
   *  Feedback/Reject always overrides Ken (the sidecar's generation guard
   *  discards his stale verdict). */
  kenReviewing?: boolean;
  onAccept: () => void;
  onFeedback: (feedback: string) => void;
  onReject: () => void;
}

/**
 * Full-screen plan review shown on plan_exit (mirrors the ggcoder CLI plan
 * overlay): the amber "YOUR PLAN" banner, the rendered plan markdown, and three
 * actions — Accept (implement), Feedback (revise with notes), Reject (dismiss).
 */
export function PlanReviewModal({
  content,
  kenReviewing = false,
  onAccept,
  onFeedback,
  onReject,
}: Props): React.ReactElement {
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const feedbackButtonRef = useRef<HTMLButtonElement>(null);
  const refocusFeedbackButton = useRef(false);
  // No Escape handler: every outcome here (accept, revise, reject) is a real
  // decision, so Escape must not quietly pick one.
  useDialogFocus(dialogRef);

  // Leaving feedback mode unmounts the focused textarea; hand focus back to
  // the button that opened it instead of dropping it on <body>.
  useEffect(() => {
    if (feedbackMode || !refocusFeedbackButton.current) return;
    refocusFeedbackButton.current = false;
    feedbackButtonRef.current?.focus();
  }, [feedbackMode]);

  const closeFeedback = (): void => {
    refocusFeedbackButton.current = true;
    setFeedbackMode(false);
  };

  return (
    <div
      ref={dialogRef}
      className="plan-review"
      role="dialog"
      aria-modal="true"
      aria-label="Review plan"
      tabIndex={-1}
    >
      {/* ASCII-art banner: decorative, and gibberish when read aloud. */}
      <div className="plan-review-banner" aria-hidden="true">
        <YourPlanLogo />
      </div>
      {/* Initial focus lands on the scrollable plan, not on Accept: an Enter
          already in flight from the composer must not approve the plan, and
          focus here lets arrow keys scroll a long plan. */}
      <div
        className="plan-review-body"
        role="region"
        aria-label="Plan"
        tabIndex={0}
        data-modal-initial-focus
      >
        <Markdown>{content || "_(plan is empty)_"}</Markdown>
      </div>

      {kenReviewing && (
        <div className="plan-review-ken" style={{ color: theme.ken }}>
          Ken is reviewing this plan… you can still accept or reject it yourself.
        </div>
      )}
      <div className="plan-review-actions">
        {feedbackMode ? (
          <div className="plan-feedback">
            <textarea
              className="plan-feedback-input"
              value={feedback}
              placeholder="What should change about this plan?"
              autoFocus
              rows={3}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (feedback.trim()) onFeedback(feedback.trim());
                } else if (e.key === "Escape") {
                  closeFeedback();
                }
              }}
            />
            <div className="plan-feedback-row">
              <span className="plan-feedback-hint" style={{ color: theme.textDim }}>
                {"\u2318\u23CE to send \u00b7 Esc to cancel"}
              </span>
              <span className="plan-feedback-buttons">
                <button className="btn btn-ghost btn-sm" onClick={closeFeedback}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!feedback.trim()}
                  onClick={() => onFeedback(feedback.trim())}
                >
                  Send feedback
                </button>
              </span>
            </div>
          </div>
        ) : (
          <>
            <button className="btn btn-primary" onClick={onAccept}>
              Accept
            </button>
            <button
              ref={feedbackButtonRef}
              className="btn btn-ghost"
              onClick={() => setFeedbackMode(true)}
            >
              Feedback
            </button>
            <button className="btn btn-ghost plan-reject" onClick={onReject}>
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
