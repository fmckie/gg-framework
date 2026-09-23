/**
 * Live Activity updates driven from the host.
 *
 * The phone shows a Live Activity on the lock screen while a run is going. It
 * updates the activity itself while the app is open, but iOS suspends the app
 * (and its event stream) once the phone is locked — so from then on the host,
 * which sees every frame of every session, pushes the activity's new state
 * straight to it through APNs (`apns-push-type: liveactivity`).
 *
 * Three parts:
 * - `reduceFrame` — pure: one sidecar frame + the current state → the next
 *   state, and whether it is an `update` or the final `end`. Mirrors the labels
 *   the phone's own `LiveActivityController` uses, so the lock screen reads the
 *   same whichever side drew it.
 * - per-session registrations — the phone's activity push token for a session
 *   (`POST /kleio/live-activity`). In memory only: an activity does not outlive
 *   a host restart's worth of downtime, and a stale token just gets a 410.
 * - a pacer — at most one progress push per session every `minIntervalMs`
 *   (latest state wins, one trailing send), `end` always immediately. Apple
 *   throttles frequent activity pushes; this keeps us inside the budget.
 *
 * Pushes go out only while no device is attached to the session: an attached
 * app is in the foreground and updates the activity itself, so two sources
 * never compete.
 */

import type { ApnsPusher, LiveActivityTarget } from "./apns.js";

/** Wire shape of the app's `AgentActivityAttributes.ContentState`. */
export interface LiveContentState {
  toolName: string | null;
  currentTool: string | null;
  turn: number;
  step: string;
  elapsedSeconds: number;
  totalTokens: number;
  isWorking: boolean;
  done: boolean;
  statusText: string;
  /** Unix seconds the run started; the lock-screen clock ticks from it. */
  startedAt: number;
}

export interface SidecarFrame {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface Reduced {
  readonly state: LiveContentState;
  readonly event: "update" | "end";
}

const DISMISS_AFTER_S = 8;

function usageTotal(u: unknown): number | undefined {
  if (typeof u !== "object" || u === null) return undefined;
  const { inputTokens, outputTokens } = u as { inputTokens?: unknown; outputTokens?: unknown };
  const i = typeof inputTokens === "number" ? inputTokens : 0;
  const o = typeof outputTokens === "number" ? outputTokens : 0;
  return i + o > 0 ? i + o : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.slice(0, 80) : undefined;
}

function fresh(nowMs: number): LiveContentState {
  return {
    toolName: null,
    currentTool: null,
    turn: 1,
    step: "Starting",
    elapsedSeconds: 0,
    totalTokens: 0,
    isWorking: true,
    done: false,
    statusText: "Working…",
    startedAt: Math.floor(nowMs / 1000),
  };
}

function finish(
  s: LiveContentState,
  step: string,
  statusText: string,
  totals: { turn?: number; totalTokens?: number } = {},
): LiveContentState {
  return {
    ...s,
    toolName: null,
    currentTool: null,
    isWorking: false,
    done: true,
    step,
    statusText,
    turn: totals.turn ?? s.turn,
    totalTokens: totals.totalTokens ?? s.totalTokens,
  };
}

/**
 * One frame → the next lock-screen state, or `null` when the frame does not
 * change what the lock screen should show. `prev` is `undefined` before a run
 * has been seen; a mid-run frame then starts a state on the spot, so a
 * registration that lands after `run_start` still gets correct pushes.
 */
export function reduceFrame(
  prev: LiveContentState | undefined,
  frame: SidecarFrame,
  nowMs: number,
): Reduced | null {
  const d = frame.data ?? {};
  if (frame.type === "run_start") return { state: fresh(nowMs), event: "update" };
  // Nothing after an end until the next run starts.
  if (prev?.done) return null;
  const base: LiveContentState = prev ? { ...prev } : fresh(nowMs);
  base.elapsedSeconds = Math.max(0, Math.floor(nowMs / 1000) - base.startedAt);

  switch (frame.type) {
    case "tool_call_start": {
      const name = str(d.name) ?? "tool";
      return {
        event: "update",
        state: {
          ...base,
          toolName: name,
          currentTool: name,
          isWorking: true,
          step: "Tool",
          statusText: `Running ${name}`,
        },
      };
    }
    case "tool_call_end": {
      const failed = d.isError === true;
      const name = base.currentTool ?? "tool";
      return {
        event: "update",
        state: {
          ...base,
          toolName: null,
          currentTool: null,
          isWorking: true,
          step: failed ? "Tool failed" : "Thinking",
          statusText: failed ? `Tool ${name} failed` : "Thinking…",
        },
      };
    }
    case "turn_end": {
      const turn = typeof d.turn === "number" && d.turn > 0 ? Math.floor(d.turn) : base.turn;
      return {
        event: "update",
        state: {
          ...base,
          turn,
          totalTokens: base.totalTokens + (usageTotal(d.usage) ?? 0),
          isWorking: true,
          step: `Step ${turn}`,
          statusText: "Thinking…",
        },
      };
    }
    case "agent_done":
      return {
        event: "end",
        state: finish(base, "Done", "Done", {
          turn:
            typeof d.totalTurns === "number" && d.totalTurns > 0
              ? Math.floor(d.totalTurns)
              : undefined,
          totalTokens: usageTotal(d.totalUsage),
        }),
      };
    case "error":
      return { event: "end", state: finish(base, "Error", "Run failed") };
    case "run_end":
      // Normally `agent_done` already ended it (then `prev.done` returned
      // above). A cancelled run has no `agent_done`; any other run_end without
      // one is a run that stopped short — end it rather than leave it spinning.
      return d.cancelled === true
        ? { event: "end", state: finish(base, "Stopped", "Stopped") }
        : { event: "end", state: finish(base, "Done", "Done") };
    default:
      return null;
  }
}

// ── Tracker ────────────────────────────────────────────────────────────────

export interface LiveRegistration extends LiveActivityTarget {
  readonly deviceId: string;
  readonly registeredAt: string;
}

export interface LiveActivityTracker {
  /** Every frame of every tracked session, attached or not. */
  onFrame(sessionId: string, frame: SidecarFrame, attached: boolean): void;
  register(sessionId: string, reg: LiveRegistration): void;
  /** Clear a session's registration (only the registering device may). */
  unregister(sessionId: string, deviceId: string): boolean;
  /** A revoked device's activities are no longer ours to update. */
  dropDevice(deviceId: string): void;
  registration(sessionId: string): LiveRegistration | undefined;
  stop(): void;
}

export function createLiveActivityTracker(opts: {
  apns: ApnsPusher | undefined;
  log?: (line: string) => void;
  now?: () => number;
  minIntervalMs?: number;
}): LiveActivityTracker {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? 2_000;
  const states = new Map<string, LiveContentState>();
  const regs = new Map<string, LiveRegistration>();
  interface Pace {
    lastSentAt: number;
    pending: LiveContentState | null;
    timer: NodeJS.Timeout | null;
  }
  const pacing = new Map<string, Pace>();

  // One in-flight push per activity. Sent in parallel, an update still in
  // flight when the end goes out can reach Apple after it (seen on the mini),
  // and the lock screen could flick back from "Done" to "Thinking…".
  const chains = new Map<string, Promise<void>>();

  function send(sessionId: string, state: LiveContentState, event: "update" | "end"): void {
    const reg = regs.get(sessionId);
    const apns = opts.apns;
    if (!reg || !apns?.configured) return;
    const prev = chains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const sentAtS = Math.floor(now() / 1000);
      const result = await apns.liveActivity(reg, {
        event,
        contentState: { ...state, elapsedSeconds: Math.max(0, sentAtS - state.startedAt) },
        priority: event === "end" ? 10 : 5,
        ...(event === "end" ? { dismissalDate: sentAtS + DISMISS_AFTER_S } : {}),
      });
      log(`[live] ${sessionId} ${event} "${state.statusText}" → ${result}`);
      // 410: the activity is gone (ended or dismissed on the phone).
      if (result === "gone" && regs.get(sessionId) === reg) regs.delete(sessionId);
    });
    const settled = next.catch((e: unknown) =>
      log(`[live] ${sessionId} ${event} failed: ${String(e)}`),
    );
    chains.set(sessionId, settled);
    void settled.then(() => {
      if (chains.get(sessionId) === settled) chains.delete(sessionId);
    });
  }

  function schedule(sessionId: string, r: Reduced): void {
    if (r.event === "end") {
      const p = pacing.get(sessionId);
      if (p?.timer) clearTimeout(p.timer);
      pacing.delete(sessionId);
      send(sessionId, r.state, "end");
      // The activity is over; its token is spent.
      regs.delete(sessionId);
      return;
    }
    let p = pacing.get(sessionId);
    if (!p) {
      p = { lastSentAt: Number.NEGATIVE_INFINITY, pending: null, timer: null };
      pacing.set(sessionId, p);
    }
    const t = now();
    const wait = p.lastSentAt + minInterval - t;
    if (wait <= 0 && !p.timer) {
      p.lastSentAt = t;
      send(sessionId, r.state, "update");
      return;
    }
    // Inside the window: keep only the newest state; one trailing send.
    p.pending = r.state;
    if (!p.timer) {
      const entry = p;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        const next = entry.pending;
        entry.pending = null;
        if (!next) return;
        entry.lastSentAt = now();
        send(sessionId, next, "update");
      }, wait);
      entry.timer.unref?.();
    }
  }

  return {
    onFrame(sessionId, frame, attached) {
      const r = reduceFrame(states.get(sessionId), frame, now());
      if (!r) return;
      if (r.event === "end") states.delete(sessionId);
      else states.set(sessionId, r.state);
      if (!attached && regs.has(sessionId)) schedule(sessionId, r);
      // An attached app ended the activity itself; either way the token is spent.
      if (r.event === "end") regs.delete(sessionId);
    },
    register(sessionId, reg) {
      regs.set(sessionId, reg);
      log(`[live] ${sessionId} registered for ${reg.deviceId} (${reg.env})`);
    },
    unregister(sessionId, deviceId) {
      const r = regs.get(sessionId);
      if (!r || r.deviceId !== deviceId) return false;
      regs.delete(sessionId);
      return true;
    },
    dropDevice(deviceId) {
      for (const [sid, r] of regs) if (r.deviceId === deviceId) regs.delete(sid);
    },
    registration: (sessionId) => regs.get(sessionId),
    stop() {
      for (const p of pacing.values()) if (p.timer) clearTimeout(p.timer);
      pacing.clear();
    },
  };
}
