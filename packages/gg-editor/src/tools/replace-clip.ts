import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const ReplaceClipParams = z.object({
  clipId: z.string().min(1).describe("Clip id from get_timeline."),
  mediaPath: z.string().min(1).describe("New source media (relative resolves to cwd)."),
});

export function createReplaceClipTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof ReplaceClipParams> {
  return {
    name: "replace_clip",
    description:
      "Swap a clip's underlying media reference (e.g. updated render of a lower-third, " +
      "graphic, or animation) without changing its in/out timing or grade. Common workflow: " +
      "you ship a draft, the motion designer updates the file, this tool drops the new file " +
      "into the same timeline slot. Falls back with a clear error on hosts that don't expose it.",
    parameters: ReplaceClipParams,
    async execute({ clipId, mediaPath }) {
      try {
        const abs = resolvePath(cwd, mediaPath);
        await host.replaceClip(clipId, abs);
        return compact({ ok: true, clipId, mediaPath: abs });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
