// Kleio's spoken voice for "Brief me" when Talk to Kleio isn't set up: the
// system's own speech (Web Speech API: AVSpeechSynthesizer under WKWebView),
// so it is free, private and works offline. The best woman's voice installed,
// preferring the natural-sounding ones.

import { useSyncExternalStore } from "react";

/** Speaking rate: a touch quicker than the system's, still easy to follow. */
export const DEFAULT_RATE = 1.05;
/** Long text is spoken a sentence or two at a time: some engines stop on very long utterances. */
const CHUNK_MAX = 220;

/**
 * The Apple voices that are women's, by name (as macOS and iOS ship them):
 * 2 for the natural-sounding ones, 1 for the older, more robotic ones.
 */
const FEMALE: ReadonlyMap<string, number> = new Map([
  ...[
    "Samantha",
    "Moira",
    "Karen",
    "Tessa",
    "Serena",
    "Kate",
    "Stephanie",
    "Fiona",
    "Martha",
    "Catherine",
    "Allison",
    "Ava",
    "Susan",
    "Zoe",
    "Nicky",
    "Veena",
    "Isha",
  ].map((n): [string, number] => [n.toLowerCase(), 2]),
  ...["Victoria", "Kathy", "Shelley", "Sandy", "Flo", "Grandma"].map((n): [string, number] => [
    n.toLowerCase(),
    1,
  ]),
]);
/** The novelty voices: not offered. */
const NOVELTY =
  /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

function baseName(v: SpeechSynthesisVoice): string {
  return v.name.replace(/\s*\((?:Enhanced|Premium)\)\s*$/i, "").trim();
}

function isNatural(v: SpeechSynthesisVoice): boolean {
  return /\b(?:enhanced|premium)\b/i.test(`${v.name} ${v.voiceURI}`);
}

/** 2: a natural woman's voice, 1: an older woman's voice, 0: not a woman's. */
function femaleRank(v: SpeechSynthesisVoice): number {
  return FEMALE.get(baseName(v).toLowerCase()) ?? 0;
}

function isEnglish(v: SpeechSynthesisVoice): boolean {
  return /^en[-_]/i.test(v.lang) && !NOVELTY.test(v.name);
}

/** How good a default this voice is: a woman's, natural, the user's English. */
function score(v: SpeechSynthesisVoice, local: string): number {
  return (
    femaleRank(v) * 8 +
    (isNatural(v) ? 4 : 0) +
    (v.lang.replace("_", "-").toLowerCase() === local ? 2 : 0) +
    (/^en[-_](GB|IE)/i.test(v.lang) ? 1 : 0)
  );
}

function byName(a: SpeechSynthesisVoice, b: SpeechSynthesisVoice): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** The voice to speak with: the best woman's voice installed, else the system's default. */
export function pickVoice(
  all: readonly SpeechSynthesisVoice[],
  local = navigatorLang(),
): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  for (const v of all.filter(isEnglish)) {
    const d = best ? score(v, local) - score(best, local) : 1;
    if (d > 0 || (best && d === 0 && byName(v, best) < 0)) best = v;
  }
  return best ?? all.find((v) => v.default) ?? null;
}

function navigatorLang(): string {
  return typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "en-gb";
}

/**
 * Sentences, grouped into pieces of at most `max` characters. A sentence ends
 * at . ! ? or … followed by a space, so "host.ts" stays one word.
 */
export function chunks(text: string, max = CHUNK_MAX): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (".!?…".includes(text.charAt(i)) && /\s/.test(text.charAt(i + 1))) {
      sentences.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  sentences.push(text.slice(start).trim());
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (!s) continue;
    if (cur && `${cur} ${s}`.length > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

// ── The speaker ────────────────────────────────────────────────────────────

export type SpeakState = "idle" | "speaking";

const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

/** Whether this device can speak at all. */
export function canSpeak(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance !== "undefined";
}

/** The voices, once the system has listed them (it may take a moment after launch). */
export async function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return [];
  const now = s.getVoices();
  if (now.length) return now;
  return new Promise((resolve) => {
    const done = (): void => {
      s.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve(s.getVoices());
    };
    const timer = setTimeout(done, timeoutMs);
    s.addEventListener("voiceschanged", done);
  });
}

let state: SpeakState = "idle";
/** The utterance being said (see speak()). */
let current: SpeechSynthesisUtterance | null = null;
/** Bumped per speak(): a stale utterance's end event must not end a newer one. */
let token = 0;
const listeners = new Set<() => void>();

function setState(next: SpeakState): void {
  if (state === next) return;
  state = next;
  for (const l of listeners) l();
}

/**
 * Call straight from a tap or click, before anything async: the iPhone only
 * lets a page start speaking from a user's gesture, and the briefing arrives
 * after a network call.
 */
export function primeSpeech(): void {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === "undefined") return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  s.speak(u);
}

/** Stop speaking now. */
export function stopSpeaking(): void {
  token++;
  current = null;
  synth()?.cancel();
  setState("idle");
}

/**
 * Say `text` in Kleio's voice. Resolves when it has been said, or when it was
 * stopped (false). Never throws: a device that cannot speak resolves false.
 */
export async function speak(text: string): Promise<boolean> {
  const s = synth();
  if (!s || !text.trim()) return false;
  stopSpeaking();
  const mine = ++token;
  const voice = pickVoice(await loadVoices());
  if (mine !== token) return false;
  setState("speaking");
  for (const piece of chunks(text)) {
    const said = await new Promise<boolean>((resolve) => {
      const u = new SpeechSynthesisUtterance(piece);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = DEFAULT_RATE;
      // An engine that never says it finished must not leave Kleio "speaking"
      // for ever: well past the time the piece takes, carry on.
      const guard = setTimeout(() => resolve(true), 8_000 + piece.length * 160);
      const finish = (ok: boolean): void => {
        clearTimeout(guard);
        if (current === u) current = null;
        resolve(ok);
      };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      // Held until it ends: an utterance nothing refers to can lose its end event.
      current = u;
      s.speak(u);
    });
    if (!said || mine !== token) {
      if (mine === token) setState("idle");
      return false;
    }
  }
  if (mine === token) {
    current = null;
    setState("idle");
  }
  return true;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether Kleio is speaking, for a component. */
export function useSpeaking(): boolean {
  return useSyncExternalStore(subscribe, () => state === "speaking");
}
