// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  authStatusWithError,
  getLocalModels,
  listMcpServers,
  listMemories,
  type McpServerRow,
  type Memory,
} from "../agent";
import { askHostKind, rememberedHostKind, useHostReach, useHostReachWords } from "./hostReach";
import {
  getDictationSetup,
  getSetupStatus,
  getVoiceStatus,
  KleioApiError,
  listConnections,
  type Connection,
  type HostKind,
  type SetupStatus,
  type VoiceStatus,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import type { Diagnosis } from "./connectionDiagnosis";
import { OverviewPage, REREAD_MS, SETTLE_MS } from "./OverviewPage";
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
    // The real error type and wording; only the calls to the host are fakes.
    KleioApiError: actual.KleioApiError,
    errorText: actual.errorText,
    getVoiceStatus: vi.fn(),
    getSetupStatus: vi.fn(),
    listConnections: vi.fn(),
    getDictationSetup: vi.fn(),
  };
});

function setup(keys: Partial<SetupStatus["keys"]> = {}, admin = true): SetupStatus {
  return { admin, keys: { openai: "saved", composio: "saved", typesafe: "missing", ...keys } };
}
function voice(ready: boolean): VoiceStatus {
  return { ready, voice: "marin", model: "gpt-live", voices: ["marin", "cedar"], speed: 1 };
}
function provider(connected: boolean) {
  return {
    value: "anthropic",
    label: "Anthropic",
    description: "",
    methods: [],
    connected,
    connectedMethods: [],
  };
}
function app(name: string, status = "ACTIVE"): Connection {
  return {
    id: name,
    toolkit: name.toLowerCase(),
    name,
    logo: null,
    status,
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}
function server(name: string, patch: Partial<McpServerRow> = {}): McpServerRow {
  return {
    name,
    scope: "global",
    ok: true,
    toolCount: 4,
    kind: "stdio",
    summary: "npx x",
    ...patch,
  };
}
function memory(
  id: string,
  text: string,
  updatedAt: string,
  category: Memory["category"] = "other",
): Memory {
  return { id, text, category, importance: 3, createdAt: updatedAt, updatedAt };
}
/** A Mac mini set never to sleep. */
const MINI_ON: HostKind = { os: "darwin", laptop: false, alwaysOn: { state: "yes", reasons: [] } };

/** Everything set up and working. */
beforeEach(() => {
  localStorage.clear();
  // Not a new device: no welcome (OverviewPage.moments.test.tsx has the moments).
  localStorage.setItem("kleio.overview.welcomed", "1");
  vi.spyOn(Date.prototype, "getHours").mockReturnValue(20);
  vi.mocked(useHostReach).mockReturnValue("connected");
  vi.mocked(useHostReachWords).mockReturnValue(null);
  vi.mocked(askHostKind).mockResolvedValue(MINI_ON);
  vi.mocked(rememberedHostKind).mockReturnValue(null);
  vi.mocked(useKleioRemote).mockReturnValue({
    status: {
      active: {
        base: "https://mac-mini.example.ts.net:8443",
        host: "mac-mini.example.ts.net",
        deviceId: "d1",
        label: "Laptop",
        admin: true,
      },
      paired: null,
    },
    refresh: vi.fn(async () => undefined),
  });
  vi.mocked(authStatusWithError).mockResolvedValue({ providers: [provider(true)], error: null });
  vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
  vi.mocked(getVoiceStatus).mockResolvedValue(voice(true));
  vi.mocked(getSetupStatus).mockResolvedValue(setup());
  vi.mocked(listConnections).mockResolvedValue({
    configured: true,
    connections: [app("Gmail"), app("Notion")],
  });
  vi.mocked(getDictationSetup).mockResolvedValue({ state: "ready", bytes: 138_853_314 });
  vi.mocked(listMemories).mockResolvedValue({
    softLimit: 60,
    hardLimit: 90,
    memories: [
      memory("a", "Prefers short replies.", "2026-10-01T09:00:00.000Z", "preference"),
      memory("b", "Lives in Edinburgh.", "2026-11-19T09:00:00.000Z", "identity"),
    ],
  });
  vi.mocked(listMcpServers).mockResolvedValue([server("github"), server("linear")]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function renderPage(onOpenTab = vi.fn()): Promise<typeof onOpenTab> {
  await act(async () => {
    render(<OverviewPage onOpenTab={onOpenTab} />);
  });
  return onOpenTab;
}
/** First run: paired and connected, nothing else done. */
function firstRun(): void {
  vi.mocked(authStatusWithError).mockResolvedValue({ providers: [provider(false)], error: null });
  vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
  vi.mocked(getSetupStatus).mockResolvedValue(setup({ openai: "missing", composio: "missing" }));
  vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
  vi.mocked(getDictationSetup).mockResolvedValue({ state: "absent", bytes: 138_853_314 });
  vi.mocked(listMemories).mockResolvedValue({ softLimit: 60, hardLimit: 90, memories: [] });
  vi.mocked(listMcpServers).mockResolvedValue([]);
}

const row = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`.ov-row[data-row="${id}"]`);
  if (!el) throw new Error(`no ${id} row`);
  return el;
};
const benefit = (id: string): string => row(id).querySelector(".ov-benefit")?.textContent ?? "";
const status = (id: string): string => row(id).querySelector(".ov-status")?.textContent ?? "";
const mark = (id: string): string =>
  [...(row(id).querySelector(".ov-dot")?.classList ?? [])].find((c) => c.startsWith("is-")) ?? "";
const headline = (): string => screen.getByRole("heading", { level: 2 }).textContent ?? "";
const sub = (): string | null => document.querySelector(".ov-sub")?.textContent ?? null;
const filled = (): Element[] => [...document.querySelectorAll(".btn-primary")];

describe("OverviewPage", () => {
  it("marks Setup as seen on this device", async () => {
    await renderPage();
    expect(localStorage.getItem("kleio-setup-seen")).toBe("1");
  });

  it("greets you when everything runs: every row a link, the memory, and no buttons", async () => {
    const onOpenTab = await renderPage();
    expect(headline()).toBe("Good evening.");
    expect(sub()).toBe("I'm on mac-mini, and everything's running.");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();

    const rows = within(screen.getByRole("list", { name: "Areas" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-row"))).toEqual([
      "host",
      "models",
      "voice",
      "apps",
      "tools",
      "dictation",
      "brain",
    ]);
    for (const r of rows) expect(within(r).getAllByRole("link")).toHaveLength(1);
    expect(benefit("host")).toBe("Lives on mac-mini, always on");
    expect(status("host")).toBe("Connected");
    expect(status("models")).toBe("Anthropic");
    expect(status("voice")).toBe("Ready, in Marin's voice");
    expect(status("apps")).toBe("Gmail and Notion");
    expect(status("tools")).toBe("2 servers, 8 tools");
    expect(status("dictation")).toBe("Ready, on mac-mini");
    expect(status("brain")).toBe("2 memories, shared by every device");

    fireEvent.click(
      screen.getByRole("link", {
        name: "Models: Thinks with the models you choose. Anthropic. Open Models.",
      }),
    );
    expect(onOpenTab).toHaveBeenCalledWith("providers");
  });

  it("says morning, afternoon and evening by the clock", async () => {
    for (const [hour, words] of [
      [3, "Good evening."],
      [9, "Good morning."],
      [14, "Good afternoon."],
      [22, "Good evening."],
    ] as const) {
      vi.mocked(Date.prototype.getHours).mockReturnValue(hour);
      await renderPage();
      expect(headline()).toBe(words);
      cleanup();
    }
  });

  it("quotes the newest memory, which opens Kleio", async () => {
    const onOpenTab = await renderPage();
    const link = screen.getByRole("link", { name: /I remember 2 things about you/ });
    expect(within(link).getByText("“Lives in Edinburgh.”")).toBeTruthy();
    fireEvent.click(link);
    expect(onOpenTab).toHaveBeenCalledWith("kleio");
  });

  it("never quotes a health or relationship memory", async () => {
    vi.mocked(listMemories).mockResolvedValue({
      softLimit: 60,
      hardLimit: 90,
      memories: [
        memory("h", "Takes a tablet each morning.", "2026-11-19T10:00:00.000Z", "health"),
        memory("r", "Is seeing someone new.", "2026-11-19T09:00:00.000Z", "relationship"),
        memory("p", "Prefers short replies.", "2026-10-01T09:00:00.000Z", "preference"),
      ],
    });
    await renderPage();
    const link = screen.getByRole("link", { name: /I remember 3 things about you/ });
    expect(within(link).getByText("“Prefers short replies.”")).toBeTruthy();
    expect(document.body.textContent).not.toContain("tablet");
    expect(document.body.textContent).not.toContain("seeing someone");
  });

  it("quotes nothing when every memory is private, and still counts them", async () => {
    vi.mocked(listMemories).mockResolvedValue({
      softLimit: 60,
      hardLimit: 90,
      memories: [memory("h", "Takes a tablet each morning.", "2026-11-19T10:00:00.000Z", "health")],
    });
    await renderPage();
    expect(document.querySelector(".ov-memory")).toBeNull();
    expect(status("brain")).toBe("1 memory, shared by every device");
    expect(document.body.textContent).not.toContain("tablet");
  });

  it("uses no name in any headline", async () => {
    await renderPage();
    expect(headline()).toBe("Good evening.");
    cleanup();

    vi.mocked(useHostReach).mockReturnValue("disconnected");
    await renderPage();
    expect(headline()).toBe("mac-mini isn't answering.");
    cleanup();

    vi.mocked(useHostReach).mockReturnValue("connected");
    vi.mocked(listMcpServers).mockResolvedValue([
      server("github", { ok: false, error: "spawn ENOENT" }),
      server("linear", { ok: false, error: "exited" }),
    ]);
    await renderPage();
    expect(headline()).toBe("2 of your tools need a look.");
    cleanup();

    firstRun();
    await renderPage();
    expect(headline()).toBe("Let's get Kleio ready.");
  });
});

describe("OverviewPage's first run", () => {
  beforeEach(firstRun);

  it("counts the four needed steps, without the optional ones", async () => {
    await renderPage();
    const bar = screen.getByRole("progressbar", { name: "Setup" });
    // The host is connected; a model, the voice and Apps are not set up.
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("4");
    expect(bar.getAttribute("aria-valuetext")).toBe("1 of 4 ready");
    expect(bar.querySelectorAll(".ov-seg")).toHaveLength(4);
    expect(bar.querySelectorAll(".ov-seg.is-done")).toHaveLength(1);
    // In words for a screen reader only; the bar says it to the eye.
    expect(screen.queryByText(/of 4/)).toBeNull();
    expect(sub()).toBeNull();
  });

  it("counts on as steps are done, and drops the bar after the last", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({ providers: [provider(true)], error: null });
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(true));
    await renderPage();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("3 of 4 ready");
    expect(screen.getByRole("button", { name: "Add Composio key" })).toBeTruthy();
    cleanup();

    // Dictation, Brain and Tools are still not set up: they don't count.
    vi.mocked(getSetupStatus).mockResolvedValue(setup());
    vi.mocked(listConnections).mockResolvedValue({ configured: true, connections: [] });
    await renderPage();
    // The last step, seen done for the first time: the finish, under a full bar.
    expect(headline()).toBe("Kleio's ready.");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("4 of 4 ready");
    cleanup();

    await renderPage();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(headline()).toBe("Good evening.");
    expect(status("apps")).toBe("Ready, no apps added yet");
    expect(mark("dictation")).toBe("is-optional");
  });

  it("makes the next step a hero with the page's one filled button, not repeated below", async () => {
    const onOpenTab = await renderPage();
    const hero = screen.getByRole("region", { name: "Thinks with the models you choose" });
    expect(
      within(hero).getByText(
        "Connect Anthropic, OpenAI or another provider, and Kleio can think alongside you.",
      ),
    ).toBeTruthy();
    const cta = within(hero).getByRole("button", { name: "Connect a model" });
    expect(filled()).toEqual([cta]);
    expect(document.querySelector('.ov-row[data-row="models"]')).toBeNull();

    fireEvent.click(cta);
    expect(onOpenTab).toHaveBeenCalledWith("providers");
  });

  it("offers the other steps as quiet Set up links to their tabs", async () => {
    const onOpenTab = await renderPage();
    expect(status("voice")).toBe("Needs an OpenAI key");
    expect(status("apps")).toBe("Needs a Composio key");
    expect(mark("voice")).toBe("is-unset");
    expect(status("tools")).toBe("Optional · add your own MCP servers");
    expect(status("dictation")).toBe("Optional · runs privately on mac-mini");
    expect(status("brain")).toBe("Optional · introduce yourself");

    const voiceSetUp = screen.getByRole("button", { name: "Set up Voice" });
    expect(voiceSetUp.classList.contains("btn")).toBe(false);
    fireEvent.click(voiceSetUp);
    expect(onOpenTab).toHaveBeenLastCalledWith("kleio");
    fireEvent.click(screen.getByRole("button", { name: "Set up Apps" }));
    expect(onOpenTab).toHaveBeenLastCalledWith("apps");
    fireEvent.click(screen.getByRole("button", { name: "Set up Tools" }));
    expect(onOpenTab).toHaveBeenLastCalledWith("mcp");
    // The host is fine, so its row is only a link.
    expect(within(row("host")).queryByRole("button")).toBeNull();
  });

  it("moves the hero to the voice, then Apps, as each step is done", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({ providers: [provider(true)], error: null });
    const onOpenTab = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add OpenAI key" }));
    expect(onOpenTab).toHaveBeenLastCalledWith("kleio");
    cleanup();

    vi.mocked(getVoiceStatus).mockResolvedValue(voice(true));
    const again = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Composio key" }));
    expect(again).toHaveBeenLastCalledWith("apps");
  });

  it("counts a private model that's running as a model", async () => {
    vi.mocked(getLocalModels).mockResolvedValue({
      endpoints: [
        {
          id: "ollama",
          label: "Ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          kind: "ollama",
          custom: false,
          reachable: true,
          models: [
            {
              id: "local/ollama/qwen3",
              rawId: "qwen3",
              contextWindow: 32_768,
              contextWindowKnown: true,
              supportsTools: true,
              supportsImages: false,
              supportsThinking: false,
            },
          ],
        },
      ],
    });
    await renderPage();
    expect(status("models")).toBe("Ollama");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
  });

  it("counts a key the host set itself as done", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({ providers: [provider(true)], error: null });
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(true));
    vi.mocked(getSetupStatus).mockResolvedValue(setup({ composio: "env" }));
    vi.mocked(listConnections).mockResolvedValue({ configured: true, connections: [] });
    await renderPage();
    expect(mark("apps")).toBe("is-ok");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(headline()).toBe("Good evening.");
  });

  it("gives a device that isn't the admin the note, and no way to add a key", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({ providers: [provider(true)], error: null });
    vi.mocked(getSetupStatus).mockResolvedValue(
      setup({ openai: "missing", composio: "missing" }, false),
    );
    await renderPage();
    expect(screen.getByRole("note").textContent).toBe(
      "This device shows what's done. Only your admin device can add or change keys.",
    );
    expect(headline()).toBe("Let's get Kleio ready.");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("2 of 4 ready");
    expect(status("voice")).toBe("Needs an OpenAI key, from your admin device");
    expect(status("apps")).toBe("Needs a Composio key, from your admin device");
    // No hero and no Set up for a key this device can't add.
    expect(screen.queryByRole("button", { name: /key/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up Voice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up Apps" })).toBeNull();
    expect(filled()).toEqual([]);
    // What any device can do is still offered.
    expect(screen.getByRole("button", { name: "Set up Dictation" })).toBeTruthy();
  });

  it("still gives a device that isn't the admin the step it can take", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(
      setup({ openai: "missing", composio: "missing" }, false),
    );
    await renderPage();
    expect(filled()).toEqual([screen.getByRole("button", { name: "Connect a model" })]);
  });

  it("has no note on the admin device", async () => {
    await renderPage();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("OverviewPage's host", () => {
  it("says checking, and nothing else, until the host answers", async () => {
    vi.mocked(useHostReach).mockReturnValue("checking");
    await renderPage();
    // Kleio doesn't speak until every answer is in.
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(document.querySelector(".ov-row")).toBeNull();
  });

  it("shows the rows, still without a headline, once it has waited long enough", async () => {
    vi.useFakeTimers();
    vi.mocked(useHostReach).mockReturnValue("checking");
    await renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    });
    expect(status("host")).toBe("Checking…");
    expect(mark("host")).toBe("is-checking");
    expect(status("models")).toBe("Anthropic");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(document.querySelector(".ov-page")?.getAttribute("aria-busy")).toBe("true");
    expect(filled()).toEqual([]);
  });

  it("says the host isn't answering: one Fix, to Connection, and the rest wait", async () => {
    vi.mocked(useHostReach).mockReturnValue("disconnected");
    const onOpenTab = await renderPage();
    expect(headline()).toBe("mac-mini isn't answering.");
    expect(sub()).toBe("I'll keep trying in the background. Fix shows what to check.");
    expect(benefit("host")).toBe("Lives on mac-mini");
    expect(status("host")).toBe("Can't reach it right now");
    expect(mark("host")).toBe("is-fault");
    for (const id of ["voice", "apps", "dictation"]) {
      expect(status(id)).toBe("Waiting for mac-mini");
      expect(mark(id)).toBe("is-waiting");
      expect(within(row(id)).queryByRole("button")).toBeNull();
    }
    expect(document.querySelector(".ov-memory")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();

    const fix = screen.getByRole("button", { name: "Fix Host" });
    expect(screen.getAllByRole("button", { name: /^Fix/ })).toEqual([fix]);
    expect(filled()).toEqual([fix]);
    fireEvent.click(fix);
    expect(onOpenTab).toHaveBeenCalledWith("connection");
  });

  it("says why in the link's own words when Kleio's link knows", async () => {
    vi.mocked(useHostReach).mockReturnValue("disconnected");
    vi.mocked(useHostReachWords).mockReturnValue({
      tone: "bad",
      badge: "Asleep",
      headline: "mac-mini is asleep or off.",
      detail: "Wake it, then try again.",
      checks: [],
      fix: [],
    } as unknown as Diagnosis);
    await renderPage();
    expect(status("host")).toBe("mac-mini is asleep or off");
  });

  it("names the paired host while it runs locally, and a host it can't name", async () => {
    vi.mocked(useKleioRemote).mockReturnValue({
      status: {
        active: null,
        paired: {
          baseUrl: "https://studio.example.ts.net:8443",
          host: "studio.example.ts.net",
          deviceId: "d1",
          label: "Laptop",
          admin: true,
          pairedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      refresh: vi.fn(async () => undefined),
    });
    await renderPage();
    expect(sub()).toBe("I'm on studio, and everything's running.");
    cleanup();

    vi.mocked(useKleioRemote).mockReturnValue({
      status: { active: null, paired: null },
      refresh: vi.fn(async () => undefined),
    });
    await renderPage();
    expect(benefit("host")).toBe("Lives on your host, always on");
  });
});

describe("OverviewPage's Always on line", () => {
  const sleeps: HostKind = {
    os: "darwin",
    laptop: false,
    alwaysOn: { state: "may_sleep", reasons: ["sleeps_on_ac"] },
  };

  it("calls the host always on only when it says it stays on", async () => {
    await renderPage();
    expect(benefit("host")).toBe("Lives on mac-mini, always on");
    expect(status("host")).toBe("Connected");
    expect(within(row("host")).queryByRole("button")).toBeNull();
  });

  it("says a host may fall asleep as advice: Keep it on, and nothing else changes", async () => {
    vi.mocked(askHostKind).mockResolvedValue(sleeps);
    const onOpenTab = await renderPage();
    expect(benefit("host")).toBe("Lives on mac-mini");
    expect(status("host")).toBe("Connected · may fall asleep");
    // Advice, not a fault: the mark, the headline and the row's link stay as they were.
    expect(mark("host")).toBe("is-ok");
    expect(headline()).toBe("Good evening.");
    expect(within(row("host")).getAllByRole("link")).toHaveLength(1);
    expect(filled()).toEqual([]);

    const keep = screen.getByRole("button", { name: "Keep it on" });
    expect(keep.classList.contains("btn")).toBe(false);
    fireEvent.click(keep);
    expect(onOpenTab).toHaveBeenCalledWith("connection");
  });

  it("says when a laptop works", async () => {
    vi.mocked(askHostKind).mockResolvedValue({
      os: "darwin",
      laptop: true,
      alwaysOn: { state: "laptop", reasons: [] },
    });
    await renderPage();
    expect(benefit("host")).toBe("Lives on mac-mini");
    expect(status("host")).toBe("Connected · works while mac-mini is open and awake");
    expect(within(row("host")).queryByRole("button")).toBeNull();
  });

  it("says it couldn't check, for a host that can't say", async () => {
    vi.mocked(askHostKind).mockResolvedValue({
      os: "linux",
      laptop: false,
      alwaysOn: { state: "unknown", reasons: ["check_failed"] },
    });
    await renderPage();
    expect(status("host")).toBe("Connected · couldn't check whether it stays on");
    expect(mark("host")).toBe("is-ok");
  });

  it("says only Connected while it is still asking", async () => {
    vi.mocked(askHostKind).mockReturnValue(new Promise(() => undefined));
    await renderPage();
    expect(benefit("host")).toBe("Lives on mac-mini");
    expect(status("host")).toBe("Connected");
    expect(headline()).toBe("Good evening.");
  });

  it("uses what the host last said when it can't be asked", async () => {
    vi.mocked(askHostKind).mockResolvedValue(null);
    vi.mocked(rememberedHostKind).mockReturnValue(sleeps);
    await renderPage();
    expect(status("host")).toBe("Connected · may fall asleep");
    cleanup();

    // Never asked and nothing kept: it couldn't check.
    vi.mocked(rememberedHostKind).mockReturnValue(null);
    await renderPage();
    expect(status("host")).toBe("Connected · couldn't check whether it stays on");
  });
});

describe("OverviewPage when something needs a look", () => {
  it("has no all-clear when a tool fails: one Fix, which opens Tools", async () => {
    vi.mocked(listMcpServers).mockResolvedValue([
      server("github"),
      server("linear", { ok: false, toolCount: 0, error: "spawn ENOENT" }),
    ]);
    const onOpenTab = await renderPage();
    expect(headline()).toBe("One of your tools needs a look.");
    expect(sub()).toBe("Everything else is running on mac-mini.");
    expect(document.body.textContent).not.toContain("everything's running");
    expect(status("tools")).toBe("linear isn't working");
    expect(mark("tools")).toBe("is-fault");
    expect(document.querySelector(".ov-memory")).toBeNull();

    const fix = screen.getByRole("button", { name: "Fix Tools" });
    expect(screen.getAllByRole("button")).toEqual([fix]);
    expect(filled()).toEqual([fix]);
    fireEvent.click(fix);
    expect(onOpenTab).toHaveBeenCalledWith("mcp");
  });

  it("marks a tool that needs signing in again as waiting on you, not broken", async () => {
    vi.mocked(listMcpServers).mockResolvedValue([
      server("github"),
      server("linear", { ok: false, toolCount: 0, requiresAuth: true }),
    ]);
    await renderPage();
    expect(headline()).toBe("One of your tools needs a look.");
    expect(status("tools")).toBe("linear needs signing in again");
    expect(mark("tools")).toBe("is-signin");
    expect(screen.getByRole("button", { name: "Fix Tools" })).toBeTruthy();
  });

  it("names every tool the headline counts, broken or signed out", async () => {
    vi.mocked(listMcpServers).mockResolvedValue([
      server("github"),
      server("notion", { ok: false, toolCount: 0, requiresAuth: true }),
      server("airtable", { ok: false, toolCount: 0, error: "exited with code 1" }),
    ]);
    await renderPage();
    expect(headline()).toBe("2 of your tools need a look.");
    expect(status("tools")).toBe("airtable isn't working · notion needs signing in again");
    // A fault outranks a sign-in for the mark.
    expect(mark("tools")).toBe("is-fault");
  });

  it("names the apps that need signing in again", async () => {
    vi.mocked(listConnections).mockResolvedValue({
      configured: true,
      connections: [app("Gmail", "EXPIRED"), app("Notion", "FAILED"), app("Slack")],
    });
    const onOpenTab = await renderPage();
    expect(headline()).toBe("Apps needs a look.");
    expect(status("apps")).toBe("Gmail and Notion need signing in again");
    expect(mark("apps")).toBe("is-signin");
    fireEvent.click(screen.getByRole("button", { name: "Fix Apps" }));
    expect(onOpenTab).toHaveBeenCalledWith("apps");
  });

  it("fills only the first Fix when two rows need one", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({ providers: [], error: "not answering" });
    vi.mocked(getDictationSetup).mockResolvedValue({
      state: "failed",
      reason: "offline",
      bytes: 138_853_314,
    });
    await renderPage();
    expect(status("models")).toBe("Couldn't read your AI providers");
    expect(status("dictation")).toBe("The download didn't finish");
    const first = screen.getByRole("button", { name: "Fix Models" });
    const second = screen.getByRole("button", { name: "Fix Dictation" });
    expect(filled()).toEqual([first]);
    expect(second.classList.contains("btn-ghost")).toBe(true);
    expect(headline()).toBe("Models needs a look.");
  });

  it("offers a needed step as a plain Set up while something else needs fixing", async () => {
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
    vi.mocked(listMcpServers).mockResolvedValue([server("linear", { ok: false })]);
    await renderPage();
    const setUp = screen.getByRole("button", { name: "Set up Voice" });
    expect(setUp.classList.contains("btn-ghost")).toBe(true);
    expect(filled()).toEqual([screen.getByRole("button", { name: "Fix Tools" })]);
    // The fault comes first: no hero and no progress bar.
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.querySelector(".ov-hero")).toBeNull();
  });

  it("keeps a download in progress from holding the page back", async () => {
    vi.mocked(getDictationSetup).mockResolvedValue({
      state: "downloading",
      loaded: 10_000_000,
      bytes: 138_853_314,
    });
    await renderPage();
    expect(headline()).toBe("Good evening.");
    expect(status("dictation")).toBe("Downloading…");
  });
});

// What Connection opens on is left as a one-shot note (settingsIntent.ts).
describe("OverviewPage's notes for Connection", () => {
  beforeEach(() => {
    takeSettingsIntent();
  });

  it("Fix on the Host row asks Connection for its steps", async () => {
    vi.mocked(useHostReach).mockReturnValue("disconnected");
    const onOpenTab = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Fix Host" }));
    expect(onOpenTab).toHaveBeenCalledWith("connection");
    expect(takeSettingsIntent()).toBe("connection-fix");
  });

  it("Keep it on asks Connection for Always on", async () => {
    vi.mocked(askHostKind).mockResolvedValue({
      os: "darwin",
      laptop: false,
      alwaysOn: { state: "may_sleep", reasons: ["sleeps_on_ac"] },
    });
    const onOpenTab = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Keep it on" }));
    expect(onOpenTab).toHaveBeenCalledWith("connection");
    expect(takeSettingsIntent()).toBe("connection-always-on");
  });

  it("the Host row itself opens Connection with no note", async () => {
    const onOpenTab = await renderPage();
    fireEvent.click(within(row("host")).getByRole("link"));
    expect(onOpenTab).toHaveBeenCalledWith("connection");
    expect(takeSettingsIntent()).toBeNull();
  });

  it("no other row leaves a note: Models, Voice, Dictation and Brain", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({ providers: [], error: "not answering" });
    vi.mocked(getDictationSetup).mockResolvedValue({
      state: "failed",
      reason: "offline",
      bytes: 138_853_314,
    });
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
    const onOpenTab = await renderPage();
    for (const [name, tab] of [
      ["Fix Models", "providers"],
      ["Fix Dictation", "kleio"],
      ["Set up Voice", "kleio"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(onOpenTab).toHaveBeenLastCalledWith(tab);
      expect(takeSettingsIntent()).toBeNull();
    }
    fireEvent.click(within(row("brain")).getByRole("link"));
    expect(onOpenTab).toHaveBeenLastCalledWith("kleio");
    expect(takeSettingsIntent()).toBeNull();
  });
});

describe("OverviewPage's notes for Apps and Tools", () => {
  beforeEach(() => {
    takeSettingsIntent();
  });

  it("Fix on the Apps row asks Apps for what needs reconnecting", async () => {
    vi.mocked(listConnections).mockResolvedValue({
      configured: true,
      connections: [app("Gmail", "EXPIRED"), app("Slack")],
    });
    const onOpenTab = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Fix Apps" }));
    expect(onOpenTab).toHaveBeenCalledWith("apps");
    expect(takeSettingsIntent()).toBe("apps-fix");
  });

  it("Fix on the Tools row asks Tools for what needs fixing", async () => {
    vi.mocked(listMcpServers).mockResolvedValue([
      server("linear", { ok: false, toolCount: 0, error: "spawn ENOENT" }),
    ]);
    const onOpenTab = await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Fix Tools" }));
    expect(onOpenTab).toHaveBeenCalledWith("mcp");
    expect(takeSettingsIntent()).toBe("tools-fix");
  });

  it("the Apps and Tools rows themselves open their pages with no note", async () => {
    const onOpenTab = await renderPage();
    fireEvent.click(within(row("apps")).getByRole("link"));
    expect(onOpenTab).toHaveBeenLastCalledWith("apps");
    expect(takeSettingsIntent()).toBeNull();
    fireEvent.click(within(row("tools")).getByRole("link"));
    expect(onOpenTab).toHaveBeenLastCalledWith("mcp");
    expect(takeSettingsIntent()).toBeNull();
  });
});

describe("OverviewPage when it can't read something", () => {
  it("tells an older host to update, for what it can't say, with nothing to press", async () => {
    const old = new KleioApiError(404, "not found");
    vi.mocked(getSetupStatus).mockRejectedValue(old);
    vi.mocked(getVoiceStatus).mockRejectedValue(old);
    vi.mocked(getDictationSetup).mockRejectedValue(new KleioApiError(403, "forbidden"));
    await renderPage();
    for (const id of ["apps", "voice", "dictation"]) {
      expect(status(id)).toBe("Update Kleio on your host to check");
      expect(mark(id)).toBe("is-unknown");
      expect(within(row(id)).queryByRole("button")).toBeNull();
    }
    expect(screen.queryByRole("alert")).toBeNull();
    // Assumed an admin until the host says otherwise: no note.
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says why aloud, and Try again asks for everything and recovers", async () => {
    vi.mocked(getSetupStatus).mockRejectedValueOnce(new KleioApiError(500, "disk full"));
    await renderPage();
    expect(status("apps")).toBe("Couldn't check: disk full");
    expect(within(row("apps")).getByRole("alert").textContent).toBe("Couldn't check: disk full");
    expect(mark("apps")).toBe("is-unknown");
    expect(filled()).toEqual([]);

    const again = screen.getByRole("button", { name: "Try again: Apps" });
    expect(again.textContent).toBe("Try again");
    await act(async () => {
      fireEvent.click(again);
    });
    for (const ask of [
      getSetupStatus,
      getVoiceStatus,
      listConnections,
      getDictationSetup,
      authStatusWithError,
      getLocalModels,
      listMemories,
      listMcpServers,
    ])
      expect(ask).toHaveBeenCalledTimes(2);
    expect(status("apps")).toBe("Gmail and Notion");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("says when the apps or the memories couldn't be read", async () => {
    vi.mocked(listConnections).mockRejectedValue(new KleioApiError(502, "composio is down"));
    vi.mocked(listMemories).mockRejectedValue(new Error("the engine isn't running"));
    await renderPage();
    expect(status("apps")).toBe("Couldn't check: composio is down");
    expect(status("brain")).toBe("Couldn't check: the engine isn't running");
    expect(screen.getByRole("button", { name: "Try again: Brain" })).toBeTruthy();
    expect(document.querySelector(".ov-memory")).toBeNull();
  });
});

describe("OverviewPage's re-read", () => {
  it("asks again when the window comes back, at most once in a while, never hidden", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await renderPage();
    expect(getVoiceStatus).toHaveBeenCalledOnce();

    // Too soon after opening.
    now.mockReturnValue(1_000_000 + REREAD_MS - 1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getVoiceStatus).toHaveBeenCalledOnce();

    // A key was added in the browser meanwhile.
    vi.mocked(getVoiceStatus).mockResolvedValue({ ...voice(true), voice: "cedar" });
    now.mockReturnValue(1_000_000 + REREAD_MS);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(getVoiceStatus).toHaveBeenCalledTimes(2);
    expect(listMcpServers).toHaveBeenCalledTimes(2);
    expect(status("voice")).toBe("Ready, in Cedar's voice");

    // Focus and visibility arrive together: one read, not two.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getVoiceStatus).toHaveBeenCalledTimes(2);

    now.mockReturnValue(1_000_000 + 3 * REREAD_MS);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getVoiceStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps what it shows while it asks again", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await renderPage();
    vi.mocked(getVoiceStatus).mockReturnValue(new Promise(() => undefined));
    now.mockReturnValue(1_000_000 + REREAD_MS);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(status("voice")).toBe("Ready, in Marin's voice");
    expect(headline()).toBe("Good evening.");
  });
});
