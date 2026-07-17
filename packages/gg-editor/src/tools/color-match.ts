import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { deriveColorMatch } from "../core/color-match.js";
import { extractAtTimes } from "../core/frames.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";

const ColorMatchParams = z.object({
  referenceVideo: z.string().describe("Reference video file (the look you want)."),
  referenceAtSec: z.number().min(0).describe("Time in the reference to sample."),
  targetVideo: z.string().describe("Target video file (clip you want to match)."),
  targetAtSec: z.number().min(0).describe("Time in the target to sample."),
  detail: z.enum(["low", "high"]).optional().describe("Vision detail. Default low (cheap)."),
  model: z.string().optional().describe("OpenAI model id. Default gpt-4o-mini."),
});

export function createColorMatchTool(cwd: string): AgentTool<typeof ColorMatchParams> {
  return {
    name: "color_match",
    description:
      "Vision-derived CDL: compares a reference frame to a target frame and emits " +
      "slope/offset/power/saturation values that bring the target toward the reference. " +
      "READ-ONLY — returns the CDL; agent then pipes it to set_primary_correction " +
      "(or rejects it if confidence is low). NOT a substitute for ColorChecker matching — " +
      "this is for 'similar shots that feel off'. ALWAYS check `confidence`; below 0.4 means " +
      "the model is guessing and you should skip applying.",
    parameters: ColorMatchParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      if (!process.env.OPENAI_API_KEY) {
        return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
      }
      try {
        const refAbs = resolvePath(cwd, args.referenceVideo);
        const tgtAbs = resolvePath(cwd, args.targetVideo);
        const [refFrame] = await extractAtTimes(refAbs, [args.referenceAtSec], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        const [tgtFrame] = await extractAtTimes(tgtAbs, [args.targetAtSec], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        const cdl = await deriveColorMatch(refFrame.path, tgtFrame.path, {
          detail: args.detail,
          model: args.model,
          signal: ctx.signal,
        });
        return compact({ cdl });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
