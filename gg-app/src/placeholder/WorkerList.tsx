import { useMemo, useState } from "react";
import type { LiveToolEntry } from "../LiveToolPanel";
import { CourtMount } from "../olympus/CourtMount";
import type { CourtAgent, HearthState } from "../olympus/courtyard";
import { agentTypeOf, godOf, type God } from "../olympus/gods";
import { toolFamilyOf } from "../olympus/tool-family";
import { isPhone } from "../platform";
import { StatusDot, type StatusTone } from "./StatusDot";
import {
  collectGoalAgents,
  collectWorkers,
  goalAgentStateLabel,
  type GoalAgent,
  type WorkerAgent,
  type WorkerGroup,
} from "./worker-status";
import "./placeholder.css";

function toneOf(agent: GoalAgent): StatusTone {
  if (agent.kind === "ask") return "warning";
  if (agent.status === "error") return "error";
  return agent.status === "working" ? "active" : "neutral";
}

// The coordinator's mark in its row, where a worker's cameo is: the courtyard's hearth.
function HearthMark(): React.ReactElement {
  return (
    <svg className="goal-worker-cameo goal-worker-hearth" viewBox="0 0 24 32" aria-hidden="true">
      <path
        className="goal-worker-flame"
        d="M12 3C13 8 18 10 17 15.5C16.5 18.5 14.5 20 12 20C9.5 20 7.5 18.5 7 15.5C6.5 12.5 9 11.5 9.5 8.5C11 10 11.5 7.5 12 3Z"
      />
      <path
        className="goal-worker-bowl"
        d="M3 21H21L17.5 26H6.5ZM9.5 26H14.5V29H9.5ZM6 29H18V31H6Z"
      />
    </svg>
  );
}

const COURT_STATUS: Readonly<Record<WorkerAgent["status"], CourtAgent["status"]>> = {
  running: "working",
  idle: "idle",
  done: "done",
  error: "failed",
  interrupted: "stopped",
};

/** Each worker's god, by its row's key: the bundled agent it runs as. */
export function workerGods(groups: readonly WorkerGroup[]): Map<string, God> {
  const gods = new Map<string, God>();
  for (const group of groups)
    for (const agent of group.agents)
      gods.set(`${group.id}:${agent.toolCallId}`, godOf(agentTypeOf(agent)));
  return gods;
}

/** The workers as the courtyard takes them: each one's god, its row's name, how it stands and its latest tool's family. */
export function courtAgents(
  workers: readonly WorkerAgent[],
  gods: ReadonlyMap<string, God>,
): CourtAgent[] {
  return workers.map((worker) => ({
    key: worker.key,
    god: (gods.get(worker.key) ?? godOf(undefined)).id,
    label: worker.label,
    status: COURT_STATUS[worker.status],
    family: toolFamilyOf(worker.activity),
  }));
}

/**
 * Upstream's Goal world: the coordinator and each worker it brought in, with a
 * state label and what it is doing now. Shown in place of the chat once a goal
 * has started. On the desktop the courtyard stands over the rows (the hearth
 * is the coordinator, each worker a god), and the rows stay the record: a
 * row's cameo is its god's, and pointing at either marks the other.
 */
export function WorkerList({
  groups,
  running,
  liveTools,
  waitingOnUser,
}: {
  /** Every sub-agent group in the transcript, oldest first. */
  groups: readonly WorkerGroup[];
  running: boolean;
  liveTools: readonly LiveToolEntry[];
  waitingOnUser: boolean;
}): React.ReactElement {
  const workers = useMemo(() => collectWorkers(groups), [groups]);
  const agents = useMemo(
    () => collectGoalAgents({ running, liveTools, waitingOnUser, workers }),
    [running, liveTools, waitingOnUser, workers],
  );
  const gods = useMemo(() => workerGods(groups), [groups]);
  const court = useMemo(() => courtAgents(workers, gods), [workers, gods]);
  const hearth: HearthState = waitingOnUser ? "waiting" : running ? "working" : "idle";
  // The row the pointer is on, and the worker whose god it is on.
  const [pointed, setPointed] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const desktop = !isPhone();
  return (
    <section className="placeholder-goals goal-workers" aria-label="Workers">
      <div className="placeholder-scroll">
        <CourtMount agents={court} hearth={hearth} marked={pointed} onHover={setHovered} />
        <ul className="placeholder-list">
          {agents.map((agent) => {
            const label = goalAgentStateLabel(agent);
            const god = gods.get(agent.key);
            return (
              <li
                key={agent.key}
                className={`placeholder-row${hovered === agent.key ? " is-marked" : ""}`}
                data-key={agent.key}
                data-status={agent.status}
                onPointerEnter={() => setPointed(agent.key)}
                onPointerLeave={() => setPointed(null)}
              >
                <span>
                  {desktop && god && (
                    <img
                      className="goal-worker-cameo"
                      src={god.cameo}
                      alt=""
                      width={24}
                      height={32}
                      draggable={false}
                    />
                  )}
                  {desktop && agent.coordinator && <HearthMark />}
                  <StatusDot tone={toneOf(agent)} label={label} /> <strong>{agent.name}</strong>{" "}
                  <span className="placeholder-muted">{label}</span>
                </span>
                <span className="placeholder-muted">{agent.detail}</span>
              </li>
            );
          })}
        </ul>
        {agents.length === 1 && (
          <p className="placeholder-muted">No workers yet. The coordinator brings them in.</p>
        )}
      </div>
    </section>
  );
}
