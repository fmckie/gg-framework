import { describe, expect, it } from "vitest";
import { buildManagerAudioEnvironment } from "./audio.js";
import { buildManagerRadioEnvironment } from "./radio.js";
import { buildWindowsBridgeEnvironment } from "./windows-environment.js";

describe("buildWindowsBridgeEnvironment", () => {
  it("exports preferred and legacy Manager child-process variables", () => {
    expect(
      buildWindowsBridgeEnvironment(
        { PATH: "/tools", WSLENV: "EXISTING/u" },
        {
          KLEIO_MANAGER_AUDIO_PATH: "C:\\audio.mp3",
          GGBOSS_AUDIO_PATH: "C:\\audio.mp3",
        },
      ),
    ).toEqual({
      PATH: "/tools",
      KLEIO_MANAGER_AUDIO_PATH: "C:\\audio.mp3",
      GGBOSS_AUDIO_PATH: "C:\\audio.mp3",
      WSLENV: "EXISTING/u:KLEIO_MANAGER_AUDIO_PATH:GGBOSS_AUDIO_PATH",
    });
  });

  it("creates WSLENV when no prior bridge variables exist", () => {
    expect(
      buildWindowsBridgeEnvironment(
        {},
        {
          KLEIO_MANAGER_RADIO_URL: "https://radio.example/stream",
          GGBOSS_RADIO_URL: "https://radio.example/stream",
        },
      ).WSLENV,
    ).toBe("KLEIO_MANAGER_RADIO_URL:GGBOSS_RADIO_URL");
  });

  it("exports both audio names from the production child environment", () => {
    expect(buildManagerAudioEnvironment("C:\\audio.mp3", {})).toEqual({
      KLEIO_MANAGER_AUDIO_PATH: "C:\\audio.mp3",
      GGBOSS_AUDIO_PATH: "C:\\audio.mp3",
      WSLENV: "KLEIO_MANAGER_AUDIO_PATH:GGBOSS_AUDIO_PATH",
    });
  });

  it("exports both radio names from the production child environment", () => {
    const url = "https://radio.example/stream";
    expect(buildManagerRadioEnvironment(url, {})).toEqual({
      KLEIO_MANAGER_RADIO_URL: url,
      GGBOSS_RADIO_URL: url,
      WSLENV: "KLEIO_MANAGER_RADIO_URL:GGBOSS_RADIO_URL",
    });
  });
});
