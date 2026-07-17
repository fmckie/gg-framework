import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err, summarizeList } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import {
  keepRangesFromSilences,
  parseSilenceDetect,
  silencesToFrameRanges,
} from "../core/silence.js";

const DetectSilenceParams = z.object({
  input: z.string().describe("Media file (video or audio). ffmpeg reads the audio stream."),
  noiseDb: z
    .number()
    .optional()
    .describe("Threshold in dB below which is silent (default -30, more negative = stricter)."),
  minDurationSec: z
    .number()
    .positive()
    .optional()
    .describe("Minimum silence length to report (default 0.5s)."),
  paddingSec: z
    .number()
    .min(0)
    .optional()
    .describe("Padding around keep-ranges so cuts don't slice syllables (default 0.1s)."),
  returnKeeps: z
    .boolean()
    .optional()
    .describe(
      "If true (default), return KEEP ranges (the inverse) plus frame-aligned versions — " +
        "feed straight into write_edl. If false, return raw silence ranges only.",
    ),
  frameRate: z
    .number()
    .positive()
    .optional()
    .describe("Used to add frame-aligned ranges. Auto-detected from probe if omitted."),
});

export function createDetectSilenceTool(cwd: string): AgentTool<typeof DetectSilenceParams> {
  return {
    name: "detect_silence",
    description:
      "Find silent regions in an audio/video file via ffmpeg silencedetect. " +
      "Default returns KEEP ranges (the parts to keep, with optional padding) plus frame-aligned " +
      "versions ready for write_edl. " +
      "Workflow: probe_media → detect_silence → write_edl(events=keeps) → import_edl.",
    parameters: DetectSilenceParams,
    async execute(
      {
        input,
        noiseDb = -30,
        minDurationSec = 0.5,
        paddingSec = 0.1,
        returnKeeps = true,
        frameRate,
      },
      ctx,
    ) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      const abs = resolvePath(cwd, input);

      // Probe for fps + duration. fps is needed for frame alignment; duration
      // closes any unterminated trailing silence the filter omits.
      const probe = probeMedia(abs);
      if (!probe) return err(`probe failed for ${abs}`, "verify file exists and is media");
      const fps = frameRate ?? probe.frameRate ?? 30;
      const totalSec = probe.durationSec;

      // Run silencedetect. "-f null -" discards output; the filter writes to stderr.
      const r = await runFfmpeg(
        [
          "-i",
          abs,
          "-af",
          `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
          "-f",
          "null",
          "-",
        ],
        { signal: ctx.signal },
      );
      if (r.code !== 0) {
        return err(`ffmpeg exited ${r.code}`, "check input file is valid media");
      }

      const silences = parseSilenceDetect(r.stderr, totalSec);

      if (!returnKeeps) {
        const summary = summarizeList(silences, 30);
        return compact({
          ranges: silences,
          totalSec,
          fps,
          count: summary.total,
          omitted: summary.omitted,
          ...(summary.omitted > 0 ? { head: summary.head, tail: summary.tail } : {}),
        });
      }

      const keeps = keepRangesFromSilences(silences, totalSec, paddingSec);
      const keepFrames = silencesToFrameRanges(keeps, fps);

      // Pair keep seconds with their frame-aligned versions for direct EDL use.
      const events = keeps.map((k, i) => ({
        startSec: k.startSec,
        endSec: k.endSec,
        startFrame: keepFrames[i]?.startFrame ?? 0,
        endFrame: keepFrames[i]?.endFrame ?? 0,
      }));
      const summary = summarizeList(events, 30);

      return compact({
        totalSec,
        fps,
        silences: silences.length,
        keeps: summary.total,
        omitted: summary.omitted,
        ...(summary.omitted > 0 ? { head: summary.head, tail: summary.tail } : { events }),
      });
    },
  };
}
