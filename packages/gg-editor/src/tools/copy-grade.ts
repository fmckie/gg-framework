import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const CopyGradeParams = z.object({
  sourceClipId: z.string().min(1).describe("Hero clip whose grade you want to replicate."),
  targetClipIds: z
    .array(z.string().min(1))
    .min(1)
    .describe("Clips that should receive the source's grade."),
});

export function createCopyGradeTool(host: VideoHost): AgentTool<typeof CopyGradeParams> {
  return {
    name: "copy_grade",
    description:
      "Copy the current grade from one clip to many (Resolve only). " +
      "On Resolve, the Color page may need to be open for copy_grade to take effect. " +
      "Call open_page('color') first if it errors. Use after grading a hero shot to " +
      "replicate across similar shots.",
    parameters: CopyGradeParams,
    async execute({ sourceClipId, targetClipIds }) {
      try {
        await host.copyGrade(sourceClipId, targetClipIds);
        return compact({ sourceClipId, copied: targetClipIds.length });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
