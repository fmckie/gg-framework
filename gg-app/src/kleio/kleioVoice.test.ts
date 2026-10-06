import { describe, expect, it } from "vitest";
import { chunks, englishVoices, pickVoice } from "./kleioVoice";

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
    expect(pickVoice(MAC, null, "en-us")?.name).toBe("Samantha");
    // British or Irish English when the user's own isn't installed.
    expect(pickVoice(MAC, null, "en-gb")?.name).toBe("Moira");
    // A natural download beats a standard voice in the user's own English.
    expect(pickVoice([...MAC, voice("Serena (Premium)", "en-GB")], null, "en-us")?.name).toBe(
      "Serena (Premium)",
    );
  });

  it("keeps the user's choice while it is installed", () => {
    expect(pickVoice(MAC, "com.apple.voice.Daniel", "en-gb")?.name).toBe("Daniel");
    expect(pickVoice(MAC, "com.apple.voice.Gone", "en-gb")?.name).toBe("Moira");
  });

  it("falls back to the system default with no English voice, and to nothing with none", () => {
    expect(pickVoice([voice("Amélie", "fr-CA", { default: true })], null, "en-gb")?.name).toBe(
      "Amélie",
    );
    expect(pickVoice([], null, "en-gb")).toBeNull();
  });
});

describe("englishVoices", () => {
  it("lists English voices for the picker, best first, without novelty voices", () => {
    const list = englishVoices(MAC, "en-gb");
    expect(list.map((v) => v.label)).toEqual([
      "Moira (Irish)",
      "Samantha (American)",
      "Kathy (American)",
      "Daniel (British)",
      "Fred (American)",
    ]);
    expect(list.filter((v) => v.female).map((v) => v.label)).toHaveLength(3);
  });

  it("marks the natural downloads", () => {
    const [first] = englishVoices([voice("Serena (Premium)", "en-GB")], "en-gb");
    expect(first).toMatchObject({ label: "Serena (British, premium)", natural: true });
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
