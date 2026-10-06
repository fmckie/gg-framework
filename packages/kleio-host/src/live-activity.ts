/**
 * The iPhone Live Activity (lock screen + Dynamic Island), driven from the host.
 *
 * The host sees every frame of every tracked session and is the single source
 * of truth for the activity: the app starts it (or the host does, with
 * push-to-start) and registers the activity's update token; from then on
 * every change goes out through APNs (`apns-push-type: liveactivity`).
 *
 * Targets: a session `s:<sessionId>` or a group chat `g:<groupId>`. The wire
 * shape is the app's `KleioActivityAttributes` / `ContentState`.
 *
 * Parts:
 * - `reduceFrame`: pure; one sidecar frame + the current state → the next
 *   state and how urgent it is (routine step, phase change, or the end).
 * - registrations: the activity's update token per target, in memory (a stale
 *   one just gets a 410). States are kept even with no registration, so a late
 *   registration catches up at once.
 * - a pacer: at most one routine push per target every `minIntervalMs`
 *   (latest wins, one trailing send); phase changes and the end go at once.
 * - one push in flight per target, so an update never lands after the end.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ApnsPusher, LiveActivityAlert, LiveActivityTarget } from "./apns.js";
import {
  askButtons,
  clipText,
  DETAIL_MAX,
  LINE_MAX,
  stepText,
  TITLE_MAX,
  type AskButtons,
  type GroupLive,
  type LivePhase,
} from "./live-text.js";

export const ATTRIBUTES_TYPE = "KleioActivityAttributes";
/** iOS marks the activity out of date this long after the last push. */
const STALE_AFTER_S = 30 * 60;
const DISMISS_DONE_S = 30 * 60;
const DISMISS_OTHER_S = 10 * 60;

/** `KleioActivityAttributes` (static). */
export interface LiveAttributes {
  readonly kind: "chat" | "code" | "specialist" | "group";
  readonly title: string;
  readonly sessionId?: string;
  readonly groupId?: string;
}

/** `KleioActivityAttributes.ContentState`. Times are unix seconds. */
export interface LiveState {
  readonly phase: LivePhase;
  readonly line: string;
  readonly detail?: string | null;
  readonly startedAt: number;
  readonly endedAt?: number | null;
  /**
   * With needsYou, when the question can be answered from the lock screen:
   * the buttons' labels, which question they answer, and a one-off key the
   * answer must carry (only the phone, through Apple, ever sees it).
   */
  readonly askId?: string | null;
  readonly askKey?: string | null;
  readonly options?: readonly string[] | null;
  /** Which option the agent recommends (it stands out). */
  readonly recommended?: number | null;
}

export interface SidecarFrame {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

/** routine: a working step (paced, priority 5); phase: at once (10); end: final. */
export type ChangeKind = "routine" | "phase" | "end";

export interface Change {
  readonly kind: ChangeKind;
  readonly state: LiveState;
}

const isEnd = (p: LivePhase): boolean => p === "done" || p === "failed" || p === "stopped";

function working(prev: LiveState | undefined, line: string, at: number): Change {
  const state: LiveState = { phase: "working", line, startedAt: prev?.startedAt ?? at };
  return { kind: prev?.phase === "working" ? "routine" : "phase", state };
}

function ended(prev: LiveState, phase: LivePhase, line: string, at: number): Change {
  return { kind: "end", state: { phase, line, startedAt: prev.startedAt, endedAt: at } };
}

const ASK_TOOL = "ask_user";

function questionText(d: Record<string, unknown>): string {
  const qs: unknown[] = Array.isArray(d.questions) ? d.questions : [];
  const first = qs[0];
  const q =
    typeof first === "object" && first !== null
      ? (first as { question?: unknown }).question
      : undefined;
  const more = qs.length > 1 ? ` (+${qs.length - 1} more)` : "";
  const text = typeof q === "string" && q.trim() ? q : "Kleio has a question";
  return `${clipText(text, DETAIL_MAX - more.length)}${more}`;
}

/** One frame → the next state, or null when the activity doesn't change. `nowMs` in ms. */
export function reduceFrame(
  prev: LiveState | undefined,
  frame: SidecarFrame,
  nowMs: number,
): Change | null {
  const at = nowMs / 1000;
  const d = frame.data ?? {};
  switch (frame.type) {
    case "run_start":
      return { kind: "phase", state: { phase: "working", line: "Thinking…", startedAt: at } };
    case "tool_call_start":
    case "tool_call_end":
    case "server_tool_call": {
      // Waiting on the user: nothing moves until they answer. The question's
      // own tool call starts right after its ask_user frame and must not
      // turn "Needs your help" back into a step.
      if (prev?.phase === "needsYou" || d.name === ASK_TOOL) return null;
      if (frame.type === "tool_call_end") return prev ? working(prev, "Thinking…", at) : null;
      const name = typeof d.name === "string" ? d.name : "";
      // Server tools (web search) carry `input`, local ones `args`.
      return working(
        prev,
        stepText(name, frame.type === "server_tool_call" ? d.input : d.args),
        at,
      );
    }
    case "ask_user": {
      const buttons = askButtons(d);
      return {
        kind: "phase",
        state: {
          phase: "needsYou",
          line: "Needs your help",
          detail: questionText(d),
          startedAt: prev?.startedAt ?? at,
          ...(buttons ? { askId: buttons.askId, options: buttons.labels } : {}),
          ...(buttons && buttons.recommended !== null ? { recommended: buttons.recommended } : {}),
        },
      };
    }
    case "ask_user_done":
      return prev?.phase === "needsYou"
        ? {
            kind: "phase",
            state: { phase: "working", line: "Back to work", startedAt: prev.startedAt },
          }
        : null;
    case "run_end":
      // The run's real end. Not agent_done: the sidecar can go on checking or
      // reviewing the work after the agent's loop ends; nor error: a run that
      // hits one can still recover, and run_end says how it ended (failed).
      if (!prev) return null;
      if (d.cancelled === true) return ended(prev, "stopped", "Stopped", at);
      if (d.failed === true) return ended(prev, "failed", "Something went wrong", at);
      return ended(prev, "done", "Done", at);
    default:
      return null;
  }
}

// ── Tracker ────────────────────────────────────────────────────────────────

export interface LiveRegistration extends LiveActivityTarget {
  readonly deviceId: string;
  readonly registeredAt: string;
}

/** A device's push-to-start token. */
export interface StartToken extends LiveActivityTarget {
  readonly deviceId: string;
}

export interface LiveAlertText {
  readonly title: string;
  readonly body: string;
}

export interface LiveActivityTracker {
  /** Every frame of a session target's session (not group members). */
  onFrame(sessionId: string, frame: SidecarFrame): void;
  /**
   * Set a target's state from words (group targets). `fresh` starts the timer
   * again. With `alert`, the push carries it (or starts the activity) and the
   * result says whether it reached the phone.
   */
  set(
    target: string,
    live: GroupLive,
    opts?: {
      readonly fresh?: boolean;
      readonly alert?: LiveAlertText;
      readonly describe?: () => LiveAttributes | null;
    },
  ): Promise<boolean>;
  /**
   * Alert the phone through the activity: re-send the current state with an
   * alert to its registration, else push-to-start one. True when Apple took it.
   */
  alert(
    target: string,
    alert: LiveAlertText,
    describe: () => LiveAttributes | null,
  ): Promise<boolean>;
  /** Register a target's activity update token; pushes the current state at once. */
  register(target: string, reg: LiveRegistration): void;
  /** Clear a target's registration (only the registering device may). */
  unregister(target: string, deviceId: string): boolean;
  /** A revoked device's activities are no longer ours to update. */
  dropDevice(deviceId: string): void;
  registration(target: string): LiveRegistration | undefined;
  state(target: string): LiveState | undefined;
  /**
   * A lock-screen button was tapped: the answer it carries, when `key` is the
   * one-off key of the question still showing on `target`, else null. A key
   * is used once; answering clears it.
   */
  claimAnswer(
    target: string,
    askId: string,
    key: string,
    choice: number,
  ): { readonly questionId: string; readonly value: string } | null;
  /** Settles once every push started so far has finished. */
  flush(): Promise<void>;
  stop(): void;
}

export function createLiveActivityTracker(opts: {
  apns: ApnsPusher | undefined;
  /** Push-to-start tokens of the non-revoked devices. */
  startTokens?: () => readonly StartToken[];
  log?: (line: string) => void;
  /** ms */
  now?: () => number;
  minIntervalMs?: number;
}): LiveActivityTracker {
  const log = opts.log ?? ((): void => {});
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? 5_000;
  const states = new Map<string, LiveState>();
  const regs = new Map<string, LiveRegistration>();
  /** The open lock-screen question per target: its buttons and one-off key. */
  const asks = new Map<string, AskButtons & { readonly key: string }>();
  interface Pace {
    lastSentAt: number;
    pending: LiveState | null;
    timer: NodeJS.Timeout | null;
  }
  const pacing = new Map<string, Pace>();
  // One in-flight push per activity. Sent in parallel, an update still in
  // flight when the end goes out can reach Apple after it (seen on the mini),
  // and the lock screen could flick back from "Done" to "Thinking…".
  const chains = new Map<string, Promise<unknown>>();

  const nowS = (): number => Math.floor(now() / 1000);

  function chained(target: string, work: () => Promise<boolean>): Promise<boolean> {
    const prev = chains.get(target) ?? Promise.resolve();
    const next = prev.then(work).catch((e: unknown) => {
      log(`[live] ${target} push failed: ${String(e)}`);
      return false;
    });
    chains.set(target, next);
    void next.then(() => {
      if (chains.get(target) === next) chains.delete(target);
    });
    return next;
  }

  /** Send one update/end to the target's registration. Resolves true on 200. */
  function send(
    target: string,
    reg: LiveRegistration,
    state: LiveState,
    kind: ChangeKind,
    alert?: LiveActivityAlert,
  ): Promise<boolean> {
    const apns = opts.apns;
    if (!apns?.configured) return Promise.resolve(false);
    return chained(target, async () => {
      const t = nowS();
      const end = kind === "end";
      const result = await apns.liveActivity(
        { token: reg.token, env: reg.env },
        {
          event: end ? "end" : "update",
          contentState: { ...state },
          priority: kind === "routine" && !alert ? 5 : 10,
          ...(alert ? { alert } : {}),
          ...(end
            ? { dismissalDate: t + (state.phase === "done" ? DISMISS_DONE_S : DISMISS_OTHER_S) }
            : { staleDate: t + STALE_AFTER_S }),
        },
      );
      log(`[live] ${target} ${end ? "end" : "update"} "${state.line}" → ${result}`);
      // 410: the activity is gone (ended or dismissed on the phone).
      if (result === "gone" && regs.get(target) === reg) regs.delete(target);
      return result === "ok";
    });
  }

  function clearPace(target: string): void {
    const p = pacing.get(target);
    if (p?.timer) clearTimeout(p.timer);
    pacing.delete(target);
  }

  /**
   * The state with the lock-screen buttons' key added when it offers options
   * (a fresh key per question), or cleared once it doesn't.
   */
  function withAsk(
    target: string,
    state: LiveState,
    ask?: Readonly<Record<string, unknown>>,
  ): LiveState {
    const buttons = state.phase === "needsYou" && ask ? askButtons(ask) : null;
    if (!buttons) {
      asks.delete(target);
      const { askId: _a, askKey: _k, options: _o, recommended: _r, ...plain } = state;
      return plain;
    }
    const cur = asks.get(target);
    const key = cur?.askId === buttons.askId ? cur.key : randomBytes(16).toString("hex");
    asks.set(target, { ...buttons, key });
    return {
      ...state,
      askId: buttons.askId,
      askKey: key,
      options: buttons.labels,
      ...(buttons.recommended === null ? {} : { recommended: buttons.recommended }),
    };
  }

  function apply(target: string, change: Change): void {
    if (change.kind === "end") {
      asks.delete(target);
      states.delete(target);
      clearPace(target);
      const reg = regs.get(target);
      // The activity is over; its token is spent.
      regs.delete(target);
      if (reg) void send(target, reg, change.state, "end");
      return;
    }
    states.set(target, change.state);
    const reg = regs.get(target);
    if (!reg) return;
    let p = pacing.get(target);
    if (!p) {
      p = { lastSentAt: Number.NEGATIVE_INFINITY, pending: null, timer: null };
      pacing.set(target, p);
    }
    const t = now();
    if (change.kind === "phase") {
      // Supersedes anything waiting.
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      p.pending = null;
      p.lastSentAt = t;
      void send(target, reg, change.state, "phase");
      return;
    }
    const wait = p.lastSentAt + minInterval - t;
    if (wait <= 0 && !p.timer) {
      p.lastSentAt = t;
      void send(target, reg, change.state, "routine");
      return;
    }
    // Inside the window: keep only the newest state; one trailing send.
    p.pending = change.state;
    if (!p.timer) {
      const entry = p;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        const next = entry.pending;
        entry.pending = null;
        const r = regs.get(target);
        if (!next || !r) return;
        entry.lastSentAt = now();
        void send(target, r, next, "routine");
      }, wait);
      entry.timer.unref?.();
    }
  }

  async function alert(
    target: string,
    a: LiveAlertText,
    describe: () => LiveAttributes | null,
  ): Promise<boolean> {
    const apns = opts.apns;
    if (!apns?.configured) return false;
    const full: LiveActivityAlert = {
      title: clipText(a.title, 120),
      body: clipText(a.body, 200),
      sound: "default",
    };
    const state: LiveState = states.get(target) ?? {
      phase: "needsYou",
      line: "Needs your help",
      detail: clipText(a.body, DETAIL_MAX) || null,
      startedAt: now() / 1000,
    };
    const reg = regs.get(target);
    if (reg) {
      clearPace(target);
      if (await send(target, reg, state, "phase", full)) return true;
      // Only a 410 (registration forgotten) falls through to a fresh start.
      if (regs.has(target)) return false;
    }
    const attrs = describe();
    if (!attrs) return false;
    const tokens = (opts.startTokens?.() ?? []).filter(
      (s) => apns.env === undefined || s.env === apns.env,
    );
    // One start per phone, like notify(): re-pairing leaves duplicate tokens.
    const unique = [...new Map(tokens.map((s) => [s.token, s])).values()];
    if (!unique.length) return false;
    const attributes: Record<string, unknown> = {
      kind: attrs.kind,
      title: clipText(attrs.title, TITLE_MAX),
      ...(attrs.sessionId ? { sessionId: attrs.sessionId } : {}),
      ...(attrs.groupId ? { groupId: attrs.groupId } : {}),
    };
    const results = await Promise.all(
      unique.map((s) =>
        apns
          .liveActivity(
            { token: s.token, env: s.env },
            {
              event: "start",
              attributesType: ATTRIBUTES_TYPE,
              attributes,
              contentState: { ...state },
              alert: full,
              staleDate: nowS() + STALE_AFTER_S,
              priority: 10,
            },
          )
          .catch((e: unknown) => {
            log(`[live] ${target} start failed: ${String(e)}`);
            return "failed" as const;
          }),
      ),
    );
    log(`[live] ${target} start → ${results.join(", ")}`);
    return results.includes("ok");
  }

  return {
    onFrame(sessionId, frame) {
      const target = `s:${sessionId}`;
      const change = reduceFrame(states.get(target), frame, now());
      if (!change) return;
      const state = withAsk(
        target,
        change.state,
        frame.type === "ask_user" ? frame.data : undefined,
      );
      apply(target, { kind: change.kind, state });
    },
    claimAnswer(target, askId, key, choice) {
      const a = asks.get(target);
      if (!a || a.askId !== askId || !Number.isInteger(choice)) return null;
      const want = Buffer.from(a.key);
      const got = Buffer.from(key);
      if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
      const value = a.values[choice];
      if (value === undefined) return null;
      asks.delete(target);
      return { questionId: a.questionId, value };
    },
    async set(target, live, o = {}) {
      const prev = states.get(target);
      const at = now() / 1000;
      const end = isEnd(live.phase);
      const state: LiveState = withAsk(
        target,
        {
          phase: live.phase,
          line: clipText(live.line, LINE_MAX),
          ...(live.detail ? { detail: clipText(live.detail, DETAIL_MAX) } : {}),
          startedAt: o.fresh || !prev ? at : prev.startedAt,
          ...(end ? { endedAt: at } : {}),
        },
        live.ask,
      );
      if (o.alert && !end) {
        states.set(target, state);
        return alert(target, o.alert, o.describe ?? ((): null => null));
      }
      if (end && !prev) return false;
      const kind: ChangeKind = end
        ? "end"
        : prev?.phase === live.phase && !o.fresh
          ? "routine"
          : "phase";
      apply(target, { kind, state });
      return false;
    },
    alert,
    register(target, reg) {
      // The phone reports a token as it starts following an activity and again
      // as iOS hands it over: once is enough.
      const had = regs.get(target);
      if (had && had.token === reg.token && had.deviceId === reg.deviceId) return;
      regs.set(target, reg);
      clearPace(target);
      log(`[live] ${target} registered for ${reg.deviceId} (${reg.env})`);
      // The phone registers a moment after starting the activity: catch it up.
      const state = states.get(target);
      if (state) {
        pacing.set(target, { lastSentAt: now(), pending: null, timer: null });
        void send(target, reg, state, "phase");
      }
    },
    unregister(target, deviceId) {
      const r = regs.get(target);
      if (!r || r.deviceId !== deviceId) return false;
      regs.delete(target);
      return true;
    },
    dropDevice(deviceId) {
      for (const [t, r] of regs) if (r.deviceId === deviceId) regs.delete(t);
    },
    registration: (target) => regs.get(target),
    state: (target) => states.get(target),
    async flush() {
      while (chains.size) await Promise.all([...chains.values()]);
    },
    stop() {
      for (const p of pacing.values()) if (p.timer) clearTimeout(p.timer);
      pacing.clear();
    },
  };
}
