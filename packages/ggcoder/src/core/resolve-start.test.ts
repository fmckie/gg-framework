import { describe, it, expect } from "vitest";
import type { Provider } from "@kleio/ai";
import { getDefaultModel, registerRuntimeModels, clearRuntimeModels } from "./model-registry.js";
import { resolveStartOrFallback, type ProviderAuthLookup } from "./resolve-start.js";

const ALL: Provider[] = [
  "anthropic",
  "xiaomi",
  "openai",
  "gemini",
  "glm",
  "moonshot",
  "minimax",
  "deepseek",
  "openrouter",
  "sakana",
  "xai",
];

/** Fake auth lookup: only the providers in `set` are "logged in". */
function auth(...connected: Provider[]): ProviderAuthLookup {
  const set = new Set<string>(connected);
  return { hasProviderAuth: async (p) => set.has(p) };
}

describe("resolveStartOrFallback", () => {
  it("falls back to preferred + default model when no provider is logged in", async () => {
    const res = await resolveStartOrFallback(auth(), ALL, "anthropic", undefined);
    expect(res.loggedIn).toBe(false);
    expect(res.provider).toBe("anthropic");
    expect(res.model).toBe(getDefaultModel("anthropic").id);
  });

  it("honors a non-anthropic preferred provider in the logged-out fallback", async () => {
    const res = await resolveStartOrFallback(auth(), ALL, "openai", undefined);
    expect(res.loggedIn).toBe(false);
    expect(res.provider).toBe("openai");
    expect(res.model).toBe(getDefaultModel("openai").id);
  });

  it("uses the preferred provider's default model when logged in with no saved model", async () => {
    const res = await resolveStartOrFallback(auth("anthropic"), ALL, "anthropic", undefined);
    expect(res.loggedIn).toBe(true);
    expect(res.provider).toBe("anthropic");
    expect(res.model).toBe(getDefaultModel("anthropic").id);
  });

  it("keeps a saved model that belongs to the preferred provider", async () => {
    const saved = getDefaultModel("anthropic").id;
    const res = await resolveStartOrFallback(auth("anthropic"), ALL, "anthropic", saved);
    expect(res.loggedIn).toBe(true);
    expect(res.provider).toBe("anthropic");
    expect(res.model).toBe(saved);
  });

  it("ignores a saved model that belongs to a different provider", async () => {
    // Saved model is an OpenAI model but preferred is anthropic → default anthropic.
    const otherProviderModel = getDefaultModel("openai").id;
    const res = await resolveStartOrFallback(
      auth("anthropic"),
      ALL,
      "anthropic",
      otherProviderModel,
    );
    expect(res.provider).toBe("anthropic");
    expect(res.model).toBe(getDefaultModel("anthropic").id);
  });

  it("falls back to the first logged-in provider when preferred is not connected", async () => {
    // Preferred anthropic is logged out; only openai is connected.
    const res = await resolveStartOrFallback(auth("openai"), ALL, "anthropic", undefined);
    expect(res.loggedIn).toBe(true);
    expect(res.provider).toBe("openai");
    expect(res.model).toBe(getDefaultModel("openai").id);
  });

  it("picks the first connected provider in registry order", async () => {
    // Both gemini and glm connected; ALL lists gemini before glm.
    const res = await resolveStartOrFallback(auth("glm", "gemini"), ALL, "anthropic", undefined);
    expect(res.provider).toBe("gemini");
  });

  describe("a project pinned to a local model (provider outside the fixed list)", () => {
    const LOCAL_ID = "local/custom-127-0-0-1-3301/kimi-k3";
    const register = (): void =>
      registerRuntimeModels([
        {
          id: LOCAL_ID,
          name: "kimi-k3",
          provider: "local",
          contextWindow: 262144,
          maxOutputTokens: 8192,
          supportsThinking: false,
          supportsImages: true,
          supportsVideo: false,
          costTier: "low",
          maxThinkingLevel: "high",
        },
      ]);
    const cleanup = (): void => clearRuntimeModels((m) => m.provider === "local");

    it("keeps the pin when the model is registered and the endpoint is authed", async () => {
      register();
      try {
        const res = await resolveStartOrFallback(auth("openai", "local"), ALL, "local", LOCAL_ID);
        expect(res).toEqual({ provider: "local", model: LOCAL_ID, loggedIn: true });
      } finally {
        cleanup();
      }
    });

    it("falls back to a cloud provider when the local model isn't discovered", async () => {
      const res = await resolveStartOrFallback(auth("openai", "local"), ALL, "local", LOCAL_ID);
      expect(res).toEqual({
        provider: "openai",
        model: getDefaultModel("openai").id,
        loggedIn: true,
      });
    });

    it("falls back when the endpoint has no credential", async () => {
      register();
      try {
        const res = await resolveStartOrFallback(auth("openai"), ALL, "local", LOCAL_ID);
        expect(res.provider).toBe("openai");
      } finally {
        cleanup();
      }
    });
  });
});
