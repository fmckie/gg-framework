// Kleio's spoken voice for "Brief me": the system's own speech (Web Speech
// API: AVSpeechSynthesizer under WKWebView), so it is free, private and works
// offline. A woman's voice by default, preferring the natural-sounding ones;
// the user can pick another in Settings.

import { useSyncExternalStore } from "react";

const VOICE_KEY = "kleio:voice";
const RATE_KEY = "kleio:voice-rate";
/** Default speaking rate: a touch quicker than the system's, still easy to follow. */
export const DEFAULT_RATE = 1.05;
const RATE_MIN = 0.8;
const RATE_MAX = 1.4;
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

export interface VoiceChoice {
  /** The voice's id (its voiceURI), stable across launches. */
  id: string;
  /** "Moira (Irish)". */
  label: string;
  female: boolean;
  /** Enhanced / Premium: the natural-sounding downloads. */
  natural: boolean;
}

const REGION: Record<string, string> = {
  GB: "British",
  IE: "Irish",
  AU: "Australian",
  US: "American",
  ZA: "South African",
  IN: "Indian",
  NZ: "New Zealand",
  CA: "Canadian",
  SC: "Scottish",
};

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

function regionOf(lang: string): string {
  const r = lang.replace("_", "-").split("-")[1]?.toUpperCase() ?? "";
  return REGION[r] ?? r;
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

/** English voices for the picker, best defaults first, novelty voices out. */
export function englishVoices(
  all: readonly SpeechSynthesisVoice[],
  local = navigatorLang(),
): VoiceChoice[] {
  const seen = new Set<string>();
  const out: VoiceChoice[] = [];
  const sorted = all
    .filter(isEnglish)
    .sort((a, b) => score(b, local) - score(a, local) || byName(a, b));
  for (const v of sorted) {
    if (seen.has(v.voiceURI)) continue;
    seen.add(v.voiceURI);
    const natural = isNatural(v);
    const region = regionOf(v.lang);
    const quality = natural
      ? /premium/i.test(`${v.name} ${v.voiceURI}`)
        ? "premium"
        : "enhanced"
      : "";
    const notes = [region, quality].filter(Boolean).join(", ");
    out.push({
      id: v.voiceURI,
      label: notes ? `${baseName(v)} (${notes})` : baseName(v),
      female: femaleRank(v) > 0,
      natural,
    });
  }
  return out;
}

/** The voice to speak with: the saved one if it is still installed, else the best woman's voice. */
export function pickVoice(
  all: readonly SpeechSynthesisVoice[],
  saved: string | null,
  local = navigatorLang(),
): SpeechSynthesisVoice | null {
  if (saved) {
    const v = all.find((x) => x.voiceURI === saved);
    if (v) return v;
  }
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

// ── Settings ───────────────────────────────────────────────────────────────

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts this launch */
  }
}

export function savedVoice(): string | null {
  return read(VOICE_KEY);
}

export function setSavedVoice(id: string | null): void {
  write(VOICE_KEY, id);
}

export function savedRate(): number {
  const n = Number(read(RATE_KEY));
  return Number.isFinite(n) && n >= RATE_MIN && n <= RATE_MAX ? n : DEFAULT_RATE;
}

export function setSavedRate(rate: number): void {
  write(RATE_KEY, String(Math.min(RATE_MAX, Math.max(RATE_MIN, rate))));
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
  const voice = pickVoice(await loadVoices(), savedVoice());
  if (mine !== token) return false;
  const rate = savedRate();
  setState("speaking");
  for (const piece of chunks(text)) {
    const said = await new Promise<boolean>((resolve) => {
      const u = new SpeechSynthesisUtterance(piece);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = rate;
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
