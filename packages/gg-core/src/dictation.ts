/**
 * Dictation: a short spoken clip in, composer-ready text out, transcribed on
 * this machine with Whisper (@huggingface/transformers: no API keys, and the
 * audio never leaves the user's own devices).
 *
 * The iPhone and Mac apps record 16 kHz mono 16-bit PCM and send it to the
 * sidecar on the host they are paired with. The flow follows Ken's
 * Vape-n-Vibe desktop dictation: skip clips that are too short or silent
 * (Whisper invents text for silence), trim the quiet ends, transcribe with the
 * project vocabulary as Whisper's prompt, drop non-speech tags and filler
 * words, then fix how project names are written.
 *
 * The model itself comes from Kleio's own pinned, checked download
 * (dictation-model.ts), started from Settings → Setup or by the first clip.
 */

import {
  downloadModel,
  modelBytes,
  modelDir,
  verifiedOnDisk,
  WHISPER_MODEL,
  type ModelDownloadError,
  type SpeechModel,
} from "./dictation-model.js";
import { log } from "./logger.js";

export const DICTATION_SAMPLE_RATE = 16_000;
/** Longest clip accepted. 2 minutes of PCM is 3.84 MB (5.1 MB as base64). */
export const DICTATION_MAX_SECONDS = 120;

const BYTES_PER_SAMPLE = 2;
const MAX_PCM_BYTES = DICTATION_SAMPLE_RATE * BYTES_PER_SAMPLE * DICTATION_MAX_SECONDS;
const MAX_BASE64_CHARS = Math.ceil(MAX_PCM_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Whisper hallucinates on sub-second clips. */
const MIN_CLIP_SAMPLES = DICTATION_SAMPLE_RATE / 2;
/** 50 ms analysis windows. */
const SEGMENT_SAMPLES = DICTATION_SAMPLE_RATE / 20;
/** Vape-n-Vibe's silence threshold (RMS 150 on 16-bit samples), as a float. */
const SILENCE_RMS = 150 / 32_768;
/** Audio kept either side of the speech so word edges are not clipped. */
const TRIM_GUARD_SAMPLES = Math.round(DICTATION_SAMPLE_RATE * 0.12);
/** Whisper reads at most 30 s at once; longer speech is transcribed in chunks. */
const SINGLE_PASS_MAX_SAMPLES = DICTATION_SAMPLE_RATE * 30;
/**
 * Below this, the vocabulary prompt outweighs the speech and pulls the text
 * toward jargon (Ken's Vape-n-Vibe rule).
 */
const PROMPT_MIN_SAMPLES = DICTATION_SAMPLE_RATE * 1.5;
/** Whisper's decoder positions (config max_target_positions), prompt included. */
const WHISPER_MAX_TOKENS = 448;

/**
 * Project names dictation should hear and spell right: Whisper's prompt, and
 * the terms correctVocabulary fixes. Measured on 13 real iPhone recordings:
 * names right went from 18 of 30 to 29 of 30, with none added.
 */
export const DICTATION_VOCABULARY = [
  "pnpm",
  "TypeScript",
  "Tauri",
  "Kleio",
  "Mac mini",
  "Tailscale",
  "GitHub Actions",
  "Whisper",
  "ONNX",
  "Hugging Face",
  "Node",
  "Vite",
  "React",
  "Vitest",
  "Cargo",
  "Xcode",
  "Zod",
  "Anthropic",
  "Claude",
  "Moonshot",
  "sherpa",
  "Parakeet",
  "Electron",
  "Rust",
  "Biome",
  "OpenAI",
  "Kimi",
  "Tinfoil",
  "SwiftUI",
  "Homebrew",
] as const satisfies readonly string[];

/** Whisper's prompt: the vocabulary, after <|startofprev|>. */
const PROMPT_TEXT = ` ${DICTATION_VOCABULARY.join(", ")}`;

export type PcmDecodeResult =
  { ok: true; value: Float32Array } | { ok: false; error: "invalid_audio" | "too_long" };

/** Decode base64 16-bit little-endian mono PCM into float samples. */
export function decodePcm16(base64: string): PcmDecodeResult {
  if (base64.length > MAX_BASE64_CHARS) return { ok: false, error: "too_long" };
  if (base64.length % 4 !== 0 || !BASE64.test(base64)) {
    return { ok: false, error: "invalid_audio" };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length % BYTES_PER_SAMPLE !== 0) return { ok: false, error: "invalid_audio" };
  const samples = new Float32Array(bytes.length / BYTES_PER_SAMPLE);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = bytes.readInt16LE(i * BYTES_PER_SAMPLE) / 32_768;
  }
  return { ok: true, value: samples };
}

/**
 * The span of `samples` that holds speech, with a short guard either side, or
 * null when the clip is too short or never rises above the silence threshold.
 */
export function trimToSpeech(samples: Float32Array): Float32Array | null {
  if (samples.length < MIN_CLIP_SAMPLES) return null;
  let first = -1;
  let last = -1;
  for (let start = 0; start + SEGMENT_SAMPLES <= samples.length; start += SEGMENT_SAMPLES) {
    let sumSquares = 0;
    for (let i = start; i < start + SEGMENT_SAMPLES; i++) {
      const v = samples[i] ?? 0;
      sumSquares += v * v;
    }
    if (Math.sqrt(sumSquares / SEGMENT_SAMPLES) > SILENCE_RMS) {
      if (first < 0) first = start;
      last = start + SEGMENT_SAMPLES;
    }
  }
  if (first < 0) return null;
  return samples.subarray(
    Math.max(0, first - TRIM_GUARD_SAMPLES),
    Math.min(samples.length, last + TRIM_GUARD_SAMPLES),
  );
}

/** Vape-n-Vibe's filler list: "um", "uh", "erm", "hmm" and their variants. */
const FILLER_WORDS = /\s*\b(?:umm?|uhh?|uhm|erm?|hmm?)\b[,.!?]?(?=\s|$)/gi;
/** Nothing but punctuation left: Whisper's output for noise. */
const PUNCTUATION_ONLY = /^[\s.!?…,;:*()#\-_]*$/;

/** A filler opening the text, so the next word lost its capital. */
const LEADING_FILLER = /^(?:umm?|uhh?|uhm|erm?|hmm?)\b/i;
/** A filler opening a later sentence: its next word gets the capital. */
const SENTENCE_FILLER = /([.!?]\s+)(?:umm?|uhh?|uhm|erm?|hmm?)\b[,.!?]?\s+(\p{Ll})/giu;

/** Whisper's raw text, minus non-speech tags ("[BLANK_AUDIO]", "(music)") and fillers. */
export function cleanTranscript(raw: string): string {
  const speech = raw
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .trim();
  const text = speech
    .replace(SENTENCE_FILLER, (_m, end: string, next: string) => end + next.toUpperCase())
    .replace(FILLER_WORDS, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/^[,.!?]\s*/, "")
    .trim();
  if (PUNCTUATION_ONLY.test(text)) return "";
  return LEADING_FILLER.test(speech) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const VOCABULARY_BY_SQUASH: ReadonlyMap<string, string> = new Map(
  DICTATION_VOCABULARY.map((term) => [squash(term), term]),
);
/** Longest term, in words ("GitHub Actions" is 2; "tin foil" heard for one is 2). */
const MAX_RUN_WORDS = 3;
const ARTICLES: ReadonlySet<string> = new Set(["the", "a", "an"]);

/**
 * The project term that `tokens[start..]` spells, as a replacement, or null.
 * Only exact matches once case, spaces and punctuation are ignored: a one-letter
 * allowance would turn "code" into Xcode and "open a" into OpenAI.
 */
function termAt(
  tokens: readonly string[],
  start: number,
  first: boolean,
): { text: string; words: number } | null {
  for (let words = MAX_RUN_WORDS; words >= 1; words--) {
    if (start + words > tokens.length) continue;
    const run = tokens.slice(start, start + words);
    const head = (run[0] ?? "").toLowerCase().replace(/^[,.]+|[,.]+$/g, "");
    if (words > 1 && ARTICLES.has(head)) continue;
    const core = run.join(" ");
    const term = VOCABULARY_BY_SQUASH.get(squash(core));
    if (term === undefined) continue;
    const lead = /^[^\p{L}\p{N}]*/u.exec(core)?.[0] ?? "";
    const trail = /[^\p{L}\p{N}]*$/u.exec(core)?.[0] ?? "";
    const body = core.slice(lead.length, core.length - trail.length);
    if (body === term) return null;
    const capital = first && /^\p{Lu}/u.test(body) && /^\p{Ll}/u.test(term);
    const spelled = capital ? term.charAt(0).toUpperCase() + term.slice(1) : term;
    return { text: lead + spelled + trail, words };
  }
  return null;
}

/**
 * Write project names the way the project does: "tail scale" becomes
 * Tailscale, "PNPM" pnpm, "open AI" OpenAI. Punctuation around a name stays.
 */
export function correctVocabulary(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const fix = termAt(tokens, i, out.length === 0);
    if (fix) {
      out.push(fix.text);
      i += fix.words;
    } else {
      out.push(tokens[i] ?? "");
      i += 1;
    }
  }
  return out.join(" ");
}

/** Why the speech model couldn't be got ready. The details stay in the host's log. */
export type DictationFailure =
  /** The host couldn't reach Hugging Face. */
  | "offline"
  /** Hugging Face answered with an error. */
  | "server"
  /** The pinned model is gone from Hugging Face. */
  | "missing"
  /** The host couldn't save the files (space, permissions, a read-only disk). */
  | "storage"
  /** A download didn't match the pin and was thrown away. */
  | "integrity"
  /** The files are here but the engine couldn't load them. */
  | "load";

/**
 * Where dictation's model is, for Settings → Setup and the chat box. `bytes`
 * is the whole model's size, in every state.
 */
export type DictationStatus =
  | { readonly state: "absent"; readonly bytes: number }
  | { readonly state: "downloading"; readonly loaded: number; readonly bytes: number }
  | { readonly state: "loading"; readonly bytes: number }
  | { readonly state: "ready"; readonly bytes: number }
  | { readonly state: "failed"; readonly reason: DictationFailure; readonly bytes: number }
  /** The speech engine has no build for this host (an Intel Mac, for one). */
  | {
      readonly state: "unsupported";
      readonly os: string;
      readonly arch: string;
      readonly bytes: number;
    };

/** transcribe() couldn't get the model ready; `reason` says why, in words a device can show. */
export class DictationUnavailableError extends Error {
  constructor(readonly reason: DictationFailure | "unsupported") {
    super(`dictation is unavailable: ${reason}`);
    this.name = "DictationUnavailableError";
  }
}

export interface Dictation {
  /**
   * Transcribe speech samples (16 kHz mono). Resolves "" when nothing was
   * said. Waits for the model when it isn't ready yet, and throws
   * DictationUnavailableError when it can't be got.
   */
  transcribe(samples: Float32Array, signal?: AbortSignal): Promise<string>;
  /** Where the model is. A few file stats at most; never downloads or loads. */
  status(): Promise<DictationStatus>;
  /** Get the model ready (download, then load), or join the run under way. */
  prepare(): void;
  /** Shutting down: a download stops (its `.part` stays for next time) and nothing new starts. */
  dispose(): void;
}

export interface DictationOptions {
  /** The models folder (`~/.gg/models`); the model sits in `<cacheDir>/<hub id>`. */
  readonly cacheDir: string;
  /** Stand-in for Whisper (tests). */
  readonly loadModel?: () => Promise<DictationModel>;
  /** Loads the speech engine, throwing where it can't run (tests). */
  readonly loadEngine?: () => Promise<unknown>;
  /** The model to download (tests use a small one). */
  readonly model?: SpeechModel;
  /** Download seams (tests). */
  readonly fetch?: typeof fetch;
  readonly freeBytes?: (dir: string) => Promise<number>;
  readonly baseUrl?: string;
}

/** The parts of Whisper dictation uses, so tests can stand one in. */
export interface DictationModel {
  /** <|startofprev|>: text after it is a prompt, not speech. */
  readonly previousTextId: number;
  /** <|startoftranscript|><|notimestamps|>. */
  readonly startIds: readonly number[];
  encode(text: string): number[];
  /** Tokens for up to 30 s of speech, decoding on from `prefix`. */
  generate(samples: Float32Array, prefix: readonly number[]): Promise<number[]>;
  /** Text of `tokens`, without special tokens. */
  decode(tokens: readonly number[]): string;
  /** Speech over 30 s, transcribed in overlapping chunks without a prompt. */
  transcribeLong(samples: Float32Array): Promise<string>;
}

/**
 * Load Whisper from the files Kleio downloaded and checked into `dir`. An
 * absolute folder isn't a Hub id, so transformers reads those files and nothing
 * else: no question to the Hub, no global settings, and a restart works
 * offline.
 */
async function loadWhisper(dir: string): Promise<DictationModel> {
  const { pipeline, Tensor } = await import("@huggingface/transformers");
  const asr = await pipeline("automatic-speech-recognition", dir, {
    // Full-precision encoder (the accuracy), 8-bit decoder (the speed).
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    local_files_only: true,
  });
  const encode = (text: string): number[] =>
    asr.tokenizer.encode(text, { add_special_tokens: false });
  const special = (token: string): number => {
    const [id, ...rest] = encode(token);
    if (id === undefined || rest.length > 0) throw new Error(`Whisper has no ${token} token`);
    return id;
  };
  return {
    previousTextId: special("<|startofprev|>"),
    startIds: [special("<|startoftranscript|>"), special("<|notimestamps|>")],
    encode,
    async generate(samples, prefix) {
      const features: unknown = (await asr.processor(samples)).input_features;
      if (!(features instanceof Tensor)) throw new Error("Whisper could not read the audio");
      const out = await asr.model.generate({
        inputs: features,
        decoder_input_ids: [...prefix],
        max_new_tokens: WHISPER_MAX_TOKENS - prefix.length,
      });
      if (!(out instanceof Tensor)) throw new Error("Whisper returned no tokens");
      const rows: unknown = out.tolist();
      const first: unknown = Array.isArray(rows) ? rows[0] : undefined;
      if (!Array.isArray(first)) throw new Error("Whisper returned no tokens");
      return first.map((id: unknown) => Number(id));
    },
    decode: (tokens) => asr.tokenizer.decode([...tokens], { skip_special_tokens: true }),
    async transcribeLong(samples) {
      const out = await asr(samples, { chunk_length_s: 30, stride_length_s: 5 });
      const text: unknown = Array.isArray(out) ? out[0]?.text : out.text;
      return typeof text === "string" ? text : "";
    },
  };
}

function startsWith(tokens: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((id, i) => tokens[i] === id);
}

/** Up to 30 s of speech, with the vocabulary prompt when there is enough speech. */
async function transcribeOnce(
  whisper: DictationModel,
  prompt: readonly number[],
  samples: Float32Array,
): Promise<string> {
  const prefix =
    samples.length >= PROMPT_MIN_SAMPLES
      ? [whisper.previousTextId, ...prompt, ...whisper.startIds]
      : [...whisper.startIds];
  const tokens = await whisper.generate(samples, prefix);
  // The output repeats the prefix; slice it off so the prompt is never text.
  return whisper.decode(startsWith(tokens, prefix) ? tokens.slice(prefix.length) : tokens);
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What a failed download leaves in the host's log: the kind, and its detail. */
function downloadFailureDetail(error: ModelDownloadError): Record<string, string> {
  switch (error.kind) {
    case "offline":
    case "storage":
      return { reason: error.kind, detail: error.detail };
    case "server":
    case "missing":
      return { reason: error.kind, status: String(error.status) };
    case "integrity":
      return { reason: error.kind, file: error.file };
    case "aborted":
      return { reason: error.kind };
  }
}

/** `promise`, unless `signal` aborts first: the clip stops waiting, the run goes on. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

interface Loaded {
  readonly whisper: DictationModel;
  readonly prompt: readonly number[];
}

/** How a run ended. "stopped": dispose() ended it. */
type RunResult =
  | { readonly ok: true; readonly value: Loaded }
  | { readonly ok: false; readonly reason: DictationFailure | "unsupported" | "stopped" };

/** What this process knows beyond the disk. "idle": nothing yet, so the disk says. */
type Phase =
  | { readonly state: "idle" }
  | { readonly state: "downloading"; readonly loaded: number }
  | { readonly state: "loading" }
  | { readonly state: "ready" }
  | { readonly state: "failed"; readonly reason: DictationFailure }
  | { readonly state: "unsupported" };

/**
 * Whisper, got ready on demand. One run (engine check, download, load) serves
 * Settings → Setup and clips alike: later callers join it, and after a failure
 * the next call starts a fresh one. Clips are transcribed one at a time.
 */
export function createDictation(options: DictationOptions): Dictation {
  const model = options.model ?? WHISPER_MODEL;
  const bytes = modelBytes(model);
  const loadModel = options.loadModel ?? (() => loadWhisper(modelDir(options.cacheDir, model)));
  const loadEngine = options.loadEngine ?? (() => import("@huggingface/transformers"));
  const stop = new AbortController();
  let phase: Phase = { state: "idle" };
  let loaded: Loaded | null = null;
  let run: Promise<RunResult> | null = null;
  let engine: Promise<boolean> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  /** Whether the speech engine runs here. Asked once: the answer can't change. */
  const engineRuns = (): Promise<boolean> => {
    engine ??= loadEngine().then(
      () => true,
      (e: unknown) => {
        log("ERROR", "dictation", "the speech engine can't run on this host", {
          platform: `${process.platform}-${process.arch}`,
          error: describeError(e),
        });
        return false;
      },
    );
    return engine;
  };

  const getReady = async (): Promise<RunResult> => {
    // The engine first: nothing downloads for an engine that can't run here.
    if (!(await engineRuns())) {
      phase = { state: "unsupported" };
      return { ok: false, reason: "unsupported" };
    }
    if (!(await verifiedOnDisk(options.cacheDir, model))) {
      phase = { state: "downloading", loaded: 0 };
      const got = await downloadModel(options.cacheDir, {
        model,
        fetch: options.fetch,
        freeBytes: options.freeBytes,
        baseUrl: options.baseUrl,
        signal: stop.signal,
        onProgress: (n) => {
          phase = { state: "downloading", loaded: n };
        },
      });
      if (!got.ok) {
        if (got.error.kind === "aborted") {
          phase = { state: "idle" };
          return { ok: false, reason: "stopped" };
        }
        log("ERROR", "dictation", "couldn't download the speech model", {
          model: model.id,
          ...downloadFailureDetail(got.error),
        });
        phase = { state: "failed", reason: got.error.kind };
        return { ok: false, reason: got.error.kind };
      }
      log("INFO", "dictation", "speech model downloaded and checked", {
        model: model.id,
        revision: model.revision,
      });
    }
    phase = { state: "loading" };
    const whisper = await loadModel();
    loaded = { whisper, prompt: whisper.encode(PROMPT_TEXT) };
    phase = { state: "ready" };
    return { ok: true, value: loaded };
  };

  /** The loaded model, or the one run that gets it. Never rejects. */
  const ensure = (): Promise<RunResult> => {
    if (loaded) return Promise.resolve({ ok: true, value: loaded });
    if (stop.signal.aborted) return Promise.resolve({ ok: false, reason: "stopped" });
    if (phase.state === "unsupported") return Promise.resolve({ ok: false, reason: "unsupported" });
    if (run) return run;
    // Before the run's first await, so a status() straight after prepare() shows it under way.
    phase = { state: "loading" };
    const current = getReady()
      .catch((e: unknown): RunResult => {
        log("ERROR", "dictation", "couldn't load the speech model", { error: describeError(e) });
        phase = { state: "failed", reason: "load" };
        return { ok: false, reason: "load" };
      })
      .then((result) => {
        run = null;
        return result;
      });
    run = current;
    return current;
  };

  return {
    transcribe(samples, signal) {
      const job = queue.then(async () => {
        signal?.throwIfAborted();
        const got = await unlessAborted(ensure(), signal);
        if (!got.ok) {
          if (got.reason === "stopped") throw new Error("dictation has shut down");
          throw new DictationUnavailableError(got.reason);
        }
        signal?.throwIfAborted();
        const { whisper, prompt } = got.value;
        const raw =
          samples.length > SINGLE_PASS_MAX_SAMPLES
            ? await whisper.transcribeLong(samples)
            : await transcribeOnce(whisper, prompt, samples);
        return correctVocabulary(cleanTranscript(raw));
      });
      queue = job.catch(() => undefined);
      return job;
    },

    async status() {
      const now = phase;
      switch (now.state) {
        case "idle":
          return (await verifiedOnDisk(options.cacheDir, model))
            ? { state: "ready", bytes }
            : { state: "absent", bytes };
        case "downloading":
          return { state: "downloading", loaded: now.loaded, bytes };
        case "loading":
        case "ready":
          return { state: now.state, bytes };
        case "failed":
          return { state: "failed", reason: now.reason, bytes };
        case "unsupported":
          return { state: "unsupported", os: process.platform, arch: process.arch, bytes };
      }
    },

    prepare() {
      // ensure() never rejects; the run's outcome is read back through status().
      void ensure();
    },

    dispose() {
      stop.abort();
    },
  };
}
