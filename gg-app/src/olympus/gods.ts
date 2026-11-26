// The Olympus cast: each bundled agent is a god, and an agent with no name of
// its own, or one the cast doesn't know, is Nike.

import type { SubAgentLine } from "../SubAgentFeed";
import { cameoUrl } from "./art";

export type GodId = "athena" | "herodotus" | "hermes" | "hephaestus" | "argus" | "themis" | "nike";

export interface God {
  readonly id: GodId;
  readonly name: string;
  /** Its cameo's URL: 72×96, drawn at 24×32 in a row. */
  readonly cameo: string;
}

export const GODS: Readonly<Record<GodId, God>> = {
  athena: { id: "athena", name: "Athena", cameo: cameoUrl("athena") },
  herodotus: { id: "herodotus", name: "Herodotus", cameo: cameoUrl("herodotus") },
  hermes: { id: "hermes", name: "Hermes", cameo: cameoUrl("hermes") },
  hephaestus: { id: "hephaestus", name: "Hephaestus", cameo: cameoUrl("hephaestus") },
  argus: { id: "argus", name: "Argus", cameo: cameoUrl("argus") },
  themis: { id: "themis", name: "Themis", cameo: cameoUrl("themis") },
  nike: { id: "nike", name: "Nike", cameo: cameoUrl("nike") },
};

const BY_AGENT: ReadonlyMap<string, GodId> = new Map<string, GodId>([
  ["owl", "athena"],
  ["researcher", "herodotus"],
  ["worker", "hermes"],
  ["bee", "hephaestus"],
  ["auditor", "argus"],
  ["skeptic", "themis"],
]);

/** The god for an agent type. */
export function godOf(agentType: string | undefined): God {
  return GODS[BY_AGENT.get(agentType ?? "") ?? "nike"];
}

/**
 * The agent type a record runs as. A spawned agent's `agentName` is its task
 * name, so only its `agentType` counts; "default" is the host's word for none.
 */
export function agentTypeOf(agent: SubAgentLine): string | undefined {
  const type = agent.agentType ?? (agent.async ? undefined : agent.agentName);
  return type && type !== "default" ? type : undefined;
}
