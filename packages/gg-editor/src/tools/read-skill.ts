import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { err } from "../core/format.js";
import type { SkillSource } from "../core/skills-loader.js";

const ReadSkillParams = z.object({
  name: z.string().min(1).describe("Skill name (without .md extension)."),
});

export function createReadSkillTool(skills: SkillSource[]): AgentTool<typeof ReadSkillParams> {
  const byName = new Map(skills.map((s) => [s.name, s]));
  return {
    name: "read_skill",
    description:
      "Read the full content of a skill (recipe). The system prompt lists available skill " +
      "names + one-line descriptions; call this when you decide a skill applies to the user's " +
      "request. Returns the markdown content verbatim. Skills include bundled defaults plus " +
      "user-defined skills from .gg/editor-skills/*.md (project) and ~/.gg/editor-skills/*.md (user).",
    parameters: ReadSkillParams,
    async execute({ name }) {
      const skill = byName.get(name);
      if (!skill) {
        return err(
          `unknown skill: ${name}`,
          `valid: ${[...byName.keys()].sort().join(", ") || "(none)"}`,
        );
      }
      return skill.content;
    },
  };
}
