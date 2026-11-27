import type { PlanDecision } from "../transcript-item";
import { StatusDot } from "./StatusDot";

const COPY: Readonly<Record<PlanDecision, string>> = {
  accepted: "Plan accepted. Implementing it now.",
  feedback: "Feedback sent. Revising the plan.",
  rejected: "Plan rejected. Nothing was built.",
};

export function describePlanDecision(decision: PlanDecision): string {
  return COPY[decision];
}

/**
 * Placeholder (the fork owns the desktop design): the transcript row a plan
 * decision leaves behind. Accepting or revising sends the agent off to work;
 * a rejection ends it.
 */
export function PlanDecisionNotice({
  decision,
  title,
}: {
  decision: PlanDecision;
  /** The approved plan's name. Given, an accepted plan folds into one row. */
  title?: string;
}): React.ReactElement {
  const rejected = decision === "rejected";
  if (decision === "accepted" && title) {
    return (
      <p className="plan-done" role="status" data-decision="accepted">
        <span className="plan-done-check" aria-hidden="true">
          {"\u2713"}
        </span>
        {title}
        <span className="plan-done-state">{" \u00b7 Approved"}</span>
      </p>
    );
  }
  return (
    <div className="placeholder-notice" role="status" data-decision={decision}>
      <StatusDot tone={rejected ? "neutral" : "active"} label={rejected ? "Stopped" : "Working"} />
      <span className={rejected ? "placeholder-muted" : "placeholder-attention"}>
        {describePlanDecision(decision)}
      </span>
    </div>
  );
}
