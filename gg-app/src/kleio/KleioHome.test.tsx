// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { authStatusWithError, getLocalModels, getSettings } from "../agent";
import { toast } from "../toast";
import { diagnoseLink, diagnosisText, type Diagnosis } from "./connectionDiagnosis";
import { KleioHome } from "./KleioHome";
import { setVoiceReady } from "./VoiceMode";
import { shortHost } from "./host-name";
import type * as VoiceCall from "./voiceCall";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.73.2") }));
vi.mock("../HomeDither", () => ({
  HomeDither: ({ paused }: { paused?: boolean }) => (
    <div data-testid="waves" data-paused={String(Boolean(paused))} />
  ),
}));
const voice = vi.hoisted(() => ({ open: false }));
vi.mock("./voiceCall", async (importOriginal) => ({
  ...(await importOriginal<typeof VoiceCall>()),
  useCallOpen: () => voice.open,
}));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("./assets/kleio-mark.png", () => ({ default: "kleio-mark.png" }));
vi.mock("./useKleioRemote", () => ({
  useKleioRemote: () => ({
    status: {
      active: {
        base: "https://mac-mini-1.x.ts.net:8443",
        host: "mac-mini-1.x.ts.net",
        deviceId: "d1",
        label: "Laptop",
        admin: true,
      },
      paired: null,
    },
    refresh: vi.fn(),
  }),
}));
// Whether the Mac mini answers right now (HostReachProvider, mounted in main.tsx),
// and over Kleio's link, why not.
const reach = vi.hoisted(() => ({
  value: "connected" as "checking" | "connected" | "disconnected",
  words: null as Diagnosis | null,
}));
vi.mock("./hostReach", () => ({
  useHostReach: () => reach.value,
  useHostReachWords: () => reach.words,
}));

vi.mock("../agent", () => ({
  waitForReady: vi.fn(async () => undefined),
  getSettings: vi.fn(),
  authStatusWithError: vi.fn(),
  getLocalModels: vi.fn(),
}));

const TOOL_MODEL = {
  id: "local/tinfoil/kimi-k3",
  rawId: "kimi-k3",
  contextWindow: 128_000,
  contextWindowKnown: true,
  supportsTools: true,
  supportsImages: false,
  supportsThinking: false,
};

function renderHome() {
  const props = {
    onChat: vi.fn(),
    onCode: vi.fn(),
    onMotion: vi.fn(),
    onGoals: vi.fn(),
    onBlobs: vi.fn(),
    onSettings: vi.fn(),
  };
  render(<KleioHome {...props} />);
  return props;
}

beforeEach(() => {
  // The plates draw on canvases, which jsdom doesn't have.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.mocked(getSettings).mockResolvedValue({
    projectsRoot: "/Users/me/kleio-projects",
    configured: true,
  });
  vi.mocked(authStatusWithError).mockResolvedValue({
    providers: [{ provider: "openai", connected: true }],
    error: null,
  } as never);
  vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  voice.open = false;
  reach.value = "connected";
  reach.words = null;
});

describe("KleioHome", () => {
  it("is Kleio's: the mark, none of Ken's links, and the credit moved to Settings", async () => {
    renderHome();
    expect(screen.getByRole("img", { name: "Kleio" })).toBeDefined();
    // The credit lives on Settings → About now (AboutPage), not under the buttons.
    expect(screen.queryByText(/Ken Kai/)).toBeNull();
    expect(screen.queryByText("Skool")).toBeNull();
    expect(screen.queryByText("YouTube")).toBeNull();
    expect(screen.queryByText(/piss me off/)).toBeNull();
    expect(await screen.findByText("v0.73.2")).toBeDefined();
  });

  it("Chat opens the chat and Specialists opens the specialists; Apps is in Settings", async () => {
    const p = renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Specialists" }));
    expect(p.onChat).toHaveBeenCalledOnce();
    expect(p.onBlobs).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Blobs/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apps/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Agents/ })).toBeNull();
  });

  it("Motion opens the video studio", async () => {
    const p = renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    const motion = await screen.findByRole("button", { name: "Motion" });
    await waitFor(() => expect(motion.getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(motion);
    expect(p.onMotion).toHaveBeenCalledOnce();
  });

  it("Motion asks for a projects folder first: its videos are saved there", async () => {
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: "", configured: false });
    const p = renderHome();
    const motion = screen.getByRole("button", { name: "Motion" });
    await waitFor(() => expect(motion.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(motion);
    expect(p.onMotion).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Set a projects folder on your host first.", "warning");
    expect(p.onSettings).toHaveBeenCalledWith("general");
  });

  it("opens Goals from its own button", async () => {
    const p = renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(p.onGoals).toHaveBeenCalledOnce();
  });

  it("makes every way in a plate, Voice agent (Talk to Kleio) among them, with the shortcuts in the hover tips", async () => {
    renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    // The host's answer (no voice here) can land late; set it until it holds.
    const talk = await waitFor(() => {
      act(() => setVoiceReady(true));
      return screen.getByRole("button", { name: "Voice agent" });
    });
    const specialists = screen.getByRole("button", { name: "Specialists" });
    // The pyramid's order: three, two, one (the rows are kleio-theme.css's).
    const plates = [...document.querySelectorAll(".home-actions > button")];
    expect(plates.map((b) => b.textContent)).toEqual([
      "Chat",
      "Code",
      "Motion",
      "Goals",
      "Specialists",
      "Voice agent",
    ]);
    for (const plate of plates) {
      expect(plate.classList.contains("kleio-plate")).toBe(true);
      expect(plate.querySelectorAll("canvas[aria-hidden='true']")).toHaveLength(3);
    }
    expect(document.querySelector(".home-quiet, .kleio-cloisonne, kbd")).toBeNull();
    expect(specialists.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+L");
    expect(specialists.getAttribute("title")).toBe("Specialists (⌘⇧L)");
    expect(talk.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+B");
    expect(talk.getAttribute("title")).toBe(
      "Talk to Kleio: ask what's happening, or plan something out (⌘⇧B)",
    );
    act(() => setVoiceReady(false));
  });

  it("sinks a plate that isn't ready and raises it once it is", async () => {
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: "", configured: false });
    renderHome();
    const code = screen.getByRole("button", { name: "Code" });
    await waitFor(() => expect(code.classList.contains("is-dimmed")).toBe(true));
    expect(code.getAttribute("aria-disabled")).toBe("true");
    const goals = screen.getByRole("button", { name: "Goals" });
    expect(goals.classList.contains("is-dimmed")).toBe(false);
    expect(goals.getAttribute("aria-disabled")).toBeNull();
  });

  it("keeps the iPhone's column: five domed buttons with icons, and a small Voice agent under them", async () => {
    document.documentElement.classList.add("platform-ios");
    try {
      renderHome();
      await waitFor(() => expect(getSettings).toHaveBeenCalled());
      const talk = await waitFor(() => {
        act(() => setVoiceReady(true));
        return screen.getByRole("button", { name: "Voice agent" });
      });
      const column = [...document.querySelectorAll(".home-actions > button")];
      expect(column.map((b) => b.textContent)).toEqual([
        "Chat",
        "Code",
        "Motion",
        "Goals",
        "Specialists",
      ]);
      for (const button of column) {
        expect(button.className).toBe("kleio-cloisonne home-action");
        expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      }
      expect(talk.className).toBe("kleio-cloisonne is-small home-brief");
      expect(talk.parentElement?.className).toBe("home-quiet");
      expect(talk.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+B");
      expect(document.querySelector(".kleio-plate")).toBeNull();
      act(() => setVoiceReady(false));
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });

  it("holds its waves still while the voice screen covers it, so a call draws one set", async () => {
    renderHome();
    expect(screen.getByTestId("waves").dataset.paused).toBe("false");
    cleanup();
    voice.open = true;
    renderHome();
    expect(screen.getByTestId("waves").dataset.paused).toBe("true");
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
  });

  it("shows the Mac mini and opens the Connection settings", async () => {
    const p = renderHome();
    fireEvent.click(screen.getByRole("button", { name: /Connected to mac-mini-1/ }));
    expect(p.onSettings).toHaveBeenCalledWith("connection");
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
  });

  it("says Disconnected when the Mac mini stops answering, not a Connected left over from launch", async () => {
    reach.value = "disconnected";
    const p = renderHome();
    expect(screen.queryByRole("button", { name: /Connected to/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Disconnected from mac-mini-1/ }));
    expect(p.onSettings).toHaveBeenCalledWith("connection");
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
  });

  it("over Kleio's link, says why it can't reach the host, with the rest on hover", async () => {
    reach.value = "disconnected";
    reach.words = {
      tone: "bad",
      badge: "Asleep or offline",
      headline: "mac-mini-1 is asleep or offline",
      detail: "Last reached 3 min ago.",
      checks: [],
      fix: [],
    };
    const p = renderHome();
    const pill = screen.getByRole("button", { name: "mac-mini-1 is asleep or offline" });
    expect(pill.getAttribute("title")).toBe(
      "mac-mini-1 is asleep or offline. Last reached 3 min ago.",
    );
    expect(pill.className).toContain("is-down");
    fireEvent.click(pill);
    expect(p.onSettings).toHaveBeenCalledWith("connection");
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
  });

  it("a laptop host that's asleep: the same words as everywhere, the rest on hover", async () => {
    const NOW = Date.parse("2026-11-12T12:00:00Z");
    const asleep = diagnoseLink(
      {
        link: {
          paired: true,
          active: true,
          running: true,
          error: null,
          host: "mac-mini-1.x.ts.net",
          hostKey: "ab".repeat(32),
          relay: "https://euc1-1.relay.n0.iroh.link./",
          relayN0: true,
          refused: null,
          refusal: null,
          connected: false,
          dialling: false,
          unreached: { kind: "host-silent", relays: [] },
          lastReachedMs: NOW - 3 * 60_000,
          path: null,
          pathAddr: null,
          pathN0: false,
          rateLimited: false,
          rttMs: null,
          connectedSinceMs: null,
          redials: 0,
          lastResumeMs: null,
          events: [],
          debugBuild: false,
        },
        health: { state: "error", kleioDown: false },
        host: { os: "darwin", laptop: true, alwaysOn: { state: "laptop", reasons: [] } },
        hostLabel: "mac-mini-1",
        device: "iPhone",
        online: true,
      },
      NOW,
    );
    reach.value = "disconnected";
    reach.words = asleep;
    renderHome();
    const pill = screen.getByRole("button", { name: "Kleio lives on mac-mini-1, which is asleep" });
    expect(pill.getAttribute("title")).toBe(
      "Kleio lives on mac-mini-1, which is asleep. Open it and Kleio reconnects by itself. Last reached 3 min ago.",
    );
    expect(pill.getAttribute("title")).toBe(diagnosisText(asleep));
    expect(pill.className).toContain("is-down");
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
  });

  it("over Kleio's link, says so while it reconnects", async () => {
    reach.value = "checking";
    reach.words = {
      tone: "warn",
      badge: "Reconnecting",
      headline: "Reconnecting to mac-mini-1…",
      detail: "Kleio is looking for it through its relays.",
      checks: [],
      fix: [],
    };
    renderHome();
    const pill = screen.getByRole("button", { name: "Reconnecting to mac-mini-1…" });
    expect(pill.className).toContain("is-checking");
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
  });

  it("Code goes to the projects when the Mac mini is set up", async () => {
    const p = renderHome();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /Code/ }));
      expect(p.onCode).toHaveBeenCalled();
    });
  });

  it("counts a running private model (Tinfoil) as ready, with no provider signed in", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({
      providers: [{ provider: "openai", connected: false }],
      error: null,
    } as never);
    vi.mocked(getLocalModels).mockResolvedValue({
      endpoints: [
        {
          id: "tinfoil",
          label: "Tinfoil",
          baseUrl: "http://127.0.0.1:3301/v1",
          kind: "custom",
          custom: true,
          reachable: true,
          models: [TOOL_MODEL],
        },
      ],
    });
    const p = renderHome();
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /Code/ }));
      expect(p.onCode).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(p.onChat).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
  });

  it("without any model, Chat and Code point to AI Providers instead", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({
      providers: [{ provider: "openai", connected: false }],
      error: null,
    } as never);
    const p = renderHome();
    const code = screen.getByRole("button", { name: /Code/ });
    await waitFor(() => expect(code.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(code);
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(p.onCode).not.toHaveBeenCalled();
    expect(p.onChat).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Connect an AI model first.", "warning");
    expect(p.onSettings.mock.calls).toEqual([["providers"], ["providers"]]);
  });

  // The Mac mini restarting forgets the phone's session; until it is replaced,
  // the sign-in list can't be read. That is "unknown", not "no model": the
  // phone must not send someone who is signed in to AI Providers.
  it("keeps Chat and Code open when the Mac mini can't say who is signed in", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({
      providers: [],
      error: "unknown session",
    });
    const p = renderHome();
    await waitFor(() => expect(authStatusWithError).toHaveBeenCalled());
    await waitFor(() => expect(getLocalModels).toHaveBeenCalled());
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /Code/ }));
      expect(p.onCode).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(p.onChat).toHaveBeenCalledOnce();
    expect(toast).not.toHaveBeenCalled();
    expect(p.onSettings).not.toHaveBeenCalled();
  });

  it("Code without a projects folder points to General", async () => {
    vi.mocked(getSettings).mockResolvedValue({ projectsRoot: "", configured: false });
    const p = renderHome();
    const code = screen.getByRole("button", { name: /Code/ });
    await waitFor(() => expect(code.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(code);
    expect(p.onCode).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Set a projects folder on your host first.", "warning");
    expect(p.onSettings).toHaveBeenCalledWith("general");
  });

  it("shortens the tailnet host", () => {
    expect(shortHost("mac-mini-1.taila6c237.ts.net")).toBe("mac-mini-1");
    expect(shortHost("mini")).toBe("mini");
    // An address keeps every part: "100" alone would name nothing.
    expect(shortHost("100.101.102.103")).toBe("100.101.102.103");
    expect(shortHost("fd7a:115c::1")).toBe("fd7a:115c::1");
  });
});
