/**
 * Jev as a group chat's router and job-complete checker.
 *
 * One System One call per decision: `next` (a choice among the open members:
 * who should act next) and, once someone has replied, `done` (the user's
 * request is finished) and `waiting` (the group needs the user). The group
 * stops when either is at least STOP_AT.
 *
 * What is sent: the group's name, the open members' names and jobs, and the
 * conversation since the user's latest message (with a few messages before
 * it), each clipped. Nothing else.
 */
import type { GroupRouter, RouteDecision, RouteRequest } from "./groups.js";
import { JEV_NOT_SET_UP, type Jev, type JevQuestion } from "./jev.js";

/** done or waiting at least this likely ends the group's work on the message. */
export const STOP_AT = 0.5;
const JOB_CHARS = 300;
const TEXT_CHARS = 1500;

const clip = (s: string, n: number): string => {
  const cs = [...s];
  return cs.length > n ? `${cs.slice(0, n - 1).join("")}…` : s;
};

const two = (p: number): string => p.toFixed(2);

/** The questions for one decision; `done`/`waiting` only once someone has replied. */
export function routeQuestions(req: RouteRequest): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  for (const m of req.members)
    criteria[m.id] = `${m.name}: ${clip(m.job.replace(/\s+/g, " ").trim(), JOB_CHARS)}`;
  const next: JevQuestion = {
    type: "choice",
    instructions: "Which specialist should act next to move the user's latest request forward?",
    criteria,
  };
  if (req.first) return { next };
  return {
    next,
    done: {
      type: "noul",
      instructions:
        "The group has fully completed the user's latest request: everything asked for has " +
        "been done or answered, with nothing left in progress.",
      criteria: {
        true: "Every part of the request is finished.",
        false: "Some part is unfinished, in progress, promised for later, or not started.",
      },
    },
    waiting: {
      type: "noul",
      instructions:
        "The last message asks the user (not another specialist) a question, or the work " +
        "can't continue without the user's decision, approval or information.",
      criteria: {
        true: "Only the user can unblock the work now.",
        false: "The specialists can carry on by themselves, or the work is finished.",
      },
    },
  };
}

/** The state Jev judges: who's in the group and what has been said. */
export function routeState(req: RouteRequest): unknown {
  const line = (m: { from: string; text: string }): { from: string; text: string } => ({
    from: m.from,
    text: clip(m.text, TEXT_CHARS),
  });
  return {
    group: req.group,
    ...(req.earlier.length ? { earlier: req.earlier.map(line) } : {}),
    conversation: req.conversation.map(line),
  };
}

export function jevRouter(jev: Jev, log: (msg: string) => void): GroupRouter {
  let saidNotSetUp = false;
  return async (req, signal): Promise<RouteDecision | null> => {
    const r = await jev.ask(routeState(req), routeQuestions(req), signal);
    if (!r.ok) {
      if (r.error !== JEV_NOT_SET_UP) log(`[jev] routing failed: ${r.error}`);
      else if (!saidNotSetUp) log("[jev] no Typesafe key: groups route by relevance");
      saidNotSetUp ||= r.error === JEV_NOT_SET_UP;
      return null;
    }
    const next = r.value.next;
    if (next?.type !== "choice") return null;
    const open = new Set(req.members.map((m) => m.id));
    const ranked = Object.entries(next.probabilities)
      .filter(([id]) => open.has(id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const done = r.value.done?.type === "noul" ? r.value.done.noul : null;
    const waiting = r.value.waiting?.type === "noul" ? r.value.waiting.noul : null;
    const notes = [
      ranked[0] ? `next ${two(next.probabilities[ranked[0]] ?? 0)}` : "no pick",
      ...(done === null ? [] : [`done ${two(done)}`]),
      ...(waiting === null ? [] : [`waiting ${two(waiting)}`]),
    ];
    const w = waiting ?? 0;
    const stop = !req.first && ((done ?? 0) >= STOP_AT || w >= STOP_AT);
    return {
      ranked,
      stop,
      note: notes.join(", "),
      ...(stop ? { reason: w >= STOP_AT && w >= (done ?? 0) ? "waiting" : "done" } : {}),
    };
  };
}
