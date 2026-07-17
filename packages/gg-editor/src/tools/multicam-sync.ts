import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { envelopeSync } from "../core/envelope-sync.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { multicamSync } from "../core/multicam.js";

const MulticamSyncParams = z.object({
  inputs: z
    .array(z.string().min(1))
    .min(2)
    .describe("2+ source paths to align (relative resolves to cwd)."),
  method: z
    .enum(["transient", "envelope"])
    .optional()
    .describe(
      "transient (default): first-transient/clap detection. Use when takes start " +
        "with a clap or slate. envelope: energy-envelope cross-correlation. Use for " +
        "dialogue-only takes with no slate.",
    ),
  thresholdDb: z
    .number()
    .negative()
    .optional()
    .describe("Transient mode only: silence floor in dB (default -40)."),
  maxLagSec: z
    .number()
    .positive()
    .optional()
    .describe("Envelope mode only: search range ±N seconds (default 10). Larger = slower."),
});

export function createMulticamSyncTool(cwd: string): AgentTool<typeof MulticamSyncParams> {
  return {
    name: "multicam_sync",
    description:
      "Align multicam recordings. Two methods:\n" +
      "  transient (default) — first-transient (clap/slate) detection. Fast, exact when slates are used.\n" +
      "  envelope — energy-envelope cross-correlation. Works on dialogue/applause/music; no slate needed. " +
      "First input is treated as the reference. " +
      "Returns relative offsets in seconds you can use to construct an EDL with offset source-ins. " +
      "If transient mode reports `null` offsets for files lacking a clap, retry with method='envelope'.",
    parameters: MulticamSyncParams,
    async execute({ inputs, method = "transient", thresholdDb, maxLagSec }, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const abs = inputs.map((p) => resolvePath(cwd, p));
        if (method === "envelope") {
          const r = await envelopeSync(abs, { maxLagSec, signal: ctx.signal });
          return compact({
            method: "envelope",
            reference: r.reference,
            offsets: r.results.map((x) => ({
              path: x.path,
              offsetSec: x.offsetSec,
              confidence: x.confidence,
            })),
            warning: r.warning,
          });
        }
        const r = await multicamSync(abs, { thresholdDb, signal: ctx.signal });
        return compact({
          method: "transient",
          reference: r.reference,
          offsets: r.results.map((x) => ({
            path: x.path,
            offsetSec: x.offsetSec,
          })),
          thresholdDb: r.thresholdDb,
          warning: r.warning,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
