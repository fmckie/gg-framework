import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const ImportEdlParams = z.object({
  filePath: z.string().describe("Path to the EDL/FCPXML/AAF file."),
});

export function createImportEdlTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof ImportEdlParams> {
  return {
    name: "import_edl",
    description:
      "Bulk-import a timeline from EDL/FCPXML/AAF. Use after write_edl when the live API " +
      "can't do per-clip ops (e.g. Resolve has no scriptable razor).",
    parameters: ImportEdlParams,
    async execute({ filePath }) {
      try {
        const abs = resolvePath(cwd, filePath);
        await host.importTimeline(abs);
        return "ok";
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
