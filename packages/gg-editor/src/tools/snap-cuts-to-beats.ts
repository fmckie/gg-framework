import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { detectBeats, snapCuts } from "../core/beats.js";
import { compact, err } from "../core/format.js";
import { findPython } from "../core/python.js";

const SnapCutsToBeatsParams = z.object({
  audio: z
    .string()
    .describe(
      "Path to an audio or video file (relative resolves to cwd). Librosa loads it via " +
        "soundfile/audioread, so most containers work — but feeding pure music or a music " +
        "bed gives much better beat detection than dialogue alone.",
    ),
  cutPoints: z
    .array(z.number().min(0))
    .min(1)
    .describe(
      "Proposed cut times in seconds — typically the boundaries from cut_filler_words.keeps, " +
        "detect_silence, or hand-picked moments. Each is snapped to its nearest beat within " +
        "toleranceSec; cuts beyond the tolerance pass through unchanged.",
    ),
  toleranceSec: z
    .number()
    .positive()
    .max(2)
    .optional()
    .describe(
      "Maximum distance (seconds) a cut may move to land on a beat. Default 0.25s — large " +
        "enough to catch the off-by-half-a-beat case, small enough to preserve speech timing. " +
        "Bump to 0.5 for music-driven montage; tighten to 0.1 if dialog is the focus.",
    ),
  sampleRate: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Override librosa's load sample rate (default 22050). Bump to 44100 if the input is " +
        "very short and you need finer beat resolution.",
    ),
});

/**
 * snap_cuts_to_beats — the music-driven cut primitive. CapCut ships this
 * as "Auto Beat" and it's the single biggest reason their music shorts
 * feel snappy. We expose it as a pure data tool: in → cut points; out →
 * beat-aligned cut points. The agent then feeds the result to cut_at /
 * add_sfx_at_cuts / punch_in for the actual edit.
 */
export function createSnapCutsToBeatsTool(cwd: string): AgentTool<typeof SnapCutsToBeatsParams> {
  return {
    name: "snap_cuts_to_beats",
    description:
      "Snap a list of proposed cut times to the nearest beat in a music track via librosa " +
      "beat-tracking. The CapCut 'Auto Beat' look — music-driven cuts that pop on the kick. " +
      "REQUIRES python3 + `pip install librosa numpy soundfile`. Pass `audio` (the song / " +
      "music bed) and `cutPoints` (from cut_filler_words.keeps, detect_silence, or " +
      "hand-picked). Default tolerance 0.25s; cuts beyond it stay where they were. " +
      "Returns {tempo, totalBeats, snapped:[{originalSec,snappedSec,deltaSec,beatIdx}], " +
      "unchanged:[...]} — feed `snapped[].snappedSec` to cut_at / add_sfx_at_cuts / punch_in.",
    parameters: SnapCutsToBeatsParams,
    async execute(args, ctx) {
      if (!findPython()) {
        return err(
          "Python 3 not on PATH",
          "install python3 and librosa: pip install librosa numpy soundfile",
        );
      }
      try {
        const audioAbs = resolvePath(cwd, args.audio);
        const tol = args.toleranceSec ?? 0.25;

        let result;
        try {
          result = await detectBeats(audioAbs, {
            signal: ctx.signal,
            sampleRate: args.sampleRate,
          });
        } catch (e) {
          // Surface the most likely fix for the most common failure (missing deps).
          const msg = (e as Error).message;
          if (/missing python dep/i.test(msg)) {
            return err(msg, "pip install librosa numpy soundfile");
          }
          if (/malformed output|empty stdout|unexpected shape/i.test(msg)) {
            return err(msg);
          }
          return err(msg);
        }

        if (!result.beats || result.beats.length === 0) {
          return err(
            "no beats detected; verify audio has music or rhythmic content",
            "drop the snap; raw cut points stand",
          );
        }

        const { snapped, unchanged } = snapCuts(args.cutPoints, result.beats, tol);

        return compact({
          tempo: round(result.tempo, 2),
          totalBeats: result.beats.length,
          durationSec: round(result.durationSec, 3),
          toleranceSec: tol,
          snapped: snapped.map((s) => ({
            originalSec: round(s.originalSec, 3),
            snappedSec: round(s.snappedSec, 3),
            deltaSec: round(s.deltaSec, 3),
            beatIdx: s.beatIdx,
          })),
          unchanged: unchanged.map((u) => ({
            atSec: round(u.atSec, 3),
            nearestBeatDeltaSec:
              u.nearestBeatDeltaSec !== undefined ? round(u.nearestBeatDeltaSec, 3) : undefined,
          })),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function round(n: number, places: number): number {
  if (!Number.isFinite(n)) return n;
  const m = 10 ** places;
  return Math.round(n * m) / m;
}
