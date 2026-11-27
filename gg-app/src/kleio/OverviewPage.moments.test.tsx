// @vitest-environment jsdom
// Overview's moments: the welcome, a step done, the finish. Fake timers throughout.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { authStatusWithError, getLocalModels, listMcpServers, listMemories } from "../agent";
import { askHostKind, rememberedHostKind, useHostReach, useHostReachWords } from "./hostReach";
import {
  getDictationSetup,
  getSetupStatus,
  getVoiceStatus,
  listConnections,
  type SetupStatus,
  type VoiceStatus,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { LINE_FADE_MS, LINE_MORE_MS, LINE_MS, NAME_WAIT_MS, WELCOME_MS } from "./OverviewMoments";
import { OverviewPage, REREAD_MS } from "./OverviewPage";
import { FINISHED_KEY, forgetSeen, STEPS_KEY, WELCOMED_KEY } from "./overviewSeen";
import { takeSettingsIntent } from "./settingsIntent";
import { useKleioRemote } from "./useKleioRemote";

vi.mock("../agent", () => ({
  authStatusWithError: vi.fn(),
  getLocalModels: vi.fn(),
  listMcpServers: vi.fn(),
  listMemories: vi.fn(),
}));
vi.mock("./hostReach", () => ({
  useHostReach: vi.fn(),
  useHostReachWords: vi.fn(),
  askHostKind: vi.fn(),
  rememberedHostKind: vi.fn(),
}));
vi.mock("./useKleioRemote", () => ({ useKleioRemote: vi.fn() }));
vi.mock("./kleioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof KleioApi>();
  return {
    KleioApiError: actual.KleioApiError,
    errorText: actual.errorText,
    getVoiceStatus: vi.fn(),
    getSetupStatus: vi.fn(),
    listConnections: vi.fn(),
    getDictationSetup: vi.fn(),
  };
});

const SEEN = "kleio-setup-seen";
type Done = { models?: boolean; voice?: boolean; apps?: boolean };
type Remote = ReturnType<typeof useKleioRemote>["status"];

function voice(ready: boolean): VoiceStatus {
  return { ready, voice: "marin", model: "gpt-live", voices: ["marin", "cedar"], speed: 1 };
}
function keys(openai: boolean, composio: boolean): SetupStatus {
  return {
    admin: true,
    keys: {
      openai: openai ? "saved" : "missing",
      composio: composio ? "saved" : "missing",
      typesafe: "missing",
    },
  };
}
const remote = (host: string | null): Remote => ({
  active: host
    ? { base: `https://${host}:8443`, host, deviceId: "d1", label: "Laptop", admin: true }
    : null,
  paired: null,
});
/** What the host says: which needed steps are done. The extras stay optional. */
function host(done: Done): void {
  vi.mocked(authStatusWithError).mockResolvedValue({
    providers: [
      {
        value: "anthropic",
        label: "Anthropic",
        description: "",
        methods: [],
        connected: done.models ?? false,
        connectedMethods: [],
      },
    ],
    error: null,
  });
  vi.mocked(getVoiceStatus).mockResolvedValue(voice(done.voice ?? false));
  vi.mocked(getSetupStatus).mockResolvedValue(keys(done.voice ?? false, done.apps ?? false));
  vi.mocked(listConnections).mockResolvedValue({ configured: done.apps ?? false, connections: [] });
}
const ALL: Done = { models: true, voice: true, apps: true };
/** Tools, Dictation and Brain all in use: nothing left optional. */
function noExtras(): void {
  vi.mocked(getDictationSetup).mockResolvedValue({ state: "ready", bytes: 138_853_314 });
  vi.mocked(listMemories).mockResolvedValue({
    softLimit: 60,
    hardLimit: 90,
    memories: [
      {
        id: "a",
        text: "Lives in Edinburgh.",
        category: "identity",
        importance: 3,
        createdAt: "2026-11-19T09:00:00.000Z",
        updatedAt: "2026-11-19T09:00:00.000Z",
      },
    ],
  });
  vi.mocked(listMcpServers).mockResolvedValue([
    { name: "github", scope: "global", ok: true, toolCount: 4, kind: "stdio", summary: "npx x" },
  ]);
}
/** Someone who has used Overview before 8f, or since: no welcome owed. */
function seen(steps?: Record<string, string>): void {
  localStorage.setItem(SEEN, "1");
  localStorage.setItem(WELCOMED_KEY, "1");
  if (steps) localStorage.setItem(STEPS_KEY, JSON.stringify(steps));
}
/** Whether motion is welcome. jsdom has no matchMedia, which the page reads as reduced motion. */
function motion(welcome: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: welcome === query.includes("no-preference"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

async function open(): Promise<ReturnType<typeof render>> {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<OverviewPage onOpenTab={vi.fn()} />);
  });
  return view;
}
/** Leave Overview, as switching tab or pressing Back does. */
const leave = (): void => cleanup();
const pass = (ms: number): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const welcome = (): HTMLElement | null => document.querySelector<HTMLElement>(".ov-welcome");
const region = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>(".ov-said");
  if (!el) throw new Error("no step-line region");
  return el;
};
const lines = (): string[] =>
  [...region().querySelectorAll(".ov-said-line")].map((p) => p.textContent ?? "");
const headline = (): string => screen.getByRole("heading", { level: 2 }).textContent ?? "";
const sub = (): string | null => document.querySelector(".ov-sub")?.textContent ?? null;
const record = (): unknown => JSON.parse(localStorage.getItem(STEPS_KEY) ?? "null");
const overviewKeys = (): Record<string, string> =>
  Object.fromEntries(
    Object.keys(localStorage)
      .filter((k) => k.startsWith("kleio.overview."))
      .sort()
      .map((k) => [k, localStorage.getItem(k) ?? ""]),
  );

/** A paired, connected host with nothing else done, at eight in the evening. */
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  forgetSeen();
  vi.spyOn(Date.prototype, "getHours").mockReturnValue(20);
  vi.mocked(useHostReach).mockReturnValue("connected");
  vi.mocked(useHostReachWords).mockReturnValue(null);
  vi.mocked(askHostKind).mockResolvedValue(null);
  vi.mocked(rememberedHostKind).mockReturnValue(null);
  vi.mocked(useKleioRemote).mockReturnValue({
    status: remote("mac-mini.example.ts.net"),
    refresh: vi.fn(async () => undefined),
  });
  vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
  vi.mocked(getDictationSetup).mockResolvedValue({ state: "absent", bytes: 138_853_314 });
  vi.mocked(listMemories).mockResolvedValue({ softLimit: 60, hardLimit: 90, memories: [] });
  vi.mocked(listMcpServers).mockResolvedValue([]);
  host({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Overview's welcome", () => {
  it("greets a new device with the mark and where Kleio will live, and nothing to press", async () => {
    await open();
    const hello = within(welcome()!);
    expect(welcome()!.getAttribute("role")).toBe("status");
    expect(hello.getByRole("img", { name: "Kleio" })).toBeTruthy();
    expect(hello.getByRole("heading", { level: 2 }).textContent).toBe("Hi, I'm Kleio.");
    expect(sub()).toBe("I'll live on mac-mini and take the busywork off your hands.");
    expect(welcome()!.querySelector("button, a, input, select, textarea, [tabindex]")).toBeNull();
    expect(screen.queryByRole("list", { name: "Areas" })).toBeNull();
  });

  it("is spent as it begins, before its words show", async () => {
    vi.mocked(useKleioRemote).mockReturnValue({ status: null, refresh: vi.fn() });
    await open();
    expect(welcome()).toBeNull();
    expect(overviewKeys()).toEqual({ [WELCOMED_KEY]: "1" });
    expect(localStorage.getItem(SEEN)).toBe("1");
  });

  it("holds a moment, then hands over to the list", async () => {
    await open();
    await pass(WELCOME_MS - 1);
    expect(welcome()).not.toBeNull();
    await pass(1);
    expect(welcome()).toBeNull();
    expect(headline()).toBe("Let's get Kleio ready.");
    expect(screen.getByRole("list", { name: "Areas" })).toBeTruthy();
  });

  it("drops the clause when the host has no name", async () => {
    vi.mocked(useKleioRemote).mockReturnValue({ status: remote(null), refresh: vi.fn() });
    await open();
    expect(sub()).toBe("I'll take the busywork off your hands.");
  });

  it("waits for the host's name, then says it", async () => {
    vi.mocked(useKleioRemote).mockReturnValue({ status: null, refresh: vi.fn() });
    const view = await open();
    await pass(NAME_WAIT_MS - 1);
    expect(welcome()).toBeNull();
    expect(screen.queryByRole("list", { name: "Areas" })).toBeNull();

    vi.mocked(useKleioRemote).mockReturnValue({
      status: remote("mac-mini.example.ts.net"),
      refresh: vi.fn(),
    });
    await act(async () => view.rerender(<OverviewPage onOpenTab={vi.fn()} />));
    expect(sub()).toBe("I'll live on mac-mini and take the busywork off your hands.");
    // It holds its full moment from here.
    await pass(WELCOME_MS - 1);
    expect(welcome()).not.toBeNull();
    await pass(1);
    expect(welcome()).toBeNull();
  });

  it("waits no longer than a moment for the name, and keeps its words once begun", async () => {
    vi.mocked(useKleioRemote).mockReturnValue({ status: null, refresh: vi.fn() });
    const view = await open();
    await pass(NAME_WAIT_MS);
    expect(sub()).toBe("I'll take the busywork off your hands.");

    vi.mocked(useKleioRemote).mockReturnValue({
      status: remote("mac-mini.example.ts.net"),
      refresh: vi.fn(),
    });
    await act(async () => view.rerender(<OverviewPage onOpenTab={vi.fn()} />));
    expect(sub()).toBe("I'll take the busywork off your hands.");
  });

  it("doesn't come back on a second open", async () => {
    await open();
    await pass(WELCOME_MS);
    leave();
    await open();
    expect(welcome()).toBeNull();
    expect(headline()).toBe("Let's get Kleio ready.");
  });

  it("doesn't come back after being cut short", async () => {
    await open();
    await pass(500);
    leave();
    await open();
    expect(welcome()).toBeNull();
  });

  it("isn't for a device that had seen Setup; it is marked without a word", async () => {
    localStorage.setItem(SEEN, "1");
    await open();
    expect(welcome()).toBeNull();
    expect(headline()).toBe("Let's get Kleio ready.");
    expect(localStorage.getItem(WELCOMED_KEY)).toBe("1");
  });

  it("moves no focus, as it shows or as the list arrives", async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <>
          <button type="button">Back</button>
          <OverviewPage onOpenTab={vi.fn()} />
        </>,
      );
    });
    const back = view.getByRole("button", { name: "Back" });
    back.focus();
    await pass(WELCOME_MS / 2);
    expect(document.activeElement).toBe(back);
    await pass(WELCOME_MS);
    expect(welcome()).toBeNull();
    expect(document.activeElement).toBe(back);
  });

  it("lets the list rise in after it, only when motion is welcome", async () => {
    motion(true);
    await open();
    await pass(WELCOME_MS);
    expect(document.querySelector(".ov-page.is-arriving")).not.toBeNull();
    leave();

    localStorage.clear();
    motion(false);
    await open();
    expect(sub()).toBe("I'll live on mac-mini and take the busywork off your hands.");
    await pass(WELCOME_MS);
    expect(welcome()).toBeNull();
    expect(document.querySelector(".ov-page.is-arriving")).toBeNull();
  });

  it("records what a new device first sees, and says nothing of it", async () => {
    host({ models: true });
    await open();
    await pass(WELCOME_MS);
    expect(record()).toEqual({ host: "done", models: "done", voice: "todo", apps: "todo" });
    expect(lines()).toEqual([]);
  });
});

describe("Overview when a step is done", () => {
  it("has its region in the page, empty and taking no room, before anything is said", async () => {
    seen();
    await open();
    expect(region().getAttribute("role")).toBe("status");
    expect(region().textContent).toBe("");
    expect(region().classList.contains("has-room")).toBe(false);
  });

  it.each([
    ["models", { models: true }, "Kleio can think with you now."],
    ["voice", { voice: true }, "Kleio can hear you now."],
    ["apps", { apps: true }, "Kleio can work in your apps now."],
  ] as const)("says the %s line the first time it is seen done", async (step, done, words) => {
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host(done);
    await open();
    expect(lines()).toEqual([words]);
    expect(region().classList.contains("has-room")).toBe(true);
    expect(record()).toEqual({
      host: "done",
      models: "todo",
      voice: "todo",
      apps: "todo",
      [step]: "said",
    });
    expect(headline()).toBe("Let's get Kleio ready.");
  });

  it("says the host's line when a new device's host first answers, with its name or without", async () => {
    vi.mocked(useHostReach).mockReturnValue("disconnected");
    await open();
    await pass(WELCOME_MS);
    expect(record()).toEqual({ host: "todo", models: "todo" });
    leave();

    vi.mocked(useHostReach).mockReturnValue("connected");
    await open();
    expect(lines()).toEqual(["Kleio is home on mac-mini."]);
    leave();

    seen({ host: "todo" });
    vi.mocked(useKleioRemote).mockReturnValue({ status: remote(null), refresh: vi.fn() });
    await open();
    expect(lines()).toEqual(["Kleio is home."]);
  });

  it("fills the dot and the bar's segment once, only when motion is welcome", async () => {
    seen({ host: "done", models: "done", voice: "todo", apps: "todo" });
    host({ models: true, voice: true });
    motion(true);
    await open();
    expect(
      document.querySelector('.ov-row[data-row="voice"] .ov-dot.is-ok.is-fresh'),
    ).not.toBeNull();
    expect(document.querySelectorAll(".ov-dot.is-fresh")).toHaveLength(1);
    const segments = [...document.querySelectorAll(".ov-seg")];
    expect(segments.map((s) => s.classList.contains("is-fresh"))).toEqual([
      false,
      false,
      true,
      false,
    ]);
    leave();

    seen({ host: "done", models: "done", voice: "todo", apps: "todo" });
    motion(false);
    await open();
    expect(lines()).toEqual(["Kleio can hear you now."]);
    expect(document.querySelector(".is-fresh")).toBeNull();
  });

  it("shows the line at once, lets it stay, fades it and leaves the region empty", async () => {
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host({ models: true });
    motion(true);
    // jsdom lays nothing out: the line is 20 px tall here.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
    await open();
    await pass(LINE_MS - 100);
    expect(lines()).toEqual(["Kleio can think with you now."]);
    expect(region().classList.contains("is-leaving")).toBe(false);
    expect(region().style.minHeight).toBe("");
    await pass(100);
    // The words stay through the fade.
    expect(lines()).toEqual(["Kleio can think with you now."]);
    expect(region().classList.contains("is-leaving")).toBe(true);
    await pass(LINE_FADE_MS);
    expect(region().textContent).toBe("");
    expect(region().classList.contains("is-leaving")).toBe(false);
    // Its room is kept, so nothing jumps back.
    expect(region().classList.contains("has-room")).toBe(true);
    expect(region().style.minHeight).toBe("20px");
  });

  it("with reduced motion shows the line as long, then removes it without a fade", async () => {
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host({ models: true });
    motion(false);
    await open();
    await pass(LINE_MS - 100);
    expect(lines()).toEqual(["Kleio can think with you now."]);
    await pass(100);
    expect(region().textContent).toBe("");
    expect(region().classList.contains("is-leaving")).toBe(false);
  });

  it("never says it again", async () => {
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host({ models: true });
    await open();
    expect(lines()).toHaveLength(1);
    leave();
    await open();
    expect(lines()).toEqual([]);
    expect(region().classList.contains("has-room")).toBe(false);
  });

  it("says nothing when a key is removed and added back", async () => {
    seen({ host: "done", models: "done", voice: "said", apps: "todo" });
    host({ models: true, voice: false });
    await open();
    leave();
    host({ models: true, voice: true });
    await open();
    expect(lines()).toEqual([]);
    expect(record()).toEqual({ host: "done", models: "done", voice: "said", apps: "todo" });
  });

  it("says it on the next open when the step was done on its own tab, however late", async () => {
    seen();
    await open();
    expect(record()).toEqual({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    leave();

    host({ voice: true });
    await pass(86_400_000);
    await open();
    expect(lines()).toEqual(["Kleio can hear you now."]);
  });

  it("says it on the re-read when the step was done elsewhere while Overview was open", async () => {
    seen();
    await open();
    expect(lines()).toEqual([]);

    host({ voice: true });
    await pass(REREAD_MS);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(lines()).toEqual(["Kleio can hear you now."]);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("2 of 4 ready");
  });

  it("says two at once in setup order, and keeps them longer", async () => {
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host({ models: true, voice: true });
    motion(true);
    await open();
    expect(lines()).toEqual(["Kleio can think with you now.", "Kleio can hear you now."]);
    expect(document.querySelectorAll(".ov-dot.is-fresh")).toHaveLength(2);
    expect(document.querySelectorAll(".ov-seg.is-fresh")).toHaveLength(2);
    await pass(LINE_MS + LINE_MORE_MS - 100);
    expect(region().classList.contains("is-leaving")).toBe(false);
    await pass(100);
    expect(region().classList.contains("is-leaving")).toBe(true);
    await pass(LINE_FADE_MS);
    expect(region().textContent).toBe("");
  });

  it("says nothing for a step first seen already done", async () => {
    seen();
    host({ models: true });
    await open();
    expect(lines()).toEqual([]);
    expect(record()).toEqual({ host: "done", models: "done", voice: "todo", apps: "todo" });
  });

  it("says nothing when a host that was offline at the first read comes back", async () => {
    seen();
    host(ALL);
    vi.mocked(useHostReach).mockReturnValue("disconnected");
    await open();
    expect(record()).toEqual({ models: "done" });
    leave();

    vi.mocked(useHostReach).mockReturnValue("connected");
    await open();
    expect(lines()).toEqual([]);
    expect(headline()).toBe("Good evening.");
    expect(record()).toEqual({ host: "done", models: "done", voice: "done", apps: "done" });
  });

  it("still says it while something else needs a look", async () => {
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host({ models: true });
    vi.mocked(listMcpServers).mockResolvedValue([
      { name: "github", scope: "global", ok: false, toolCount: 0, kind: "stdio", summary: "npx x" },
    ]);
    await open();
    expect(headline()).toBe("One of your tools needs a look.");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(lines()).toEqual(["Kleio can think with you now."]);
  });

  it("leaves no note for another page", async () => {
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host({ models: true });
    await open();
    expect(takeSettingsIntent()).toBeNull();
  });
});

describe("Overview's finish", () => {
  const ALL_BUT_APPS = { host: "done", models: "done", voice: "done", apps: "todo" };

  it("says Kleio's ready with the last step: the full bar, no hero, no filled button", async () => {
    seen(ALL_BUT_APPS);
    host(ALL);
    await open();
    expect(headline()).toBe("Kleio's ready.");
    expect(sub()).toBe("Ask me anything. The extras below can wait.");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("4 of 4 ready");
    expect(document.querySelectorAll(".ov-seg.is-done")).toHaveLength(4);
    expect(document.querySelector(".ov-hero")).toBeNull();
    expect(document.querySelector(".btn-primary")).toBeNull();
    expect(lines()).toEqual(["Kleio can work in your apps now."]);
    expect(overviewKeys()).toEqual({
      [FINISHED_KEY]: "1",
      [STEPS_KEY]: JSON.stringify({ ...ALL_BUT_APPS, apps: "said" }),
      [WELCOMED_KEY]: "1",
    });
  });

  it("says the headline to a screen reader too, once, in the line's region", async () => {
    seen(ALL_BUT_APPS);
    host(ALL);
    await open();
    const said = region().querySelector(".sr-only");
    expect(said?.textContent).toBe("Kleio's ready.");
    await pass(LINE_MS);
    expect(region().textContent).toBe("");
    // The headline itself stays for the visit.
    expect(headline()).toBe("Kleio's ready.");
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("asks nothing to wait when no extra is left, and holds the memory back", async () => {
    seen(ALL_BUT_APPS);
    host(ALL);
    noExtras();
    await open();
    expect(headline()).toBe("Kleio's ready.");
    expect(sub()).toBe("Ask me anything.");
    expect(document.querySelector(".ov-memory")).toBeNull();
  });

  it("moves nothing of its own: only the last step's dot and segment are fresh", async () => {
    seen(ALL_BUT_APPS);
    host(ALL);
    motion(true);
    await open();
    expect(document.querySelectorAll(".ov-dot.is-fresh")).toHaveLength(1);
    expect(document.querySelectorAll(".ov-seg.is-fresh")).toHaveLength(1);
    expect(document.querySelector(".ov-page.is-arriving")).toBeNull();
  });

  it("gives way to the greeting on the next open", async () => {
    seen(ALL_BUT_APPS);
    host(ALL);
    noExtras();
    await open();
    leave();
    await open();
    expect(headline()).toBe("Good evening.");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(lines()).toEqual([]);
    expect(document.querySelector(".ov-memory")).not.toBeNull();
  });

  it("is never shown to someone already set up; the flag is set without a word", async () => {
    localStorage.setItem(SEEN, "1");
    host(ALL);
    await open();
    expect(welcome()).toBeNull();
    expect(headline()).toBe("Good evening.");
    expect(lines()).toEqual([]);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(overviewKeys()).toEqual({
      [FINISHED_KEY]: "1",
      [STEPS_KEY]: JSON.stringify({ host: "done", models: "done", voice: "done", apps: "done" }),
      [WELCOMED_KEY]: "1",
    });
  });

  it("waits, unspent, while something needs a look, and is shown once that clears", async () => {
    seen(ALL_BUT_APPS);
    host(ALL);
    vi.mocked(listMcpServers).mockResolvedValue([
      { name: "github", scope: "global", ok: false, toolCount: 0, kind: "stdio", summary: "npx x" },
    ]);
    await open();
    expect(headline()).toBe("One of your tools needs a look.");
    expect(lines()).toEqual(["Kleio can work in your apps now."]);
    expect(localStorage.getItem(FINISHED_KEY)).toBeNull();
    leave();

    vi.mocked(listMcpServers).mockResolvedValue([]);
    await open();
    expect(headline()).toBe("Kleio's ready.");
    expect(lines()).toEqual([]);
    expect(region().querySelector(".sr-only")?.textContent).toBe("Kleio's ready.");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("4 of 4 ready");
    expect(localStorage.getItem(FINISHED_KEY)).toBe("1");
  });

  it("gives the headline back to a fault that arrives during the visit", async () => {
    seen(ALL_BUT_APPS);
    host(ALL);
    await open();
    expect(headline()).toBe("Kleio's ready.");

    vi.mocked(listMcpServers).mockResolvedValue([
      { name: "github", scope: "global", ok: false, toolCount: 0, kind: "stdio", summary: "npx x" },
    ]);
    await pass(REREAD_MS);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(headline()).toBe("One of your tools needs a look.");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("is earned by someone half-way: a line for each step from now on, then the finish", async () => {
    // Set up before 8f: Setup seen, nothing of Overview's kept.
    localStorage.setItem(SEEN, "1");
    host({ models: true });
    await open();
    expect(welcome()).toBeNull();
    expect(lines()).toEqual([]);
    leave();

    host({ models: true, voice: true });
    await open();
    expect(lines()).toEqual(["Kleio can hear you now."]);
    expect(headline()).toBe("Let's get Kleio ready.");
    leave();

    host(ALL);
    await open();
    expect(lines()).toEqual(["Kleio can work in your apps now."]);
    expect(headline()).toBe("Kleio's ready.");
  });
});

describe("Overview's moments where nothing can be stored", () => {
  it("welcomes nobody when the store can't be read, and still says each step once a visit", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await open();
    expect(welcome()).toBeNull();
    expect(headline()).toBe("Let's get Kleio ready.");
    leave();

    host(ALL);
    await open();
    expect(lines()).toEqual([
      "Kleio can think with you now.",
      "Kleio can hear you now.",
      "Kleio can work in your apps now.",
    ]);
    expect(headline()).toBe("Kleio's ready.");
    leave();

    await open();
    expect(lines()).toEqual([]);
    expect(headline()).toBe("Good evening.");
  });

  it("plays each moment once a visit when the store won't write, and again after a restart", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await open();
    expect(welcome()).not.toBeNull();
    await pass(WELCOME_MS);
    leave();

    host({ models: true });
    await open();
    expect(welcome()).toBeNull();
    expect(lines()).toEqual(["Kleio can think with you now."]);
    leave();
    await open();
    expect(lines()).toEqual([]);
    leave();

    forgetSeen();
    await open();
    expect(welcome()).not.toBeNull();
  });

  it("welcomes nobody where there is no store at all", async () => {
    vi.stubGlobal("localStorage", undefined);
    await open();
    expect(welcome()).toBeNull();
    leave();
    host({ models: true });
    await open();
    expect(lines()).toEqual(["Kleio can think with you now."]);
  });
});

describe("Overview's moments when it is left", () => {
  /** Whether every timer set for `ms` has been cleared (and at least one was set). */
  function watchTimers(): (ms: number) => boolean {
    const set = vi.spyOn(window, "setTimeout");
    const cleared = vi.spyOn(window, "clearTimeout");
    return (ms) => {
      const ids = set.mock.calls.flatMap((call, i) =>
        call[1] === ms ? [set.mock.results[i]?.value as unknown] : [],
      );
      return ids.length > 0 && ids.every((id) => cleared.mock.calls.some((call) => call[0] === id));
    };
  }

  it("clears the welcome's timers: the wait for a name, and the hold", async () => {
    const cleared = watchTimers();
    vi.mocked(useKleioRemote).mockReturnValue({ status: null, refresh: vi.fn() });
    await open();
    expect(cleared(NAME_WAIT_MS)).toBe(false);
    leave();
    expect(cleared(NAME_WAIT_MS)).toBe(true);
    await pass(NAME_WAIT_MS + WELCOME_MS);

    vi.mocked(useKleioRemote).mockReturnValue({
      status: remote("mac-mini.example.ts.net"),
      refresh: vi.fn(),
    });
    localStorage.clear();
    const again = watchTimers();
    await open();
    expect(welcome()).not.toBeNull();
    expect(again(WELCOME_MS)).toBe(false);
    leave();
    expect(again(WELCOME_MS)).toBe(true);
  });

  it("clears the line's timers, in its stay and in its fade", async () => {
    const cleared = watchTimers();
    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    host({ models: true });
    motion(true);
    await open();
    expect(cleared(LINE_MS)).toBe(false);
    leave();
    expect(cleared(LINE_MS)).toBe(true);

    seen({ host: "done", models: "todo", voice: "todo", apps: "todo" });
    await open();
    await pass(LINE_MS);
    expect(region().classList.contains("is-leaving")).toBe(true);
    expect(cleared(LINE_FADE_MS)).toBe(false);
    leave();
    expect(cleared(LINE_FADE_MS)).toBe(true);
  });
});
