// A live conversation with Kleio's voice: OpenAI Realtime over WebRTC.
//
// The microphone goes straight to OpenAI and her voice comes straight back;
// the Mac mini only sets the call up (it holds the OpenAI key, kleio-host
// voice.ts). Events arrive on the "oai-events" data channel: captions, and
// tool calls this device runs (voiceTools.ts) before telling her the result.

import { useSyncExternalStore } from "react";
import { isPhone } from "../platform";
import { KleioApiError, startVoiceCall } from "./kleioApi";
import { createVoiceTools, type VoiceTools } from "./voiceTools";

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
}

const IDLE: CallState = { phase: "idle", lines: [], muted: false, error: null };
const LINES_KEPT = 40;
/** After she says goodbye: let the last words play out before hanging up. */
const HANGUP_GRACE_MS = 2_500;

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

interface Live {
  readonly pc: RTCPeerConnection;
  readonly mic: MediaStream;
  readonly audio: HTMLAudioElement;
  readonly channel: RTCDataChannel;
  readonly tools: VoiceTools;
  /** Partial captions by item id, until each is final. */
  readonly partial: Map<string, { who: CallLine["who"]; text: string }>;
  hangup: ReturnType<typeof setTimeout> | null;
}

let live: Live | null = null;
/** Bumped per call: a slow start must not revive a call already ended. */
let callSeq = 0;

function addLine(who: CallLine["who"], text: string): void {
  const t = text.trim();
  if (!t) return;
  set({ lines: [...state.lines, { who, text: t }].slice(-LINES_KEPT) });
}

/** The caption being spoken, shown before it is final. */
export function partialLines(): CallLine[] {
  return live ? [...live.partial.values()].filter((p) => p.text.trim()) : [];
}

function send(event: Record<string, unknown>): void {
  if (live?.channel.readyState === "open") live.channel.send(JSON.stringify(event));
}

async function onEvent(e: Record<string, unknown>): Promise<void> {
  const L = live;
  if (!L) return;
  const type = typeof e.type === "string" ? e.type : "";
  const itemId = typeof e.item_id === "string" ? e.item_id : "";
  switch (type) {
    case "input_audio_buffer.speech_started":
      if (L.hangup === null) set({ phase: "listening" });
      return;
    case "input_audio_buffer.speech_stopped":
      // Before her reply to it: a "yes" counts by the time she calls send_plan.
      L.tools.userSpoke();
      set({ phase: "thinking" });
      return;
    case "conversation.item.input_audio_transcription.completed":
      addLine("you", typeof e.transcript === "string" ? e.transcript : "");
      return;
    case "response.output_audio_transcript.delta": {
      const p = L.partial.get(itemId) ?? { who: "kleio" as const, text: "" };
      p.text += typeof e.delta === "string" ? e.delta : "";
      L.partial.set(itemId, p);
      set({ phase: "speaking" });
      return;
    }
    case "response.output_audio_transcript.done":
      L.partial.delete(itemId);
      addLine("kleio", typeof e.transcript === "string" ? e.transcript : "");
      return;
    // Her voice is playing (the caption may lag behind it).
    case "output_audio_buffer.started":
      set({ phase: "speaking" });
      return;
    case "output_audio_buffer.stopped":
      if (state.phase === "speaking") set({ phase: "listening" });
      return;
    case "response.function_call_arguments.done": {
      const name = typeof e.name === "string" ? e.name : "";
      const callId = typeof e.call_id === "string" ? e.call_id : "";
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(typeof e.arguments === "string" ? e.arguments : "{}");
        if (typeof parsed === "object" && parsed !== null) args = parsed as Record<string, unknown>;
      } catch {
        /* the tool says what's missing */
      }
      set({ phase: "thinking" });
      const output = await L.tools.run(name, args);
      if (live !== L) return;
      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      });
      if (name !== "end_conversation") send({ type: "response.create" });
      return;
    }
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
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = (ev) => {
      audio.srcObject = ev.streams[0] ?? null;
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
      log: (l) => console.info(l),
    });
    live = { pc, mic, audio, channel, tools, partial: new Map(), hangup: null };
    channel.addEventListener("message", (m) => {
      try {
        const parsed: unknown = JSON.parse(String(m.data));
        if (typeof parsed === "object" && parsed !== null)
          void onEvent(parsed as Record<string, unknown>);
      } catch {
        /* not JSON */
      }
    });
    channel.addEventListener("open", () => {
      // She opens the conversation: a greeting, and anything that needs them.
      send({
        type: "response.create",
        response: {
          instructions:
            "Greet the user in one short sentence. If something needs them, say so in a sentence; otherwise ask what they'd like.",
        },
      });
    });
    pc.addEventListener("connectionstatechange", () => {
      if (
        live?.pc === pc &&
        (pc?.connectionState === "failed" || pc?.connectionState === "closed")
      ) {
        endCall("The connection dropped.");
      }
    });
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
    if (L.hangup) clearTimeout(L.hangup);
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

export function setMuted(muted: boolean): void {
  for (const t of live?.mic.getAudioTracks() ?? []) t.enabled = !muted;
  set({ muted });
}
