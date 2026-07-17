import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { safeOutputPath } from "../core/safe-paths.js";
import { detectApiKey, detectLocalWhisper, transcribe } from "../core/whisper.js";

const TranscribeParams = z.object({
  input: z.string().describe("Audio/video file path (.wav recommended; ≤25MB for API backend)."),
  output: z
    .string()
    .describe("Where to save the full transcript JSON. Used by read_transcript later."),
  backend: z.enum(["local", "api", "whisperx", "auto"]).optional(),
  modelPath: z
    .string()
    .optional()
    .describe("Path to whisper.cpp ggml model. Required for local backend."),
  apiModel: z
    .enum(["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe-diarize"])
    .optional()
    .describe(
      "OpenAI transcription model. Default 'whisper-1' — the only one with word/segment " +
        "timestamps (needed for burn_subtitles). 'gpt-4o-transcribe' has higher accuracy but " +
        "text-only (no segments). 'gpt-4o-transcribe-diarize' returns speaker-labelled " +
        "segments without needing whisperx/HF_TOKEN — prefer this for speaker analysis.",
    ),
  language: z.string().optional().describe("ISO-639-1 code (e.g. 'en'). Auto-detected if omitted."),
  wordTimestamps: z
    .boolean()
    .optional()
    .describe(
      "Request per-word timestamps (needed for word-by-word burned captions). " +
        "Local whisper.cpp uses -ml=1 mode; OpenAI uses timestamp_granularities=word. " +
        "Only effective with whisper-1 backend (gpt-4o-* don't support word-level timing).",
    ),
  diarize: z
    .boolean()
    .optional()
    .describe(
      "Local diarization via whisperx + pyannote. Requires `whisperx` on PATH and " +
        "HF_TOKEN env (free Hugging Face account). For server-side diarization with no " +
        "local install, set apiModel='gpt-4o-transcribe-diarize' instead. " +
        "Use this BEFORE detect_speaker_changes — if diarization succeeds you don't need the heuristic.",
    ),
  whisperxModel: z
    .string()
    .optional()
    .describe("whisperx model size (tiny/base/small/medium/large-v3). Default 'base'."),
  chunkingStrategy: z
    .enum(["auto"])
    .optional()
    .describe(
      "Server-side chunking for the gpt-4o-transcribe family. 'auto' lets OpenAI " +
        "normalize loudness, run VAD, and process clips up to ~25 min within the 25MB cap. " +
        "Auto-enabled for gpt-4o-transcribe-diarize on inputs >30s.",
    ),
});

export function createTranscribeTool(cwd: string): AgentTool<typeof TranscribeParams> {
  return {
    name: "transcribe",
    description:
      "Transcribe audio/video to text with timestamps. Writes full transcript JSON to `output`; " +
      "returns compact summary (lang, segment count, duration) plus head/tail samples. " +
      "Use read_transcript to query the file by time/text. " +
      "Backends: 'local' (whisper.cpp), 'api' (OpenAI — see apiModel for model choice), " +
      "or 'whisperx' (local diarization). For speaker labels without a local install, " +
      "use backend='api' + apiModel='gpt-4o-transcribe-diarize'.",
    parameters: TranscribeParams,
    async execute(args, ctx) {
      const { input, output, backend, modelPath, language } = args;
      try {
        const inAbs = resolvePath(cwd, input);
        const outAbs = safeOutputPath(cwd, output);

        const want = backend === "auto" ? undefined : backend;
        const local = detectLocalWhisper();
        const haveApiKey = !!detectApiKey();

        if (!want && !local && !haveApiKey) {
          return err(
            "no transcription backend available",
            "install whisper.cpp + pass modelPath, or set OPENAI_API_KEY",
          );
        }

        const t = await transcribe(inAbs, {
          backend: want,
          modelPath,
          apiModel: args.apiModel,
          language,
          wordTimestamps: args.wordTimestamps,
          diarize: args.diarize,
          whisperxModel: args.whisperxModel,
          chunkingStrategy: args.chunkingStrategy,
          signal: ctx.signal,
        });

        mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, JSON.stringify(t), "utf8");

        // LLM-shaped summary. Don't dump 500 segments inline — agent uses
        // read_transcript to query the saved file.
        const head = t.segments.slice(0, 3).map((s) => ({
          start: +s.start.toFixed(2),
          end: +s.end.toFixed(2),
          text: s.text,
        }));
        const tail =
          t.segments.length > 6
            ? t.segments.slice(-3).map((s) => ({
                start: +s.start.toFixed(2),
                end: +s.end.toFixed(2),
                text: s.text,
              }))
            : [];

        const wordsTotal = t.segments.reduce((acc, s) => acc + (s.words?.length ?? 0), 0);
        const speakers = new Set(t.segments.map((s) => s.speaker).filter((x): x is string => !!x));
        return compact({
          ok: true,
          path: outAbs,
          lang: t.language,
          dur: +t.durationSec.toFixed(2),
          segments: t.segments.length,
          ...(args.wordTimestamps ? { words: wordsTotal } : {}),
          ...(speakers.size > 0 ? { speakers: [...speakers].sort() } : {}),
          head,
          ...(tail.length > 0 ? { tail } : {}),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
