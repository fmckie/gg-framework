import { describe, expect, it } from "vitest";
import type { SubAgentLine } from "../SubAgentFeed";
import { ART } from "./art";
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

  it("gives every god a cameo of its own", () => {
    const cameos = Object.values(GODS).map((god) => god.cameo);
    expect(new Set(cameos).size).toBe(7);
  });

  it.runIf(ART.complete)("has each cameo as a file, where the art is", () => {
    for (const god of Object.values(GODS)) {
      expect(god.cameo).toMatch(new RegExp(`/cameos/${god.id}\\.webp$`));
      expect(god.cameo).not.toMatch(/^data:/);
    }
  });

  it.runIf(!ART.complete)("has a 72×96 placeholder for each cameo, where the art isn't", () => {
    for (const god of Object.values(GODS)) {
      expect(god.cameo).toMatch(/^data:image\/svg\+xml,/);
      const svg = decodeURIComponent(god.cameo.slice(god.cameo.indexOf(",") + 1));
      expect(svg).toMatch(/^<svg [^>]*width="72" height="96"/);
      expect(svg).toContain(`<title>${god.id}</title>`);
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
