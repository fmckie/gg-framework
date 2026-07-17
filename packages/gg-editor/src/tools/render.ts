import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";
import { safeOutputPath } from "../core/safe-paths.js";

const RenderParams = z.object({
  preset: z.string().describe("Host-specific preset name."),
  output: z.string(),
});

export function createRenderTool(host: VideoHost, cwd: string): AgentTool<typeof RenderParams> {
  return {
    name: "render",
    description:
      "Render the current timeline to a file using a host preset. Blocks until done. " +
      "Don't render until the edit is finalised.",
    parameters: RenderParams,
    async execute({ preset, output }) {
      try {
        const abs = safeOutputPath(cwd, output);
        await host.render({ preset, output: abs });
        return `ok:${abs}`;
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
