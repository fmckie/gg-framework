import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const AppendClipParams = z.object({
  track: z.number().int().min(1),
  mediaPath: z.string(),
});

export function createAppendClipTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof AppendClipParams> {
  return {
    name: "append_clip",
    description:
      "Append a media clip to the end of a track. Most reliable timeline op across both " +
      "Resolve and Premiere — prefer over move/insert.",
    parameters: AppendClipParams,
    async execute({ track, mediaPath }) {
      try {
        const abs = resolvePath(cwd, mediaPath);
        const c = await host.appendClip(track, abs);
        // Echo only state delta; track/path is already in args.
        return compact({ id: c.id, start: c.startFrame, end: c.endFrame });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
