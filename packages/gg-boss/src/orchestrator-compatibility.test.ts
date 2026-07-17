import { describe, expect, expectTypeOf, it } from "vitest";
import {
  GGBoss as LegacyManagerExport,
  KleioManager as PublicKleioManager,
  type GGBossOptions as LegacyManagerOptionsExport,
  type KleioManagerOptions as PublicKleioManagerOptions,
} from "./index.js";
import {
  GGBoss,
  KleioManager,
  type GGBossOptions,
  type KleioManagerOptions,
} from "./orchestrator.js";

const options = {
  bossProvider: "anthropic",
  bossModel: "claude-test",
  workerProvider: "anthropic",
  workerModel: "claude-test",
  projects: [],
} satisfies GGBossOptions;

describe("Kleio Manager public API compatibility", () => {
  it("exports the preferred and legacy names as the same constructor", () => {
    expect(KleioManager).toBe(GGBoss);
    expect(PublicKleioManager).toBe(LegacyManagerExport);
    expect(LegacyManagerExport).toBe(GGBoss);
  });

  it("keeps the preferred and legacy option types interchangeable", () => {
    expectTypeOf<KleioManagerOptions>().toEqualTypeOf<GGBossOptions>();
    expectTypeOf<PublicKleioManagerOptions>().toEqualTypeOf<LegacyManagerOptionsExport>();

    const branded: KleioManagerOptions = options;
    const legacy: LegacyManagerOptionsExport = branded;
    expect(legacy).toBe(options);
  });
});

describe("Manager prompt-cache compatibility", () => {
  it("retains the legacy ggboss prefix with and without a session id", () => {
    const manager = new KleioManager(options);
    const cacheProbe = manager as unknown as {
      bossSessionId: string;
      getBossPromptCacheKey(): string;
    };

    expect(cacheProbe.getBossPromptCacheKey()).toBe("ggboss");
    cacheProbe.bossSessionId = "session-123";
    expect(cacheProbe.getBossPromptCacheKey()).toBe("ggboss:session-123");
  });
});
