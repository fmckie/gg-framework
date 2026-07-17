import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err, summarizeList } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const GetTimelineParams = z.object({
  full: z
    .boolean()
    .optional()
    .describe("Return all clips/markers (no summarization). Bloats context — use sparingly."),
});

export function createGetTimelineTool(host: VideoHost): AgentTool<typeof GetTimelineParams> {
  return {
    name: "get_timeline",
    description:
      "Read the current timeline: name, fps, duration (frames), clips, markers. " +
      "Long timelines are summarized (head + tail) by default; pass full=true to get everything.",
    parameters: GetTimelineParams,
    async execute({ full }) {
      try {
        const t = await host.getTimeline();
        if (full) {
          return compact({
            name: t.name,
            fps: t.frameRate,
            dur: t.durationFrames,
            clips: t.clips,
            markers: t.markers,
          });
        }
        const cs = summarizeList(t.clips, 20);
        const ms = summarizeList(t.markers, 20);
        return compact({
          name: t.name,
          fps: t.frameRate,
          dur: t.durationFrames,
          clips: { total: cs.total, omitted: cs.omitted, head: cs.head, tail: cs.tail },
          markers: { total: ms.total, omitted: ms.omitted, head: ms.head, tail: ms.tail },
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
