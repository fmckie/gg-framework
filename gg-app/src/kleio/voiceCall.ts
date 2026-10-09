// A live conversation with Kleio's voice: OpenAI GPT-Live over WebRTC.
//
// The microphone goes straight to OpenAI and her voice comes straight back;
// the Mac mini only sets the call up (it holds the OpenAI key, kleio-host
// voice.ts). Events arrive on the "oai-events" data channel: captions, and the
// tool calls of the backend GPT-Live hands work to, which this device runs
// (voiceTools.ts) before giving the backend the results.

import { useSyncExternalStore } from "react";
import { isPhone } from "../platform";
import { holdAwake, type AwakeHold } from "./keepAwake";
import { KleioApiError, startVoiceCall } from "./kleioApi";
import { createVoiceTools, type ShownFile, type ToolOutput, type VoiceTools } from "./voiceTools";
import { meterStream, type LevelMeter } from "./voiceLevels";

export type CallPhase = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended";

export interface CallLine {
  readonly who: "you" | "kleio";
  readonly text: string;
}

export interface CallState {
  readonly phase: CallPhase;
  /** The conversation so far, captions as they arrive (newest last). */
  readonly lines: readonly CallLine[];
  readonly muted: boolean;
  /** Why the call couldn't start or stopped, in words for the screen. */
  readonly error: string | null;
  /** The file she put on the screen (show_file), over the call; null when none. */
  readonly shown: ShownFile | null;
}

const IDLE: CallState = { phase: "idle", lines: [], muted: false, error: null, shown: null };
const LINES_KEPT = 40;
/** After she says goodbye: let the last words play out before hanging up. */
const HANGUP_GRACE_MS = 2_500;
/** GPT-Live marks no turn ends: this long without captions ends one. */
const QUIET_MS = 1_200;
/** Nobody has talked for this long: she hangs up (GPT-Live bills every second, quiet ones too). */
const IDLE_HANGUP_MIN = 2;
const IDLE_HANGUP_MS = IDLE_HANGUP_MIN * 60_000;
/** What counts as someone talking, or her working; usage updates and the like don't. */
const ACTIVITY: ReadonlySet<string> = new Set([
  "session.input_transcript.delta",
  "session.output_transcript.delta",
  "session.delegation.created",
  "response.event",
]);
/** Her opening, once the session has started: a welcome, never a status report.
 *  ("Hi there, nothing is pressing right now, what do you want to do next?" was
 *  the flat version: it led with what wasn't happening.) */
export const GREETING =
  "Open the conversation now, and make them feel welcome, like someone who's glad they called. Greet them for the time of day (good morning, good afternoon or good evening), and by name if you know it. If something in what's new needs them or has just finished, mention the most useful one in a sentence. If nothing does, don't say so and don't list what isn't happening: just ask, warmly and in your own words, what you can help with. Keep it to two or three short sentences, then stop and listen.";

/** A failed start or a dropped call, in words for the screen. */
export function callError(e: unknown): string {
  if (e instanceof DOMException && e.name === "NotAllowedError") {
    return "Kleio needs your microphone. Allow it in your system settings, then try again.";
  }
  if (e instanceof KleioApiError) {
    switch (e.message) {
      case "no_key":
        return "Kleio's voice isn't set up yet. Add an OpenAI key in Settings, under Kleio's voice.";
      case "bad_key":
        return "OpenAI didn't accept the key on your Mac mini. Check it in Settings.";
      case "no_credit":
        return "Your OpenAI account is out of credit. Add some on platform.openai.com, then try again.";
      case "unreachable":
        return "Your Mac mini couldn't reach OpenAI. Check its internet connection.";
      case "forbidden":
        return "This device can't start a conversation.";
    }
    if (e.status === 0) return "I couldn't reach your Mac mini. Check it's on and connected.";
    if (e.status === 404) return "Your Mac mini needs the latest Kleio before you can talk to her.";
    return e.detail
      ? `OpenAI said: ${e.detail}`
      : "Something went wrong starting the conversation.";
  }
  return "Something went wrong starting the conversation.";
}

// ── The call (one at a time) ───────────────────────────────────────────────

let state: CallState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<CallState>): void {
  // Captions arrive many times a second: a patch that changes nothing keeps the
  // same state, so the voice screen and its WebGL canvases don't re-render.
  const keys = Object.keys(patch) as (keyof CallState)[];
  if (keys.every((key) => Object.is(state[key], patch[key]))) return;
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function callState(): CallState {
  return state;
}

export function useCall(): CallState {
  return useSyncExternalStore(subscribe, callState);
}

/** Whether the voice screen is showing; re-renders only when that changes, not as she talks. */
export function useCallOpen(): boolean {
  return useSyncExternalStore(subscribe, () => state.phase !== "idle");
}

/** A tool call from the backend, running here until its turn is complete. */
interface PendingCall {
  readonly callId: string;
  readonly name: string;
  readonly output: Promise<ToolOutput>;
}

interface Live {
  readonly pc: RTCPeerConnection;
  readonly mic: MediaStream;
  readonly audio: HTMLAudioElement;
  readonly channel: RTCDataChannel;
  readonly tools: VoiceTools;
  /** The caption being spoken, yours or hers, until it is final. */
  readonly partial: Map<CallLine["who"], { who: CallLine["who"]; text: string }>;
  /** Ends the turn being spoken after a pause. */
  quiet: ReturnType<typeof setTimeout> | null;
  /** Work handed to the backend, by delegation id, with its unanswered tool calls. */
  readonly working: Map<string, readonly PendingCall[]>;
  hangup: ReturnType<typeof setTimeout> | null;
  /** Hangs up after IDLE_HANGUP_MS with nobody talking. */
  idle: ReturnType<typeof setTimeout> | null;
  /** How loud she and you are (the orb); null until her voice arrives. */
  herLevel: LevelMeter | null;
  readonly yourLevel: LevelMeter | null;
  /** Keeps the display awake (and the Mac from idling to sleep) once connected. */
  awake: AwakeHold | null;
  /** Stops listening for the page going away. */
  readonly unhook: () => void;
}

let live: Live | null = null;
/** Bumped per call: a slow start must not revive a call already ended. */
let callSeq = 0;

function addLine(who: CallLine["who"], text: string): void {
  const t = text.trim();
  if (!t) return;
  set({ lines: [...state.lines, { who, text: t }].slice(-LINES_KEPT) });
}

/** How loud she (out) and you (in) are right now, 0–1; zeros between calls. */
export function callLevels(): { readonly out: number | null; readonly in: number | null } {
  const L = live;
  if (!L) return { out: null, in: null };
  // Null where it isn't measured (the iPhone, or before her voice arrives):
  // the orb then moves with what she's doing instead.
  return {
    out: L.herLevel ? L.herLevel.read() : null,
    in: state.muted ? 0 : L.yourLevel ? L.yourLevel.read() : null,
  };
}

/** The caption being spoken, shown before it is final. */
export function partialLines(): CallLine[] {
  return live ? [...live.partial.values()].filter((p) => p.text.trim()) : [];
}

function send(event: Record<string, unknown>): void {
  if (live?.channel.readyState === "open") live.channel.send(JSON.stringify(event));
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** A web search the backend ran itself (a hosted tool): nothing to run here. */
export function isWebSearch(item: unknown): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "web_search_call"
  );
}

/** A finished function call among the backend's output items; null for anything else. */
export function functionCall(item: unknown): {
  readonly callId: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
} | null {
  if (typeof item !== "object" || item === null) return null;
  const i = item as Record<string, unknown>;
  if (i.type !== "function_call" || typeof i.call_id !== "string" || typeof i.name !== "string") {
    return null;
  }
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text(i.arguments) || "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    /* the tool says what's missing */
  }
  return { callId: i.call_id, name: i.name, args };
}

/** Moves the caption being spoken into the conversation. */
function flush(L: Live, who: CallLine["who"]): void {
  const p = L.partial.get(who);
  if (!p) return;
  L.partial.delete(who);
  addLine(who, p.text);
}

/** A caption as it is spoken: the other side speaking, or a pause, ends this turn. */
function caption(L: Live, who: CallLine["who"], delta: string): void {
  flush(L, who === "you" ? "kleio" : "you");
  const p = L.partial.get(who) ?? { who, text: "" };
  p.text += delta;
  L.partial.set(who, p);
  if (L.quiet) clearTimeout(L.quiet);
  L.quiet = setTimeout(() => settle(L), QUIET_MS);
}

/** A pause: the captions are final, and she listens (or works, while the backend does). */
function settle(L: Live): void {
  L.quiet = null;
  if (live !== L) return;
  for (const who of [...L.partial.keys()]) flush(L, who);
  if (L.hangup === null) set({ phase: L.working.size > 0 ? "thinking" : "listening" });
}

/** A delegation's work is over: she listens again, unless she's talking or still working. */
function finished(L: Live, delegation: string): void {
  L.working.delete(delegation);
  if (L.working.size === 0 && L.quiet === null && L.hangup === null && state.phase === "thinking") {
    set({ phase: "listening" });
  }
}

/** Someone talked, or she's working: the quiet countdown starts again. */
function active(L: Live): void {
  if (L.idle) clearTimeout(L.idle);
  L.idle = setTimeout(() => {
    if (live === L) endCall(`Hung up after ${IDLE_HANGUP_MIN} minutes of quiet.`);
  }, IDLE_HANGUP_MS);
}

/**
 * The backend's work on a delegation (its Responses events, forwarded): run
 * its tool calls here, give it every result, then let it carry on.
 */
async function onBackend(L: Live, delegation: string, event: unknown): Promise<void> {
  if (typeof event !== "object" || event === null) return;
  const ev = event as Record<string, unknown>;
  const type = typeof ev.type === "string" ? ev.type : "";
  switch (type) {
    case "response.output_item.done": {
      // She read the web: what it says can't start anything until they speak.
      if (isWebSearch(ev.item)) {
        L.tools.noteRead();
        return;
      }
      const fc = functionCall(ev.item);
      if (!fc) return;
      // Started now; the results go back together once its turn is complete.
      const output = L.tools
        .run(fc.name, fc.args)
        .catch((err: unknown): ToolOutput => ({ error: String(err) }));
      const calls = L.working.get(delegation) ?? [];
      L.working.set(delegation, [...calls, { callId: fc.callId, name: fc.name, output }]);
      return;
    }
    case "response.completed": {
      const calls = L.working.get(delegation) ?? [];
      if (calls.length === 0) {
        finished(L, delegation);
        return;
      }
      L.working.set(delegation, []);
      const results = await Promise.all(calls.map(async (c) => ({ c, output: await c.output })));
      if (live !== L) return;
      for (const { c, output } of results) {
        send({
          type: "response.item.create",
          item: { type: "function_call_output", call_id: c.callId, output: JSON.stringify(output) },
        });
      }
      // Hanging up: there's nothing more to say.
      if (calls.some((c) => c.name === "end_conversation")) finished(L, delegation);
      else send({ type: "response.create" });
      return;
    }
    case "response.failed":
    case "response.incomplete":
      console.warn(`[voice] the backend's work stopped: ${type}`);
      finished(L, delegation);
      return;
  }
}

async function onEvent(e: Record<string, unknown>): Promise<void> {
  const L = live;
  if (!L) return;
  const type = typeof e.type === "string" ? e.type : "";
  if (ACTIVITY.has(type)) active(L);
  switch (type) {
    case "session.started":
      // She opens the conversation: a greeting, and anything that needs them.
      send({ type: "session.instructions.append", delegation_id: null, content: GREETING });
      return;
    case "session.input_transcript.delta":
      // A new utterance: a "yes" counts by the time the backend calls send_plan.
      if (!L.partial.has("you")) L.tools.userSpoke();
      caption(L, "you", text(e.delta));
      if (L.hangup === null) set({ phase: "listening" });
      return;
    case "session.output_transcript.delta":
      caption(L, "kleio", text(e.delta));
      set({ phase: "speaking" });
      return;
    case "session.delegation.created": {
      const d = e.delegation as { id?: unknown } | undefined;
      if (typeof d?.id === "string" && !L.working.has(d.id)) L.working.set(d.id, []);
      if (!L.partial.has("kleio") && L.hangup === null) set({ phase: "thinking" });
      return;
    }
    case "response.event":
      await onBackend(L, text(e.delegation_id), e.event);
      return;
    case "session.closed":
      endCall();
      return;
    case "error": {
      const err = e.error as { message?: unknown } | undefined;
      console.warn("[voice] OpenAI error:", typeof err?.message === "string" ? err.message : e);
      return;
    }
  }
}

/** Start talking to Kleio. Call it from a tap or click (the microphone asks then). */
export async function startCall(): Promise<void> {
  if (live || state.phase === "connecting") return;
  const mine = ++callSeq;
  set({ ...IDLE, phase: "connecting" });
  let mic: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  const started = Date.now();
  try {
    if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("This device can't make voice calls.");
    }
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    pc = new RTCPeerConnection();
    // Volume meters feed the desktop's floating orb; the iPhone has none, and
    // its call audio is left exactly as it was.
    const metering = !isPhone();
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? null;
      audio.srcObject = stream;
      // Meter her voice for the orb (measuring only; the <audio> plays it).
      if (metering && stream && live?.pc === pc && !live.herLevel) {
        live.herLevel = meterStream(stream);
      }
    };
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
    const channel = pc.createDataChannel("oai-events");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const answer = await startVoiceCall(offer.sdp ?? "", isPhone() ? "near" : "far");
    if (mine !== callSeq) throw new Error("ended");
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    // Closed or hung up while connecting: don't bring the call back.
    if (mine !== callSeq) throw new Error("ended");

    const tools = createVoiceTools({
      onEnd: () => {
        const L = live;
        if (!L || L.hangup) return;
        L.hangup = setTimeout(() => endCall(), HANGUP_GRACE_MS);
      },
      onSent: (to) => addLine("kleio", `(Sent to ${to}.)`),
      onMade: (what) => addLine("kleio", `(Made ${what}.)`),
      onShow: (file) => {
        if (live?.pc === pc) set({ shown: file });
      },
      log: (l) => console.info(l),
    });
    // The page closing or reloading ends the call (and lets the Mac sleep again).
    const onPageHide = (): void => {
      if (live?.pc === pc) endCall();
    };
    window.addEventListener("pagehide", onPageHide);
    live = {
      pc,
      mic,
      audio,
      channel,
      tools,
      partial: new Map(),
      quiet: null,
      working: new Map(),
      hangup: null,
      idle: null,
      herLevel:
        metering && audio.srcObject instanceof MediaStream ? meterStream(audio.srcObject) : null,
      yourLevel: metering ? meterStream(mic) : null,
      awake: null,
      unhook: () => window.removeEventListener("pagehide", onPageHide),
    };
    active(live);
    channel.addEventListener("message", (m) => {
      try {
        const parsed: unknown = JSON.parse(String(m.data));
        if (typeof parsed === "object" && parsed !== null)
          void onEvent(parsed as Record<string, unknown>);
      } catch {
        /* not JSON */
      }
    });
    // Awake from when the call is really connected until it ends (endCall).
    const stayAwake = (): void => {
      if (live?.pc === pc && pc?.connectionState === "connected" && !live.awake) {
        live.awake = holdAwake();
      }
    };
    pc.addEventListener("connectionstatechange", () => {
      if (
        live?.pc === pc &&
        (pc?.connectionState === "failed" || pc?.connectionState === "closed")
      ) {
        endCall("The connection dropped.");
      } else {
        stayAwake();
      }
    });
    stayAwake();
    console.info(`[voice] connected in ${Date.now() - started} ms`);
    set({ phase: "listening" });
  } catch (e) {
    for (const t of mic?.getTracks() ?? []) t.stop();
    pc?.close();
    if (mine !== callSeq) return;
    console.warn("[voice] couldn't start:", e);
    set({
      phase: "ended",
      error: e instanceof Error && e.message === "ended" ? null : callError(e),
    });
  }
}

/** Hang up. */
export function endCall(reason?: string): void {
  callSeq++;
  const L = live;
  live = null;
  if (L) {
    L.awake?.release();
    L.unhook();
    if (L.hangup) clearTimeout(L.hangup);
    if (L.quiet) clearTimeout(L.quiet);
    if (L.idle) clearTimeout(L.idle);
    // Ends the session (and its per-second billing) straight away.
    if (L.channel.readyState === "open") L.channel.send(JSON.stringify({ type: "session.close" }));
    L.herLevel?.stop();
    L.yourLevel?.stop();
    for (const t of L.mic.getTracks()) t.stop();
    L.audio.srcObject = null;
    L.channel.close();
    L.pc.close();
  }
  set({ phase: "ended", error: reason ?? null });
}

/**
 * Close the conversation screen. Ends the call too, even one still
 * connecting: that start then stops and releases the microphone.
 */
export function resetCall(): void {
  if (state.phase !== "idle" && state.phase !== "ended") endCall();
  set(IDLE);
}

/** Close the file she's showing; the call carries on. */
export function closeShownFile(): void {
  set({ shown: null });
}

export function setMuted(muted: boolean): void {
  for (const t of live?.mic.getAudioTracks() ?? []) t.enabled = !muted;
  set({ muted });
}
