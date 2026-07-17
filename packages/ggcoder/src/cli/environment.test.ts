import { describe, expect, it } from "vitest";
import { resolveCoderTelegramEnvironment } from "./environment.js";

describe("resolveCoderTelegramEnvironment", () => {
  it("prefers Kleio variables over legacy aliases", () => {
    expect(
      resolveCoderTelegramEnvironment({
        KLEIO_CODER_TELEGRAM_BOT_TOKEN: "preferred-token",
        GG_TELEGRAM_BOT_TOKEN: "legacy-token",
        KLEIO_CODER_TELEGRAM_USER_ID: "100",
        GG_TELEGRAM_USER_ID: "200",
      }),
    ).toEqual({ botToken: "preferred-token", userId: "100" });
  });

  it("supports legacy-only Telegram configuration", () => {
    expect(
      resolveCoderTelegramEnvironment({
        GG_TELEGRAM_BOT_TOKEN: "legacy-token",
        GG_TELEGRAM_USER_ID: "200",
      }),
    ).toEqual({ botToken: "legacy-token", userId: "200" });
  });

  it("treats empty preferred values as authoritative", () => {
    expect(
      resolveCoderTelegramEnvironment({
        KLEIO_CODER_TELEGRAM_BOT_TOKEN: "",
        GG_TELEGRAM_BOT_TOKEN: "legacy-token",
        KLEIO_CODER_TELEGRAM_USER_ID: "",
        GG_TELEGRAM_USER_ID: "200",
      }),
    ).toEqual({ botToken: "", userId: "" });
  });

  it("omits configuration when neither generation is present", () => {
    expect(resolveCoderTelegramEnvironment({})).toEqual({});
  });
});
