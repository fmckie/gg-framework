// The Olympus cast: each bundled agent is a god, and an agent with no name of
// its own, or one the cast doesn't know, is Nike.

import type { SubAgentLine } from "../SubAgentFeed";
import argus from "./cameos/argus.webp";
import athena from "./cameos/athena.webp";
import hephaestus from "./cameos/hephaestus.webp";
import hermes from "./cameos/hermes.webp";
import herodotus from "./cameos/herodotus.webp";
import nike from "./cameos/nike.webp";
import themis from "./cameos/themis.webp";

export type GodId = "athena" | "herodotus" | "hermes" | "hephaestus" | "argus" | "themis" | "nike";

export interface God {
  readonly id: GodId;
  readonly name: string;
  /** Its cameo's URL: 72×96, drawn at 24×32 in a row. */
  readonly cameo: string;
}

export const GODS: Readonly<Record<GodId, God>> = {
  athena: { id: "athena", name: "Athena", cameo: athena },
  herodotus: { id: "herodotus", name: "Herodotus", cameo: herodotus },
  hermes: { id: "hermes", name: "Hermes", cameo: hermes },
  hephaestus: { id: "hephaestus", name: "Hephaestus", cameo: hephaestus },
  argus: { id: "argus", name: "Argus", cameo: argus },
  themis: { id: "themis", name: "Themis", cameo: themis },
  nike: { id: "nike", name: "Nike", cameo: nike },
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
