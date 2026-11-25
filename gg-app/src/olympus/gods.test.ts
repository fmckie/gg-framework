import { describe, expect, it } from "vitest";
import type { SubAgentLine } from "../SubAgentFeed";
import { agentTypeOf, godOf, GODS } from "./gods";

const line = (over: Partial<SubAgentLine>): SubAgentLine => ({
  toolCallId: "a",
  status: "running",
  activities: [],
  toolUseCount: 0,
  ...over,
});

describe("godOf", () => {
  it.each([
    ["owl", "Athena"],
    ["researcher", "Herodotus"],
    ["worker", "Hermes"],
    ["bee", "Hephaestus"],
    ["auditor", "Argus"],
    ["skeptic", "Themis"],
  ])("casts %s as %s", (agent, god) => {
    expect(godOf(agent).name).toBe(god);
  });

  it.each([undefined, "", "translator", "constructor", "Owl"])("casts %j as Nike", (agent) => {
    expect(godOf(agent)).toBe(GODS.nike);
  });

  it("gives every god a cameo of its own, as a file", () => {
    const cameos = Object.values(GODS).map((god) => god.cameo);
    expect(new Set(cameos).size).toBe(7);
    for (const cameo of cameos) {
      expect(cameo).toMatch(/\.webp$/);
      expect(cameo).not.toMatch(/^data:/);
    }
  });
});

describe("agentTypeOf", () => {
  it("is the agent the subagent tool named", () => {
    expect(agentTypeOf(line({ agentName: "auditor", agentType: "auditor" }))).toBe("auditor");
  });

  it("reads a resumed row's name, which is its agent's", () => {
    expect(agentTypeOf(line({ agentName: "owl" }))).toBe("owl");
  });

  it("is a spawned agent's type, never its task name", () => {
    expect(agentTypeOf(line({ async: true, agentName: "owl", agentType: "bee" }))).toBe("bee");
    expect(agentTypeOf(line({ async: true, agentName: "owl" }))).toBeUndefined();
  });

  it("is nothing for an agent with no name of its own", () => {
    expect(agentTypeOf(line({}))).toBeUndefined();
    expect(agentTypeOf(line({ agentName: "default" }))).toBeUndefined();
    expect(
      agentTypeOf(line({ async: true, agentName: "t", agentType: "default" })),
    ).toBeUndefined();
  });
});
