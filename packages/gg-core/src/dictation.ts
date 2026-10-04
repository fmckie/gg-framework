/**
 * Dictation: a short spoken clip in, composer-ready text out, transcribed on
 * this machine with Whisper (@huggingface/transformers: no API keys, and the
 * audio never leaves the user's own devices).
 *
 * The iPhone records 16 kHz mono 16-bit PCM and sends it to the sidecar on the
 * Mac it is paired with. The flow follows Ken's Vape-n-Vibe desktop dictation:
 * skip clips that are too short or silent (Whisper invents text for silence),
 * trim the quiet ends, transcribe with the project vocabulary as Whisper's
 * prompt, drop non-speech tags and filler words, then fix how project names
 * are written.
 */

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
/**
 * English Whisper "base": about 140 MB, downloaded once. On an M-series Mac a
 * 10 s clip transcribes in about half a second, with better casing of terms
 * like "TypeScript" than "small" managed in the same test.
 */
const MODEL_ID = "onnx-community/whisper-base.en";
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

export interface Dictation {
  /** Transcribe speech samples (16 kHz mono). Resolves "" when nothing was said. */
  transcribe(samples: Float32Array, signal?: AbortSignal): Promise<string>;
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

async function loadWhisper(cacheDir: string): Promise<DictationModel> {
  const { pipeline, Tensor } = await import("@huggingface/transformers");
  const asr = await pipeline("automatic-speech-recognition", MODEL_ID, {
    // Full-precision encoder (the accuracy), 8-bit decoder (the speed).
    dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    cache_dir: cacheDir,
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

/**
 * A lazily loaded Whisper. The model downloads into `cacheDir` on first use;
 * clips are transcribed one at a time.
 */
export function createDictation(options: {
  cacheDir: string;
  /** Stand-in for Whisper (tests). */
  loadModel?: () => Promise<DictationModel>;
}): Dictation {
  const loadModel = options.loadModel ?? (() => loadWhisper(options.cacheDir));
  let loaded: Promise<{ whisper: DictationModel; prompt: number[] }> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = (): Promise<{ whisper: DictationModel; prompt: number[] }> => {
    if (loaded) return loaded;
    const loading = (async () => {
      const whisper = await loadModel();
      return { whisper, prompt: whisper.encode(PROMPT_TEXT) };
    })();
    loaded = loading;
    // A failed download must not stick: the next clip tries again.
    loading.catch(() => {
      if (loaded === loading) loaded = null;
    });
    return loading;
  };

  return {
    transcribe(samples, signal) {
      const run = queue.then(async () => {
        signal?.throwIfAborted();
        const { whisper, prompt } = await load();
        signal?.throwIfAborted();
        const raw =
          samples.length > SINGLE_PASS_MAX_SAMPLES
            ? await whisper.transcribeLong(samples)
            : await transcribeOnce(whisper, prompt, samples);
        return correctVocabulary(cleanTranscript(raw));
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
