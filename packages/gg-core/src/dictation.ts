/**
 * Dictation: a short spoken clip in, composer-ready text out, transcribed on
 * this machine with Whisper (@huggingface/transformers: no API keys, and the
 * audio never leaves the user's own devices).
 *
 * The iPhone records 16 kHz mono 16-bit PCM and sends it to the sidecar on the
 * Mac it is paired with. The flow follows Ken's Vape-n-Vibe desktop dictation:
 * skip clips that are too short or silent (Whisper invents text for silence),
 * trim the quiet ends, transcribe, then drop non-speech tags and filler words.
 */

import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

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

export interface Dictation {
  /** Transcribe speech samples (16 kHz mono). Resolves "" when nothing was said. */
  transcribe(samples: Float32Array, signal?: AbortSignal): Promise<string>;
}

/**
 * A lazily loaded Whisper. The model downloads into `cacheDir` on first use;
 * clips are transcribed one at a time.
 */
export function createDictation(options: { cacheDir: string }): Dictation {
  let model: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = (): Promise<AutomaticSpeechRecognitionPipeline> => {
    if (model) return model;
    const loading = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("automatic-speech-recognition", MODEL_ID, {
        // Full-precision encoder (the accuracy), 8-bit decoder (the speed).
        dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
        cache_dir: options.cacheDir,
      });
    })();
    model = loading;
    // A failed download must not stick: the next clip tries again.
    loading.catch(() => {
      if (model === loading) model = null;
    });
    return loading;
  };

  return {
    transcribe(samples, signal) {
      const run = queue.then(async () => {
        signal?.throwIfAborted();
        const asr = await load();
        signal?.throwIfAborted();
        const out = await asr(samples, { chunk_length_s: 30, stride_length_s: 5 });
        const text = Array.isArray(out) ? out[0]?.text : out.text;
        return cleanTranscript(text ?? "");
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
