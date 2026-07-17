import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const ImportSubtitlesParams = z.object({
  srtPath: z.string().describe("Path to the .srt file (relative resolves to cwd)."),
});

export function createImportSubtitlesTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof ImportSubtitlesParams> {
  return {
    name: "import_subtitles",
    description:
      "Import an SRT subtitle file into the active timeline. Resolve attaches it to a " +
      "subtitle track automatically; Premiere imports to the project (drag to a captions " +
      "track manually). Pair with write_srt to ship captions end-to-end.",
    parameters: ImportSubtitlesParams,
    async execute({ srtPath }) {
      try {
        const abs = resolvePath(cwd, srtPath);
        const r = await host.importSubtitles(abs);
        // Tight response when the host auto-attached cleanly. Otherwise
        // surface attached=false + note so the agent can tell the user to
        // drag the SRT onto the captions track manually (Premiere case).
        if (r.attached && !r.note) return "ok";
        return compact({ imported: r.imported, attached: r.attached, note: r.note });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
