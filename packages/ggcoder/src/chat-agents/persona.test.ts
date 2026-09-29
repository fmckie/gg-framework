import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentTool } from "@kleio/agent";
import type { AgentSessionOptions } from "../core/agent-session.js";
import { createChatAgent } from "./index.js";
import { GENERAL_CHAT_SYSTEM_PROMPT } from "./general.js";
import {
  buildPersonaRolePrompt,
  createPersonaChatAgent,
  parseChatPersona,
  personaPromptCacheKeyPrefix,
} from "./persona.js";

function optionsOf(agent: unknown): AgentSessionOptions {
  return (agent as { opts: AgentSessionOptions }).opts;
}

function fakeTool(name: string): AgentTool {
  return { name, description: name, parameters: {} as never, execute: async () => "" };
}

const baseOptions = {
  provider: "anthropic" as const,
  model: "claude-test",
  cwd: "/tmp/workspace",
  sessionsDir: "/tmp/gg/sessions",
};

describe("persona chat agent", () => {
  const persona = { name: "Scout", instructions: "Watch the markets and summarise briefly." };

  it("uses the persona role prompt instead of General's", () => {
    const options = optionsOf(createPersonaChatAgent(persona, baseOptions));
    expect(options.systemPrompt).toContain("You are Scout, one of the user's helpers in Kleio.");
    expect(options.systemPrompt).toContain("Watch the markets and summarise briefly.");
    expect(options.systemPrompt).not.toContain(GENERAL_CHAT_SYSTEM_PROMPT);
    expect(options.systemPrompt).not.toContain("You are General");
    // Memory + Jiwa curation and runtime context are kept.
    expect(options.systemPrompt).toContain("Durable memory curation:");
    expect(options.systemPrompt).toContain("Jiwa curation:");
    expect(options.systemPrompt).toContain("- Workspace root: /tmp/workspace");
  });

  it("gets no handoff tool or handoff instructions, but keeps the others", () => {
    const options = optionsOf(
      createPersonaChatAgent(persona, {
        ...baseOptions,
        additionalTools: [fakeTool("remember"), fakeTool("delegate_to_agent")],
      }),
    );
    const names = (options.additionalTools ?? []).map((t) => t.name);
    expect(names).toEqual(["remember"]);
    expect(options.systemPrompt).not.toContain("Agent handoff:");
    // Sanity: an ordinary General chat agent DOES get the handoff tool.
    const general = optionsOf(createChatAgent("general", baseOptions));
    expect((general.additionalTools ?? []).map((t) => t.name)).toContain("delegate_to_agent");
  });

  it("keys the prompt cache by the role prompt and keeps General's transcript dir", () => {
    const options = optionsOf(createPersonaChatAgent(persona, baseOptions));
    const prefix = personaPromptCacheKeyPrefix(buildPersonaRolePrompt(persona));
    expect(prefix).toMatch(/^ggchat:persona:[0-9a-f]{12}$/);
    expect(options.promptCacheKeyPrefix).toBe(prefix);
    expect(
      personaPromptCacheKeyPrefix(buildPersonaRolePrompt({ ...persona, name: "Other" })),
    ).not.toBe(prefix);
    expect(options.sessionRootDir).toBe(path.resolve("/tmp/gg/chat-sessions/general"));
  });
});

describe("parseChatPersona", () => {
  it("trims and accepts valid personas", () => {
    expect(parseChatPersona({ name: "  Scout ", instructions: " Be brief. " })).toEqual({
      name: "Scout",
      instructions: "Be brief.",
    });
  });

  it.each([
    ["not an object", "Scout"],
    ["null", null],
    ["missing instructions", { name: "Scout" }],
    ["blank name", { name: "   ", instructions: "x" }],
    ["name too long", { name: "x".repeat(41), instructions: "x" }],
    ["empty instructions", { name: "Scout", instructions: "" }],
    ["instructions too long", { name: "Scout", instructions: "x".repeat(8001) }],
  ])("rejects %s", (_label, value) => {
    expect(parseChatPersona(value)).toHaveProperty("error");
  });

  it("accepts the boundary lengths", () => {
    expect(
      parseChatPersona({ name: "x".repeat(40), instructions: "y".repeat(8000) }),
    ).not.toHaveProperty("error");
  });
});
