import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const ImportToMediaPoolParams = z.object({
  paths: z.array(z.string()).min(1).describe("File paths (relative resolves to cwd)."),
  bin: z.string().optional().describe("Optional bin/folder name to drop the items into."),
});

export function createImportToMediaPoolTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof ImportToMediaPoolParams> {
  return {
    name: "import_to_media_pool",
    description:
      "Import one or more media files into the project's media pool / bins WITHOUT " +
      "appending to the timeline. Use as the setup step for rough-cut-from-script and " +
      "multi-source workflows. Use append_clip when you also want it on the timeline.",
    parameters: ImportToMediaPoolParams,
    async execute({ paths, bin }) {
      try {
        const abs = paths.map((p) => resolvePath(cwd, p));
        await host.importToMediaPool(abs, bin);
        return compact({ ok: true, imported: abs.length });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
