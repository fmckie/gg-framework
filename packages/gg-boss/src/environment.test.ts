import { describe, expect, it } from "vitest";
import { resolveManagerTelegramEnvironment } from "./environment.js";

describe("resolveManagerTelegramEnvironment", () => {
  it("prefers Kleio Manager variables over legacy aliases", () => {
    expect(
      resolveManagerTelegramEnvironment({
        KLEIO_MANAGER_TELEGRAM_BOT_TOKEN: "preferred-token",
        GG_BOSS_TELEGRAM_BOT_TOKEN: "legacy-token",
        KLEIO_MANAGER_TELEGRAM_USER_ID: "100",
        GG_BOSS_TELEGRAM_USER_ID: "200",
      }),
    ).toEqual({ botToken: "preferred-token", userId: "100" });
  });

  it("supports legacy-only Telegram configuration", () => {
    expect(
      resolveManagerTelegramEnvironment({
        GG_BOSS_TELEGRAM_BOT_TOKEN: "legacy-token",
        GG_BOSS_TELEGRAM_USER_ID: "200",
      }),
    ).toEqual({ botToken: "legacy-token", userId: "200" });
  });

  it("treats empty preferred values as authoritative", () => {
    expect(
      resolveManagerTelegramEnvironment({
        KLEIO_MANAGER_TELEGRAM_BOT_TOKEN: "",
        GG_BOSS_TELEGRAM_BOT_TOKEN: "legacy-token",
        KLEIO_MANAGER_TELEGRAM_USER_ID: "",
        GG_BOSS_TELEGRAM_USER_ID: "200",
      }),
    ).toEqual({ botToken: "", userId: "" });
  });

  it("omits configuration when neither generation is present", () => {
    expect(resolveManagerTelegramEnvironment({})).toEqual({});
  });
});
