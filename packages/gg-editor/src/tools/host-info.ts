import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const HostInfoParams = z.object({});

export function createHostInfoTool(host: VideoHost): AgentTool<typeof HostInfoParams> {
  return {
    name: "host_info",
    description:
      "Report the connected NLE host and its capabilities. Call FIRST so you know what " +
      "ops are available before planning. Output is compact JSON.",
    parameters: HostInfoParams,
    async execute() {
      const c = await host.capabilities();
      // Compact key abbreviations: move/color/audio/ai/import. The agent only
      // needs to know what's possible — verbose labels just bloat context.
      // `runtime` and `deprecated` are surfaced so the agent can warn users on
      // sunset paths (Adobe CEP/ExtendScript end-of-life Sept 2026).
      return compact({
        host: host.name,
        ok: c.isAvailable,
        why: c.unavailableReason,
        caps: {
          move: c.canMoveClips,
          color: c.canScriptColor,
          audio: c.canScriptAudio,
          ai: c.canTriggerAI,
          import: c.preferredImportFormat,
        },
        ...(c.runtime ? { runtime: c.runtime } : {}),
        ...(c.deprecationNotice ? { deprecated: c.deprecationNotice } : {}),
      });
    },
  };
}
