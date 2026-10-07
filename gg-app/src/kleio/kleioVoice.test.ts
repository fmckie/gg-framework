import { describe, expect, it } from "vitest";
import { chunks, pickVoice } from "./kleioVoice";

function voice(
  name: string,
  lang: string,
  extra: Partial<SpeechSynthesisVoice> = {},
): SpeechSynthesisVoice {
  return {
    name,
    lang,
    voiceURI: `com.apple.voice.${name}`,
    default: false,
    localService: true,
    ...extra,
  } as SpeechSynthesisVoice;
}

const MAC = [
  voice("Daniel", "en-GB", { default: true }),
  voice("Fred", "en-US"),
  voice("Zarvox", "en-US"),
  voice("Kathy", "en-US"),
  voice("Samantha", "en-US"),
  voice("Moira", "en-IE"),
  voice("Amélie", "fr-CA"),
];

describe("pickVoice", () => {
  it("defaults to a natural woman's voice, the user's own English first", () => {
    expect(pickVoice(MAC, "en-us")?.name).toBe("Samantha");
    // British or Irish English when the user's own isn't installed.
    expect(pickVoice(MAC, "en-gb")?.name).toBe("Moira");
    // A natural download beats a standard voice in the user's own English.
    expect(pickVoice([...MAC, voice("Serena (Premium)", "en-GB")], "en-us")?.name).toBe(
      "Serena (Premium)",
    );
  });

  it("falls back to the system default with no English voice, and to nothing with none", () => {
    expect(pickVoice([voice("Amélie", "fr-CA", { default: true })], "en-gb")?.name).toBe("Amélie");
    expect(pickVoice([], "en-gb")).toBeNull();
  });
});

describe("chunks", () => {
  it("splits at sentence ends, keeps file names whole, and packs short sentences", () => {
    expect(chunks("Fixed host.ts. Tests pass! Shall I ship? Yes…", 20)).toEqual([
      "Fixed host.ts.",
      "Tests pass!",
      "Shall I ship? Yes…",
    ]);
    expect(chunks("One. Two. Three.", 220)).toEqual(["One. Two. Three."]);
    expect(chunks("   ")).toEqual([]);
  });
});
