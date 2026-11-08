import { useId } from "react";
import type { GoalStateInfo, ModelOption } from "../agent";
import "./placeholder.css";

export type GoalView = "chat" | "workers";

/**
 * Placeholder (the fork owns the desktop design) for upstream's goal chrome: the
 * goal's name and phase, the Chat | Workers switch once it has started, and the
 * model its workers run on (upstream's footer picker).
 */
export function GoalPanel({
  goal,
  view,
  onViewChange,
  needsAnswer = false,
  models,
  onSelectWorkerModel,
}: {
  goal: GoalStateInfo;
  /** Null while the goal is still being briefed: there is no Workers view yet. */
  view: GoalView | null;
  onViewChange: (view: GoalView) => void;
  /** A question waits on the user (the Chat switch says so). */
  needsAnswer?: boolean;
  models: readonly ModelOption[];
  /** Null follows the coordinator's own model. */
  onSelectWorkerModel: (modelId: string | null) => void;
}): React.ReactElement {
  const modelId = useId();
  const current = goal.critterModel ?? "";
  return (
    <div className="placeholder-bar" role="group" aria-label="Goal">
      <strong>{goal.name}</strong>
      <span className="placeholder-muted">{goal.phase === "active" ? "Underway" : "Briefing"}</span>
      {view && (
        <span role="group" aria-label="Goal view">
          <button type="button" aria-pressed={view === "chat"} onClick={() => onViewChange("chat")}>
            {needsAnswer ? "Chat (waiting for you)" : "Chat"}
          </button>{" "}
          <button
            type="button"
            aria-pressed={view === "workers"}
            onClick={() => onViewChange("workers")}
          >
            Workers
          </button>
        </span>
      )}
      <label htmlFor={modelId} className="placeholder-muted">
        Workers&apos; model
      </label>
      <select
        id={modelId}
        value={current}
        onChange={(event) => onSelectWorkerModel(event.target.value || null)}
      >
        <option value="">Same as the coordinator</option>
        {current && !models.some((m) => m.id === current) && (
          <option value={current}>{current}</option>
        )}
        {models.map((model) => (
          <option key={`${model.provider}:${model.id}`} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
    </div>
  );
}
