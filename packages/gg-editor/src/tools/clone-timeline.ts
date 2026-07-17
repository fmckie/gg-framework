import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const CloneTimelineParams = z.object({
  newName: z
    .string()
    .min(1)
    .describe("Name for the duplicated timeline (e.g. 'Podcast — silence cut v1')."),
});

export function createCloneTimelineTool(host: VideoHost): AgentTool<typeof CloneTimelineParams> {
  return {
    name: "clone_timeline",
    description:
      "Duplicate the active timeline under a new name. Use as a SAFETY NET before destructive " +
      "operations (import_edl, render, ripple_delete sequences, bulk replace_clip). On Resolve " +
      "the clone becomes active so subsequent ops modify the copy. Premiere clones the " +
      "sequence into the project bin (best-effort — older versions error).",
    parameters: CloneTimelineParams,
    async execute({ newName }) {
      try {
        const r = await host.cloneTimeline(newName);
        return compact({ ok: true, name: r.name });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
