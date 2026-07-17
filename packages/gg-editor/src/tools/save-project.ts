import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const SaveProjectParams = z.object({});

export function createSaveProjectTool(host: VideoHost): AgentTool<typeof SaveProjectParams> {
  return {
    name: "save_project",
    description:
      "Save the host project. Resolve calls ProjectManager.SaveProject(); Premiere calls " +
      "app.project.save(). Use after a sequence of edits the user is happy with so a host " +
      "crash doesn't lose work. Call AFTER clone_timeline when you want a checkpoint.",
    parameters: SaveProjectParams,
    async execute() {
      try {
        await host.saveProject();
        return "ok";
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
