import { useEffect, useState } from "react";
import type { SubAgentLine } from "../SubAgentFeed";
import { agentTypeOf, godOf } from "./gods";
import { activityParts } from "./tool-family";
import "./olympus-rows.css";

/** How a row looks: at work, finished, failed (dimmed and cracked), or stopped (dimmed). */
export type RowLook = "run" | "done" | "fail" | "stop";

export interface RowState {
  readonly look: RowLook;
  readonly word: string;
  /** Still at work, so its time ticks. */
  readonly live: boolean;
}

/**
 * A row's state from its record and its group. An agent that had finished
 * keeps that when the run is stopped; every other agent of a stopped run is
 * interrupted, whatever its record was left saying.
 */
export function rowState(agent: SubAgentLine, aborted: boolean): RowState {
  if (agent.status === "done") return { look: "done", word: "Done", live: false };
  if (agent.status === "idle") return { look: "done", word: "Idle", live: false };
  if (aborted || agent.status === "interrupted")
    return { look: "stop", word: "Interrupted", live: false };
  if (agent.status === "error") return { look: "fail", word: "Failed", live: false };
  return { look: "run", word: agent.status === "starting" ? "Starting" : "Running", live: true };
}

/** A length of time as m:ss. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Text with `code` in it: the code in chips. */
function Rich({ text }: { text: string }): React.ReactNode {
  return text
    .split("`")
    .map((part, i) => (part === "" ? null : i % 2 ? <code key={i}>{part}</code> : part));
}

const CRACK =
  "M33.8 3.2L29.6 10.4L32.4 15.6L25.8 22.2L28.2 27.6L21.4 35.2L23.6 40.4L16.8 48.2L18.6 53.6";

/** The crack across a failed agent's cameo. */
function Crack(): React.ReactElement {
  return (
    <svg className="oly-crack" viewBox="0 0 42 56" aria-hidden="true">
      <path
        d={CRACK}
        fill="none"
        stroke="rgb(246 236 228 / 0.45)"
        strokeWidth="0.8"
        strokeLinejoin="bevel"
        transform="translate(0.8 0.5)"
      />
      <path
        d="M25.8 22.2L20.2 24.6L17.6 29.8M28.2 27.6L33.4 31.2"
        fill="none"
        stroke="#130405"
        strokeWidth="1"
        strokeLinejoin="bevel"
      />
      <path d={CRACK} fill="none" stroke="#130405" strokeWidth="1.5" strokeLinejoin="bevel" />
    </svg>
  );
}

/** The clock, once a second while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  return now;
}

interface Props {
  agents: readonly SubAgentLine[];
  aborted?: boolean;
}

/**
 * The subagents of a turn on the desktop: one row each, its god's cameo in
 * the gutter, the god's name and the task, then its state, what it is doing
 * now or how it ended, and its time.
 */
export function OlympusRows({ agents, aborted = false }: Props): React.ReactElement | null {
  const ticking = agents.some(
    (agent) => agent.startedAt !== undefined && rowState(agent, aborted).live,
  );
  const now = useNow(ticking);
  if (agents.length === 0) return null;

  return (
    <ul className="oly-rows" aria-label="Subagents">
      {agents.map((agent) => {
        const { look, word, live } = rowState(agent, aborted);
        const type = agentTypeOf(agent);
        const god = godOf(type);
        // A spawned agent's name is its task's.
        const task = agent.task ?? (agent.async ? agent.agentName : undefined);
        const activity =
          agent.status === "running" && live
            ? activityParts(agent.activities[agent.activities.length - 1])
            : null;
        const result = look === "done" || look === "fail" ? agent.result : undefined;
        const ms = live
          ? agent.startedAt !== undefined
            ? now - agent.startedAt
            : agent.durationMs
          : agent.durationMs;

        return (
          <li className={`oly-row is-${look}`} key={agent.toolCallId}>
            <span className="oly-mark" aria-hidden="true">
              <span className="oly-cameo">
                <img src={god.cameo} alt="" />
                <span className="oly-rim" />
                {look === "fail" && <Crack />}
              </span>
            </span>
            <p className="oly-line">
              <span className="oly-god" title={type}>
                {god.name}
              </span>
              {type && <span className="sr-only">{`(${type}) `}</span>}
              {task && <Rich text={task} />}
            </p>
            <p className="oly-meta">
              {look === "done" && (
                <svg className="oly-check" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
              <span className="oly-state">{word}</span>
              {activity?.lead && (
                <span className="oly-now">
                  {" · "}
                  {activity.lead}
                  {activity.subject && (
                    <>
                      {" "}
                      <code>{activity.subject}</code>
                    </>
                  )}
                </span>
              )}
              {result && (
                <span className="oly-now">
                  {" · "}
                  <Rich text={result} />
                </span>
              )}
              {ms !== undefined && (
                <span className="oly-when">
                  {" · "}
                  {/* A ticking clock isn't read out every second. */}
                  <span className="oly-time" aria-hidden={live || undefined}>
                    {clock(ms)}
                  </span>
                </span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
