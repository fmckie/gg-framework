import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { extractAtTimes } from "../core/frames.js";
import { buildHookResult, runHookVision, speechAt0_5sScore } from "../core/hook-analysis.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import { parseSilenceDetect } from "../core/silence.js";

const AnalyzeHookParams = z.object({
  input: z.string().describe("Source video (relative resolves to cwd)."),
  windowSec: z
    .number()
    .min(0.5)
    .max(10)
    .optional()
    .describe(
      "Window to analyse from t=0. Default 3s — the algorithmic checkpoint for short-form.",
    ),
  passThreshold: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Score (0-100) above which the hook is judged to pass. Default 70."),
  detail: z.enum(["low", "high"]).optional().describe("Vision detail. Default low."),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
});

/**
 * analyze_hook — does the first 3 seconds earn the scroll-stop?
 *
 * Runs four checks and returns a 0-100 score plus a list of issues:
 *   1. Speech in the first 0.5s   (silencedetect probe)
 *   2. On-screen text             (vision)
 *   3. Visual motion              (vision; compares two early frames)
 *   4. Subject clarity            (vision)
 *   5. Emotional intensity        (vision)
 *
 * The agent's job is to surface the score + findings, then drop a red
 * marker if the hook fails so the user knows where to recut.
 */
export function createAnalyzeHookTool(cwd: string): AgentTool<typeof AnalyzeHookParams> {
  return {
    name: "analyze_hook",
    description:
      "Score the first 3 seconds of a video for retention (TikTok / Reels / Shorts / YouTube). " +
      "Returns a 0-100 score and a list of findings (silent open, no on-screen text, static " +
      "framing, no clear subject, weak emotional hook). The first 2-3 seconds are the " +
      "algorithmic checkpoint — videos with strong 3-second retention get pushed to larger " +
      "audiences. ALWAYS check this on short-form before render. If `passes=false`, drop a " +
      "red PAUSE marker and propose a stronger opener.",
    parameters: AnalyzeHookParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      if (!process.env.OPENAI_API_KEY) {
        return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
      }
      try {
        const inAbs = resolvePath(cwd, args.input);
        const probe = probeMedia(inAbs);
        if (!probe) return err(`probe failed for ${inAbs}`, "verify file exists and is media");

        const windowSec = Math.min(args.windowSec ?? 3, probe.durationSec);
        if (windowSec < 0.5) {
          return err("video shorter than 0.5s — nothing to analyse");
        }

        // ── Audio: silencedetect over [0, windowSec] ─────────────────
        // We accept any silence ≥ 0.05s in this short window — even
        // brief openings of dead air kill retention.
        const silenceRun = await runFfmpeg(
          [
            "-i",
            inAbs,
            "-t",
            String(windowSec),
            "-af",
            "silencedetect=noise=-30dB:d=0.05",
            "-f",
            "null",
            "-",
          ],
          { signal: ctx.signal },
        );
        if (silenceRun.code !== 0) {
          return err(`silencedetect failed: ${tail(silenceRun.stderr)}`);
        }
        const silences = parseSilenceDetect(silenceRun.stderr, windowSec);
        const speech = speechAt0_5sScore(silences, Math.min(0.5, windowSec));

        // ── Vision: two frames sampled near the start of the window ──
        // 0.5s and (windowSec - 0.5) so the model sees opening and
        // ~end-of-window for motion comparison.
        const earlyT = Math.min(0.5, windowSec * 0.2);
        const laterT = Math.max(earlyT + 0.3, windowSec - 0.5);
        const frames = await extractAtTimes(inAbs, [earlyT, laterT], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        if (frames.length < 2) {
          return err("could not extract two frames from the opening window");
        }
        const vision = await runHookVision(frames[0].path, frames[1].path, {
          detail: args.detail,
          model: args.model,
          signal: ctx.signal,
        });

        const result = buildHookResult(speech, vision, {
          passThreshold: args.passThreshold,
        });

        return compact({
          score: result.score,
          passes: result.passes,
          findings: result.findings,
          why: result.why,
          breakdown: {
            speechAt0_5s: result.speechAt0_5s,
            onScreenText: result.onScreenText,
            motion: result.motion,
            subjectClarity: result.subjectClarity,
            emotionalIntensity: result.emotionalIntensity,
          },
          windowSec,
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
