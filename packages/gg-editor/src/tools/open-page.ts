import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const OpenPageParams = z.object({
  name: z.enum(["media", "cut", "edit", "fusion", "color", "fairlight", "deliver"]),
});

export function createOpenPageTool(host: VideoHost): AgentTool<typeof OpenPageParams> {
  return {
    name: "open_page",
    description:
      "Switch the host UI to a workspace page. Resolve only — Premiere has no page " +
      "concept and will return error: not_supported. Use to guide the user's eyes: " +
      "media for import, edit for cuts, color for grading, deliver for render.",
    parameters: OpenPageParams,
    async execute({ name }) {
      try {
        if (typeof host.openPage !== "function") {
          return err("not_supported", "page concept is Resolve-only");
        }
        await host.openPage(name);
        return "ok";
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
