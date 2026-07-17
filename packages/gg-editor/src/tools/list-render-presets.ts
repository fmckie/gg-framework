import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err, summarizeList } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const ListRenderPresetsParams = z.object({});

export function createListRenderPresetsTool(
  host: VideoHost,
): AgentTool<typeof ListRenderPresetsParams> {
  return {
    name: "list_render_presets",
    description:
      "List the host's available render presets. CALL THIS BEFORE render() so you pick a real " +
      "preset name instead of guessing. Resolve returns a populated list. Premiere returns [] " +
      "(presets live in Adobe Media Encoder; not exposed to ExtendScript) — fall back to common " +
      "names like 'H.264 Master', 'YouTube 1080p Full HD', or use File → Export manually.",
    parameters: ListRenderPresetsParams,
    async execute() {
      try {
        const presets = await host.listRenderPresets();
        const summary = summarizeList(presets, 30);
        return compact({
          host: host.name,
          total: summary.total,
          ...(summary.omitted > 0
            ? { head: summary.head, tail: summary.tail, omitted: summary.omitted }
            : { presets }),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
