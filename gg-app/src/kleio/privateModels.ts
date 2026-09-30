// Kleio's private (local) model servers on the Mac mini, read from the host's
// local-endpoint list: Tinfoil (a confidential-compute router the host runs on
// 127.0.0.1:3301 — the Blobs' default model) and Ollama.
//
// A private model counts as "an AI provider" for the home screen's Code
// button: someone who only uses Tinfoil or Ollama is ready to code.

import type { LocalEndpointRow, LocalModelsState } from "../agent";

/** The host's Tinfoil proxy (packages/kleio-host/src/blobs.ts DEFAULT_BLOB_MODEL). */
export const TINFOIL_PORT = "3301";

export type PrivateServer = "tinfoil" | "ollama";

export interface PrivateServerState {
  /** The server's endpoint on the Mac mini; absent when it isn't set up. */
  endpoint: LocalEndpointRow | null;
  /** It answered the last probe. */
  reachable: boolean;
  /** Models that can run the agent (tool calling). */
  usableModels: number;
}

function isTinfoil(endpoint: LocalEndpointRow): boolean {
  if (/tinfoil/i.test(endpoint.label)) return true;
  try {
    const url = new URL(endpoint.baseUrl);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === TINFOIL_PORT
    );
  } catch {
    return false;
  }
}

function which(endpoint: LocalEndpointRow): PrivateServer | null {
  if (isTinfoil(endpoint)) return "tinfoil";
  if (endpoint.kind === "ollama") return "ollama";
  return null;
}

function stateOf(endpoint: LocalEndpointRow | undefined): PrivateServerState {
  if (!endpoint) return { endpoint: null, reachable: false, usableModels: 0 };
  return {
    endpoint,
    reachable: endpoint.reachable,
    usableModels: endpoint.models.filter((m) => m.supportsTools).length,
  };
}

/** Tinfoil and Ollama as the host sees them. */
export function privateServers(
  state: LocalModelsState,
): Readonly<Record<PrivateServer, PrivateServerState>> {
  const found: Partial<Record<PrivateServer, LocalEndpointRow>> = {};
  for (const endpoint of state.endpoints) {
    const kind = which(endpoint);
    // The first reachable one wins; else the first one seen.
    if (kind && (!found[kind] || (!found[kind]?.reachable && endpoint.reachable))) {
      found[kind] = endpoint;
    }
  }
  return { tinfoil: stateOf(found.tinfoil), ollama: stateOf(found.ollama) };
}

/** Any local server that answered with at least one model able to run the agent. */
export function hasUsableLocalModel(state: LocalModelsState): boolean {
  return state.endpoints.some(
    (endpoint) => endpoint.reachable && endpoint.models.some((m) => m.supportsTools),
  );
}
