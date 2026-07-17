import { mkdirSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, runFfmpeg } from "../core/media/ffmpeg.js";
import { safeResolveOutputPath } from "../core/safe-paths.js";

const ExtractFrameParams = z.object({
  input: z.string().describe("Source video file."),
  output: z.string().describe(".jpg or .png path for the extracted frame."),
  atSec: z.number().min(0).describe("Timestamp in seconds where to grab the frame."),
  quality: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe("JPEG quality 1-31 (lower=better, ffmpeg convention). Default 2."),
  maxWidth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional max width — preserves aspect, scales down."),
});

export function createExtractFrameTool(cwd: string): AgentTool<typeof ExtractFrameParams> {
  return {
    name: "extract_frame",
    description:
      "Pull a single frame as a JPEG/PNG file. Use AFTER score_shot to save the chosen " +
      "hero frame as a thumbnail. Pair with score_shot(times=[...]) to find the moment, " +
      "then this tool to save it.",
    parameters: ExtractFrameParams,
    async execute({ input, output, atSec, quality, maxWidth }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, input);
        const resolved = safeResolveOutputPath(cwd, output);
        const outAbs = resolved.path;
        mkdirSync(dirname(outAbs), { recursive: true });
        const args = [
          "-ss",
          String(atSec),
          "-i",
          inAbs,
          "-frames:v",
          "1",
          "-q:v",
          String(quality ?? 2),
        ];
        if (maxWidth) args.push("-vf", `scale=${maxWidth}:-1`);
        args.push(outAbs);
        const r = await runFfmpeg(args, { signal: ctx.signal });
        if (r.code !== 0) {
          return err(`ffmpeg exited ${r.code}`, "verify atSec is within file duration");
        }
        return compact({
          ok: true,
          path: outAbs,
          atSec,
          ...(resolved.redirected ? { redirected: true, reason: resolved.reason } : {}),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
