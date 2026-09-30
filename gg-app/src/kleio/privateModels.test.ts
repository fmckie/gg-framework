import { describe, expect, it } from "vitest";
import type { LocalEndpointRow, LocalModelRow } from "../agent";
import { hasUsableLocalModel, privateServers } from "./privateModels";

function model(supportsTools: boolean): LocalModelRow {
  return {
    id: "local/x/m",
    rawId: "m",
    contextWindow: 32_000,
    contextWindowKnown: true,
    supportsTools,
    supportsImages: false,
    supportsThinking: false,
  };
}

function endpoint(over: Partial<LocalEndpointRow>): LocalEndpointRow {
  return {
    id: "e",
    label: "Endpoint",
    baseUrl: "http://127.0.0.1:1/v1",
    kind: "custom",
    custom: true,
    reachable: true,
    models: [],
    ...over,
  };
}

describe("privateServers", () => {
  it("finds Tinfoil by the host's proxy port and Ollama by kind", () => {
    const tinfoil = endpoint({
      id: "t",
      baseUrl: "http://127.0.0.1:3301/v1",
      models: [model(true)],
    });
    const ollama = endpoint({ id: "o", kind: "ollama", models: [model(true), model(false)] });
    const servers = privateServers({ endpoints: [ollama, tinfoil] });
    expect(servers.tinfoil).toEqual({ endpoint: tinfoil, reachable: true, usableModels: 1 });
    expect(servers.ollama).toEqual({ endpoint: ollama, reachable: true, usableModels: 1 });
  });

  it("finds Tinfoil by name on another port", () => {
    const tinfoil = endpoint({ label: "Tinfoil router", baseUrl: "http://localhost:9000/v1" });
    expect(privateServers({ endpoints: [tinfoil] }).tinfoil.endpoint).toBe(tinfoil);
  });

  it("prefers a reachable server to one that isn't answering", () => {
    const down = endpoint({ id: "a", kind: "ollama", reachable: false });
    const up = endpoint({ id: "b", kind: "ollama" });
    expect(privateServers({ endpoints: [down, up] }).ollama.endpoint).toBe(up);
  });

  it("reports what isn't set up", () => {
    expect(privateServers({ endpoints: [endpoint({})] })).toEqual({
      tinfoil: { endpoint: null, reachable: false, usableModels: 0 },
      ollama: { endpoint: null, reachable: false, usableModels: 0 },
    });
  });

  it("ignores another host's port 3301 and unparsable addresses", () => {
    const remote = endpoint({ baseUrl: "http://10.0.0.5:3301/v1" });
    const junk = endpoint({ baseUrl: "not a url" });
    expect(privateServers({ endpoints: [remote, junk] }).tinfoil.endpoint).toBeNull();
  });
});

describe("hasUsableLocalModel", () => {
  it("needs a reachable server with a model that can call tools", () => {
    expect(hasUsableLocalModel({ endpoints: [endpoint({ models: [model(true)] })] })).toBe(true);
    expect(hasUsableLocalModel({ endpoints: [endpoint({ models: [model(false)] })] })).toBe(false);
    expect(
      hasUsableLocalModel({
        endpoints: [endpoint({ reachable: false, models: [model(true)] })],
      }),
    ).toBe(false);
    expect(hasUsableLocalModel({ endpoints: [] })).toBe(false);
  });
});
