import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { buildFcpxml } from "../core/fcpxml.js";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";
import { reorderToEvents } from "../core/reorder.js";
import { safeOutputPath } from "../core/safe-paths.js";

const ReorderTimelineParams = z.object({
  newOrder: z
    .array(z.string())
    .min(1)
    .describe(
      "Clip IDs in the desired new order. IDs not listed keep their original relative " +
        "order and append at the end. Use get_timeline first to discover IDs.",
    ),
  sourcePathByClipId: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Optional clipId → source path overrides. Required only when the host's " +
        "ClipInfo.sourcePath is missing for some clips (rare; CEP fallback).",
    ),
  fcpxmlOutput: z
    .string()
    .optional()
    .describe("Optional .fcpxml output path. Defaults to a tempfile we then importTimeline()."),
  /** Skip the host import. Useful for diagnostics. */
  dryRun: z.boolean().optional(),
});

export function createReorderTimelineTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof ReorderTimelineParams> {
  return {
    name: "reorder_timeline",
    description:
      "Reorder video clips on the active timeline by rebuilding it from FCPXML. Neither " +
      "Resolve nor Premiere expose a scriptable 'move clip' op, so we emit a permuted " +
      "FCPXML and import_timeline it. DESTRUCTIVE: replaces the active timeline. Use " +
      "clone_timeline first if you need a safety net. Audio-only timelines unsupported.",
    parameters: ReorderTimelineParams,
    async execute({ newOrder, sourcePathByClipId, fcpxmlOutput, dryRun }) {
      try {
        const current = await host.getTimeline();
        const events = reorderToEvents({
          current,
          newOrder,
          sourcePathByClipId,
        });
        const xml = buildFcpxml({
          title: current.name || "Reordered",
          frameRate: current.frameRate,
          events,
        });
        const outAbs = fcpxmlOutput
          ? safeOutputPath(cwd, fcpxmlOutput)
          : join(mkdtempSync(join(tmpdir(), "gg-reorder-")), "reorder.fcpxml");
        if (fcpxmlOutput) mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, xml, "utf8");
        if (dryRun) {
          return compact({ ok: true, path: outAbs, events: events.length, dryRun: true });
        }
        await host.importTimeline(outAbs);
        return compact({ ok: true, path: outAbs, events: events.length });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
