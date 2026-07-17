import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import type { Skill } from "../core/skills.js";

const parameters = z.object({
  skill: z.string().describe("The name of the skill to invoke"),
  args: z.string().optional().describe("Optional arguments or context for the skill"),
});

export function createSkillTool(skills: Skill[]): AgentTool<typeof parameters> {
  const skillMap = new Map(skills.map((s) => [s.name, s]));

  return {
    name: "skill",
    description: generateSkillDescription(skills),
    parameters,
    async execute(input) {
      const skill = skillMap.get(input.skill);
      if (!skill) {
        const available = skills.map((s) => s.name).join(", ");
        return `Error: Skill "${input.skill}" not found. Available skills: ${available || "none"}`;
      }

      const parts = [`<skill_content name="${skill.name}">`, skill.content, `</skill_content>`];
      if (input.args) {
        parts.push(`\nUser context: ${input.args}`);
      }
      parts.push(
        "\nTreat the above skill instructions as authoritative. Follow them to complete the task.",
      );
      return parts.join("\n");
    },
  };
}

function generateSkillDescription(skills: Skill[]): string {
  if (skills.length === 0) {
    return "Invoke a skill by name. No skills are currently available.";
  }

  const list = skills
    .map((s) => `- **${s.name}**: ${s.description || "No description"}`)
    .join("\n");

  return `Invoke a skill by name to get specialized instructions for a task.\n\nAvailable skills:\n${list}`;
}
