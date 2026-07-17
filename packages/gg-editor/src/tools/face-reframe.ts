import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { analyzeReframe, buildReframeFilter, type Aspect } from "../core/face-reframe.js";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { findPython } from "../core/python.js";
import { safeOutputPath } from "../core/safe-paths.js";

const FaceReframeParams = z.object({
  input: z.string().describe("Source video (relative resolves to cwd)."),
  output: z
    .string()
    .describe(
      "Output mp4 (relative resolves to cwd; sandbox-safe paths only). Re-encoded video; " +
        "audio is copied through.",
    ),
  aspect: z
    .enum(["9:16", "1:1", "4:5", "16:9"])
    .describe(
      "Target aspect ratio. 9:16 for Reels/Shorts/TikTok; 1:1 for Instagram feed; 4:5 for " +
        "vertical-feed; 16:9 for letterboxing odd footage to delivery. Aspect math is " +
        "computed against source dimensions.",
    ),
  strategy: z
    .enum(["face", "motion", "static"])
    .optional()
    .describe(
      "Tracking strategy. 'face' (default) follows the largest face per shot via MediaPipe; " +
        "'static' centre-crops the whole video without analysis (cheap fallback). 'motion' " +
        "is reserved — currently treated as 'face'.",
    ),
  sampleFps: z
    .number()
    .positive()
    .max(30)
    .optional()
    .describe(
      "Frames-per-second to face-detect at. Default 5. Higher = smoother tracking + slower; " +
        "lower = faster + jumpier. 5 is the sweet spot for talking-head shorts.",
    ),
  smoothingWindowSec: z
    .number()
    .positive()
    .optional()
    .describe(
      "Smoothing window for the per-shot centre. Default 0.5s. The sidecar uses the median " +
        "over each shot which already rejects spikes; this knob is informational right now.",
    ),
  videoCodec: z.string().optional().describe("Default libx264."),
  crf: z.number().int().min(0).max(51).optional().describe("Default 20."),
});

/**
 * face_reframe — file-only face-tracked vertical reframe. Pairs with
 * reformat_timeline (NLE-side timeline reflow) for the full short-form
 * pipeline: NLE picks the timeline geometry, this tool bakes a follow-the-
 * subject crop into a delivery-ready mp4.
 */
export function createFaceReframeTool(cwd: string): AgentTool<typeof FaceReframeParams> {
  return {
    name: "face_reframe",
    description:
      "File-only face-tracked vertical reframe. Detects shots (PySceneDetect), tracks the " +
      "largest face per shot (MediaPipe), low-pass smooths the centre, emits an ffmpeg " +
      "crop filter that follows the subject. Falls back to centre crop when no face " +
      "detected. Pair with reformat_timeline for the full short-form pipeline. REQUIRES " +
      "python3 + `pip install opencv-python mediapipe scenedetect numpy` and ffmpeg on " +
      "PATH. Output is a finished mp4 ready for burn_subtitles / normalize_loudness.",
    parameters: FaceReframeParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      if (!findPython()) {
        return err(
          "Python 3 not on PATH",
          "install python3 and: pip install opencv-python mediapipe scenedetect numpy",
        );
      }
      try {
        const inAbs = resolvePath(cwd, args.input);
        const outAbs = safeOutputPath(cwd, args.output);
        if (inAbs === outAbs) {
          return err("output and input are identical", "use a different output path");
        }

        let plan;
        try {
          plan = await analyzeReframe(inAbs, {
            signal: ctx.signal,
            sampleFps: args.sampleFps,
            minDetectionConfidence: 0.5,
            smoothingWindowSec: args.smoothingWindowSec,
          });
        } catch (e) {
          const msg = (e as Error).message;
          if (/missing python dep/i.test(msg)) {
            return err(msg, "pip install opencv-python mediapipe scenedetect numpy");
          }
          return err(msg);
        }

        if (!plan.shots || plan.shots.length === 0) {
          return err(
            "no shots detected and no fallback produced",
            "verify the input is a readable video file",
          );
        }
        if (!plan.sourceWidth || !plan.sourceHeight) {
          return err("sidecar returned no source dimensions", "input may not be a video file");
        }

        // 'static' strategy bypasses tracking — pin every shot's centre to (0.5, 0.5).
        const aspect: Aspect = args.aspect;
        const strategy = args.strategy ?? "face";
        const planForFilter =
          strategy === "static"
            ? {
                ...plan,
                shots: plan.shots.map((s) => ({
                  ...s,
                  smoothedX: 0.5,
                  smoothedY: 0.5,
                  mode: "static" as const,
                })),
              }
            : plan;

        const { filter, outWidth, outHeight } = buildReframeFilter(planForFilter, aspect);

        const codec = args.videoCodec ?? "libx264";
        const crf = String(args.crf ?? 20);
        const r = await runFfmpeg(
          ["-i", inAbs, "-vf", filter, "-c:v", codec, "-crf", crf, "-c:a", "copy", outAbs],
          { signal: ctx.signal },
        );
        if (r.code !== 0) {
          return err(`ffmpeg failed: ${tail(r.stderr)}`);
        }

        const faceShots = planForFilter.shots.filter((s) => s.mode === "face").length;
        const fallbackShots = planForFilter.shots.filter((s) => s.mode === "static").length;

        return compact({
          ok: true,
          path: outAbs,
          aspect,
          outWidth,
          outHeight,
          shots: planForFilter.shots.length,
          faceShots,
          fallbackShots,
          totalSec: round(plan.totalSec, 3),
          sourceWidth: plan.sourceWidth,
          sourceHeight: plan.sourceHeight,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function tail(s: string): string {
  return s.split("\n").filter(Boolean).slice(-3).join(" | ").slice(-300);
}

function round(n: number, places: number): number {
  if (!Number.isFinite(n)) return n;
  const m = 10 ** places;
  return Math.round(n * m) / m;
}
