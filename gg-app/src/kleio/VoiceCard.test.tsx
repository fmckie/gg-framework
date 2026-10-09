// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { getVoiceStatus, type VoiceStatus } from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { VoiceCard } from "./VoiceCard";

vi.mock("./VoiceGuide", () => ({ VoiceGuide: () => null }));
vi.mock("./VoiceMode", () => ({ setVoiceReady: vi.fn(), talkToKleio: vi.fn() }));
vi.mock("./kleioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof KleioApi>();
  return {
    KleioApiError: actual.KleioApiError,
    errorText: actual.errorText,
    getVoiceStatus: vi.fn(),
    removeVoiceKey: vi.fn(),
    setVoiceKey: vi.fn(),
    setVoiceName: vi.fn(),
  };
});

function voice(ready: boolean): VoiceStatus {
  return { ready, voice: "marin", model: "gpt-live", voices: ["marin", "cedar"], speed: 1 };
}

async function renderCard(ready: boolean, canEdit?: boolean): Promise<void> {
  vi.mocked(getVoiceStatus).mockResolvedValue(voice(ready));
  await act(async () => {
    render(canEdit === undefined ? <VoiceCard /> : <VoiceCard canEdit={canEdit} />);
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VoiceCard", () => {
  it("lets an admin device add the key", async () => {
    await renderCard(false);
    expect(screen.getByLabelText("OpenAI API key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("lets an admin device pick the voice and remove the key", async () => {
    await renderCard(true, true);
    expect(screen.getByLabelText("Kleio's conversation voice")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove OpenAI key" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Talk now" })).toBeTruthy();
  });

  it("leaves the key to the admin device on any other", async () => {
    await renderCard(false, false);
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(
      screen.getByText("Not set up yet. Your admin device can add the OpenAI key."),
    ).toBeTruthy();
  });

  it("still lets any device talk once the key is set", async () => {
    await renderCard(true, false);
    expect(screen.getByRole("button", { name: "Talk now" })).toBeTruthy();
    expect(screen.queryByLabelText("Kleio's conversation voice")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove OpenAI key" })).toBeNull();
  });
});
