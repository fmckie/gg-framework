import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const ApplyLutParams = z.object({
  clipId: z.string().min(1).describe("Clip id from get_timeline."),
  lutPath: z.string().min(1).describe(".cube/.dat LUT file (relative path resolves to cwd)."),
  nodeIndex: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based node index. Default 1 (always exists)."),
});

export function createApplyLutTool(host: VideoHost, cwd: string): AgentTool<typeof ApplyLutParams> {
  return {
    name: "apply_lut",
    description:
      "Apply a LUT to a clip's grading node (Resolve only). " +
      "Premiere has no scriptable equivalent — the tool will return an error there. " +
      "Use as the base of a per-clip grade, then layer set_primary_correction on top.",
    parameters: ApplyLutParams,
    async execute({ clipId, lutPath, nodeIndex }) {
      try {
        const abs = resolvePath(cwd, lutPath);
        await host.applyLut(clipId, abs, nodeIndex);
        return compact({ clipId, lutPath: abs, nodeIndex: nodeIndex ?? 1 });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
