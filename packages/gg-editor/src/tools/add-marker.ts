import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

// Color set verified against Resolve's marker palette (samuelgursky/
// davinci-resolve-mcp). The first 8 are also accepted by Premiere (mapped to
// numeric colorIndex 0–7). The remaining 10 are Resolve-only — Premiere will
// snap them to the closest of its 8 indices via the bridge color map.
const AddMarkerParams = z.object({
  frame: z.number().int().min(0),
  note: z.string().describe("Reasoning/label for the marker."),
  color: z
    .enum([
      // Universal (work in both Resolve + Premiere)
      "blue",
      "red",
      "green",
      "yellow",
      "cyan",
      "purple",
      "orange",
      "white",
      // Resolve-only — Premiere snaps to the closest of its 8 indices
      "pink",
      "fuchsia",
      "rose",
      "lavender",
      "sky",
      "mint",
      "lemon",
      "sand",
      "cocoa",
      "cream",
    ])
    .optional()
    .describe(
      "Marker color. blue/red/green/yellow/cyan/purple/orange/white work in both NLEs. " +
        "pink/fuchsia/rose/lavender/sky/mint/lemon/sand/cocoa/cream are Resolve-only and snap " +
        "to the closest 8-color value on Premiere.",
    ),
  durationFrames: z.number().int().min(0).optional(),
});

export function createAddMarkerTool(host: VideoHost): AgentTool<typeof AddMarkerParams> {
  return {
    name: "add_marker",
    description:
      "Drop a marker on the timeline with a note. Audit trail — every editorial decision " +
      "(kept/cut/skipped) gets one. The human reviews them after.",
    parameters: AddMarkerParams,
    async execute({ frame, note, color, durationFrames }) {
      try {
        await host.addMarker({ frame, note, color, durationFrames });
        return "ok";
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
