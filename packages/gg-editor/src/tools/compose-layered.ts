import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { buildFcpxml, type FcpxmlEvent } from "../core/fcpxml.js";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";
import { safeOutputPath } from "../core/safe-paths.js";

const LayerSchema = z.object({
  reel: z.string().describe("Source identifier — same reel = same asset."),
  sourcePath: z.string().describe("Absolute (or cwd-relative) source media path."),
  sourceInFrame: z.number().int().min(0),
  sourceOutFrame: z.number().int().min(1),
  /** 0 = main spine, 1+ = stacked above. */
  lane: z.number().int().min(0).default(0),
  /** Frame on the timeline where this layer's clip starts. */
  recordOffsetFrame: z.number().int().min(0),
  clipName: z.string().optional(),
  /** Static or animated opacity 0..1. Pass a number for static; an object for keyframed. */
  opacity: z
    .union([
      z.number().min(0).max(1),
      z.object({
        keyframes: z.array(
          z.object({
            frame: z.number().int().min(0),
            value: z.number().min(0).max(1),
            interp: z.enum(["linear", "easeIn", "easeOut", "smooth"]).optional(),
          }),
        ),
      }),
    ])
    .optional(),
  /** Static volume in dB; pass an object for keyframed ramps. */
  volumeDb: z
    .union([
      z.number(),
      z.object({
        keyframes: z.array(
          z.object({
            frame: z.number().int().min(0),
            value: z.number(),
            interp: z.enum(["linear", "easeIn", "easeOut", "smooth"]).optional(),
          }),
        ),
      }),
    ])
    .optional(),
});

const ComposeLayeredParams = z.object({
  title: z.string().describe("Project name on the rebuilt timeline."),
  frameRate: z.number().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  layers: z
    .array(LayerSchema)
    .min(1)
    .describe(
      "Multi-track composition. Spine clips (lane=0) lay out in array order; lane>=1 " +
        "clips sit at their recordOffsetFrame above the spine.",
    ),
  fcpxmlOutput: z
    .string()
    .optional()
    .describe("Optional .fcpxml output path. Defaults to a tempfile."),
  dryRun: z.boolean().optional(),
});

export function createComposeLayeredTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof ComposeLayeredParams> {
  return {
    name: "compose_layered",
    description:
      "Build a multi-track timeline (B-roll + lower-thirds + main A-roll) by emitting an " +
      "FCPXML with lane='N' clips and importing it. One call replaces the active timeline " +
      "with the composed result. DESTRUCTIVE — clone_timeline first if you need a safety " +
      "net. Use insert_broll for single-clip layer additions.",
    parameters: ComposeLayeredParams,
    async execute({ title, frameRate, width, height, layers, fcpxmlOutput, dryRun }) {
      try {
        const events: FcpxmlEvent[] = layers.map((l) => {
          const sourcePath = resolvePath(cwd, l.sourcePath);
          return {
            reel: l.reel,
            sourcePath,
            sourceInFrame: l.sourceInFrame,
            sourceOutFrame: l.sourceOutFrame,
            lane: l.lane,
            recordOffsetFrame: l.recordOffsetFrame,
            clipName: l.clipName,
            opacity: l.opacity,
            volumeDb: l.volumeDb,
          };
        });
        const xml = buildFcpxml({ title, frameRate, width, height, events });
        const outAbs = fcpxmlOutput
          ? safeOutputPath(cwd, fcpxmlOutput)
          : join(mkdtempSync(join(tmpdir(), "gg-compose-")), "composed.fcpxml");
        if (fcpxmlOutput) mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, xml, "utf8");
        if (dryRun) {
          return compact({ ok: true, path: outAbs, layers: layers.length, dryRun: true });
        }
        await host.importTimeline(outAbs);
        return compact({ ok: true, path: outAbs, layers: layers.length });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
