import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const AddTrackParams = z.object({
  kind: z
    .enum(["video", "audio", "subtitle"])
    .describe("Track type to append. video=V2/V3..., audio=A2/A3..., subtitle=ST1..."),
});

export function createAddTrackTool(host: VideoHost): AgentTool<typeof AddTrackParams> {
  return {
    name: "add_track",
    description:
      "Append an empty track to the active timeline. Useful before insert_broll when V2 " +
      "doesn't exist yet, or before import_subtitles when no subtitle track exists. " +
      "Resolve only — Premiere uses File → Sequence → Add Tracks manually.",
    parameters: AddTrackParams,
    async execute({ kind }) {
      try {
        const r = await host.addTrack(kind);
        return compact({ ok: true, kind, track: r.track });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
