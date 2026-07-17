import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err, summarizeList } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";
import { RESOLVE_TO_PREMIERE_INDEX } from "../core/marker-colors.js";

const GetMarkersParams = z.object({
  full: z
    .boolean()
    .optional()
    .describe("Return all markers (no summarization). Pass when total is small."),
  color: z
    .string()
    .optional()
    .describe(
      "Filter by marker color (case-insensitive, e.g. 'red' / 'green' / 'purple'). " +
        "Premiere returns numeric color indices; Resolve returns names. The filter matches " +
        "either by string equality or by the Resolve color name → Premiere index map.",
    ),
  contains: z.string().optional().describe("Substring filter on marker note (case-insensitive)."),
  startFrame: z.number().int().min(0).optional().describe("Lower frame bound (inclusive)."),
  endFrame: z.number().int().min(0).optional().describe("Upper frame bound (exclusive)."),
});

export function createGetMarkersTool(host: VideoHost): AgentTool<typeof GetMarkersParams> {
  return {
    name: "get_markers",
    description:
      "Read existing markers from the active timeline. Call at session start to see prior " +
      "editorial decisions. Filter by color, note substring, or frame range so you don't " +
      "blow context on unrelated markers.",
    parameters: GetMarkersParams,
    async execute({ full, color, contains, startFrame, endFrame }) {
      try {
        const all = await host.getMarkers();
        const needle = contains?.toLowerCase();
        const wantColor = color?.toLowerCase();
        const wantIndex =
          wantColor !== undefined ? RESOLVE_TO_PREMIERE_INDEX[wantColor] : undefined;

        const filtered = all.filter((m) => {
          if (startFrame !== undefined && m.frame < startFrame) return false;
          if (endFrame !== undefined && m.frame >= endFrame) return false;
          if (needle && !(m.note ?? "").toLowerCase().includes(needle)) return false;
          if (wantColor !== undefined) {
            const c = m.color;
            if (typeof c === "string") {
              if (c.toLowerCase() !== wantColor) return false;
            } else if (typeof c === "number") {
              if (wantIndex === undefined || c !== wantIndex) return false;
            } else {
              return false;
            }
          }
          return true;
        });

        if (full) return compact({ markers: filtered, total: filtered.length });
        const s = summarizeList(filtered, 20);
        return compact({
          total: s.total,
          omitted: s.omitted,
          head: s.head,
          tail: s.tail,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
