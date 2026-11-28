// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import conf from "../../src-tauri/tauri.conf.json";
import {
  AppsPage,
  COMPOSIO_AUTH_CONFIGS_URL,
  LOGO_ORIGIN,
  appErrorText,
  categoryLabel,
  connectionState,
  logoUrl,
} from "./AppsPage";
import {
  KleioApiError,
  connectToolkit,
  disconnect,
  getSetupStatus,
  listConnections,
  listToolkits,
  removeSetupKey,
  setSetupKey,
  type SetupStatus,
} from "./kleioApi";
import { openUrl } from "../agent";
import { connectionLine } from "./AppsShelf";
import type * as KleioApi from "./kleioApi";
import { leaveSettingsIntent, takeSettingsIntent } from "./settingsIntent";

vi.mock("../agent", () => ({ openUrl: vi.fn(async () => undefined) }));
vi.mock("./kleioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof KleioApi>();
  return {
    // The real error type and wording; only the calls to the Mac mini are fakes.
    KleioApiError: actual.KleioApiError,
    errorText: actual.errorText,
    listConnections: vi.fn(),
    listToolkits: vi.fn(),
    connectToolkit: vi.fn(),
    disconnect: vi.fn(),
    setSetupKey: vi.fn(),
    getSetupStatus: vi.fn(),
    removeSetupKey: vi.fn(),
  };
});

function setup(composio: SetupStatus["keys"]["composio"] = "saved", admin = true): SetupStatus {
  return { admin, keys: { openai: "missing", composio, typesafe: "missing" } };
}

const GMAIL = {
  slug: "gmail",
  name: "Gmail",
  logo: "https://somewhere.example/gmail.png",
  description: "Email by Google.",
  categories: ["productivity"],
};
const NOTION = { ...GMAIL, slug: "notion", name: "Notion", description: "Docs and wikis." };
const SLACK = { ...GMAIL, slug: "slack", name: "Slack", description: "Team chat." };
const HACKER_NEWS = {
  ...GMAIL,
  slug: "hackernews",
  name: "Hacker News",
  description: "Tech news.",
  auth: "none" as const,
};
const X = {
  ...GMAIL,
  slug: "twitter",
  name: "Twitter",
  description: "Posts.",
  auth: "setup" as const,
};

beforeEach(() => {
  vi.mocked(getSetupStatus).mockResolvedValue(setup());
  vi.mocked(listConnections).mockResolvedValue({ configured: true, connections: [] });
  vi.mocked(listToolkits).mockResolvedValue({ toolkits: [GMAIL, NOTION], nextCursor: "c2" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.classList.remove("platform-ios");
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<AppsPage />);
  });
  await screen.findByText("Gmail", {}, { timeout: 2000 });
}

describe("logos", () => {
  it("come from Composio's logo CDN by slug, never from the catalogue's links", () => {
    expect(logoUrl("gmail")).toBe("https://logos.composio.dev/api/gmail");
    expect(logoUrl("Google_Sheets")).toBe("https://logos.composio.dev/api/google_sheets");
    expect(logoUrl("../etc")).toBeNull();
    expect(logoUrl("a/b")).toBeNull();
    expect(logoUrl("")).toBeNull();
  });

  it("are the only remote images the app's CSP allows", () => {
    const csp = conf.app.security.csp;
    const imgSrc = csp.split(";").find((d) => d.trim().startsWith("img-src"));
    expect(imgSrc?.trim().split(/\s+/)).toEqual([
      "img-src",
      "'self'",
      "data:",
      "blob:",
      LOGO_ORIGIN,
    ]);
    // Nothing else talks to the network from the page.
    expect(csp).toContain("connect-src 'self' ipc: http://ipc.localhost;");
  });

  it("render for each app and fall back to a letter when one fails", async () => {
    await renderPage();
    const img = document.querySelector<HTMLImageElement>(
      'img[src="https://logos.composio.dev/api/gmail"]',
    );
    expect(img).not.toBeNull();
    expect(document.querySelector('img[src^="https://somewhere.example"]')).toBeNull();
    act(() => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(document.querySelector('img[src="https://logos.composio.dev/api/gmail"]')).toBeNull();
    expect(screen.getByText("G")).toBeTruthy();
  });
});

describe("AppsPage", () => {
  it("loads more apps from the next page", async () => {
    await renderPage();
    vi.mocked(listToolkits).mockResolvedValueOnce({ toolkits: [NOTION, SLACK], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Show more apps" }));
    await screen.findByText("Slack");
    expect(listToolkits).toHaveBeenLastCalledWith({ cursor: "c2" });
    // No duplicates, and no more button on the last page.
    expect(screen.getAllByText("Notion")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show more apps" })).toBeNull();
  });

  it("connects in the browser", async () => {
    vi.mocked(connectToolkit).mockResolvedValue({
      redirectUrl: "https://connect.example/start",
      connectionId: "c1",
    });
    const { openUrl } = await import("../agent");
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://connect.example/start"));
    expect(connectToolkit).toHaveBeenCalledWith("gmail");
  });

  it("refreshes when Kleio comes back from the browser's sign-in, focused or on screen again", async () => {
    await renderPage();
    const loads = (): number => vi.mocked(listConnections).mock.calls.length;
    const before = loads();
    let state: DocumentVisibilityState = "hidden";
    const visibility = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
    try {
      // Leaving for Safari reads nothing.
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(loads()).toBe(before);
      // Back on screen: the iPhone, where the window may not be focused.
      state = "visible";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(loads()).toBe(before + 1);
      // The Mac's window focused again.
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      expect(loads()).toBe(before + 2);
    } finally {
      visibility.mockRestore();
    }
  });

  it("asks before disconnecting an app", async () => {
    vi.mocked(listConnections).mockResolvedValue({
      configured: true,
      connections: [
        {
          id: "conn-1",
          toolkit: "gmail",
          name: "Gmail",
          logo: null,
          status: "ACTIVE",
          createdAt: "",
        },
      ],
    });
    vi.mocked(disconnect).mockResolvedValue(undefined);
    await renderPage();
    // On the desktop Disconnect waits in the Remove group.
    const group = screen.getByRole("region", { name: "Remove" });
    fireEvent.click(within(group).getByRole("button", { name: "Disconnect Gmail" }));
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("conn-1"));
  });

  it("shows an app that needs no sign-in as ready, with nothing to connect", async () => {
    vi.mocked(listToolkits).mockResolvedValue({ toolkits: [GMAIL, HACKER_NEWS], nextCursor: null });
    await renderPage();
    expect(screen.getByText("Ready · no sign-in")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Hacker News" })).toBeNull();
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
  });

  it("explains an app that needs your own keys, and opens Composio to add them", async () => {
    vi.mocked(listToolkits).mockResolvedValue({ toolkits: [GMAIL, X], nextCursor: null });
    vi.mocked(connectToolkit).mockRejectedValue(
      new KleioApiError(
        409,
        "Composio has no ready-made sign-in for this app. Add your own developer keys for it in Composio, then connect again.",
        undefined,
        "needs_setup",
      ),
    );
    const { openUrl } = await import("../agent");
    await renderPage();
    expect(screen.getByText("Needs your own keys")).toBeTruthy();
    // Still connectable: once the keys are in Composio, Connect works.
    fireEvent.click(screen.getByRole("button", { name: "Connect Twitter" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/no ready-made sign-in for this app/);
    expect(alert.textContent).not.toMatch(/\{/);
    fireEvent.click(within(alert).getByRole("button", { name: "Open Composio" }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith(COMPOSIO_AUTH_CONFIGS_URL));
  });

  it("turns an older host's raw Composio error into words, or into a ready app", async () => {
    vi.mocked(listToolkits).mockResolvedValue({
      toolkits: [GMAIL, { ...HACKER_NEWS, auth: undefined }],
      nextCursor: null,
    });
    vi.mocked(connectToolkit).mockRejectedValue(
      new KleioApiError(
        502,
        "composio",
        '{"error":{"message":"Toolkit hackernews does not require authentication.","code":4326,"slug":"ToolRouterV2_ToolkitsIsNoAuth","status":400}}',
      ),
    );
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Connect Hacker News" }));
    await screen.findByText("Ready · no sign-in");
    expect(screen.queryByRole("alert")).toBeNull();

    expect(
      appErrorText(new KleioApiError(502, "composio", '{"error":{"message":"Rate limited."}}')),
    ).toBe("Composio couldn't do that: Rate limited.");
    expect(appErrorText(new KleioApiError(502, "composio", "plain words"))).toBe(
      "Composio couldn't do that: plain words",
    );
    expect(appErrorText(new KleioApiError(503, "apps not set up"))).toBe("apps not set up");
  });

  it("explains when the Mac mini has no Composio key", async () => {
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
    await act(async () => {
      render(<AppsPage />);
    });
    expect(await screen.findByText("Your apps go here once Composio is set up.")).toBeTruthy();
    expect(listToolkits).not.toHaveBeenCalled();
  });

  it("takes a Composio key when the host has none, then shows the apps", async () => {
    vi.mocked(listConnections).mockResolvedValueOnce({ configured: false, connections: [] });
    vi.mocked(setSetupKey).mockResolvedValue({
      admin: true,
      keys: { openai: "missing", composio: "saved", typesafe: "missing" },
    });
    await act(async () => {
      render(<AppsPage />);
    });
    const input = await screen.findByLabelText("Composio API key");
    expect(screen.getByText("Your apps go here once Composio is set up.")).toBeTruthy();
    expect(input.getAttribute("type")).toBe("password");
    expect(screen.queryByText(/composio\.key/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Get a key" }));
    expect(openUrl).toHaveBeenCalledWith("https://dashboard.composio.dev");

    fireEvent.change(input, { target: { value: "ak_test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Gmail", {}, { timeout: 2000 });
    expect(setSetupKey).toHaveBeenCalledWith("composio", "ak_test");
    expect(listConnections).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Your apps go here once Composio is set up.")).toBeNull();
  });

  it("says why Composio refused the key", async () => {
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
    vi.mocked(setSetupKey).mockRejectedValue(new KleioApiError(422, "bad_key"));
    await act(async () => {
      render(<AppsPage />);
    });
    fireEvent.change(await screen.findByLabelText("Composio API key"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Composio didn't accept that key. Check you copied all of it.",
    );
  });

  it("labels categories in sentence case, keeping acronyms whole", () => {
    expect(categoryLabel(["developer tools"])).toBe("Developer tools");
    expect(categoryLabel(["ai"])).toBe("AI");
    expect(categoryLabel(["CRM software", "sales"])).toBe("CRM software");
    expect(categoryLabel(["social media"])).toBe("Social media");
    expect(categoryLabel([])).toBeNull();
    expect(categoryLabel(["  "])).toBeNull();
  });

  it("reads connection states in plain words", () => {
    expect(connectionState("ACTIVE")).toBe("connected");
    expect(connectionState("initiated")).toBe("pending");
    expect(connectionState("EXPIRED")).toBe("expired");
    expect(connectionState("FAILED")).toBe("failed");
    expect(connectionState("weird")).toBe("other");
  });
});

// The Composio key is added and removed here, so this page says who may change
// it and where it is kept.
describe("AppsPage's Composio key", () => {
  const ask = (): HTMLElement => screen.getByRole("button", { name: "Remove Composio key…" });

  it("ends with a Remove group that asks before removing the key", async () => {
    await renderPage();
    const group = screen.getByRole("region", { name: "Remove" });
    expect(within(group).getByText("Composio key, saved on your host")).toBeTruthy();
    // Last on the page: the page is one wrapper, and the group ends it.
    const page = document.body.lastElementChild?.lastElementChild;
    expect(page?.className).toBe("ap-page");
    expect(page?.lastElementChild).toBe(group);

    fireEvent.click(ask());
    expect(removeSetupKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    expect(
      screen.getByText(
        "Kleio and your specialists can't use your apps until a key is added again.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(removeSetupKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ask());
  });

  it("removes the key on the confirm click, then shows the form to add one", async () => {
    vi.mocked(removeSetupKey).mockResolvedValue(setup("missing"));
    await renderPage();
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });

    fireEvent.click(ask());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Composio key" }));
    });

    expect(removeSetupKey).toHaveBeenCalledExactlyOnceWith("composio");
    expect(await screen.findByText("Your apps go here once Composio is set up.")).toBeTruthy();
    expect(screen.getByLabelText("Composio API key")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
  });

  it("says why the key couldn't be removed, and keeps the apps", async () => {
    vi.mocked(removeSetupKey).mockRejectedValue(new KleioApiError(403, "forbidden"));
    await renderPage();
    fireEvent.click(ask());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Composio key" }));
    });
    expect(
      within(screen.getByRole("region", { name: "Remove" })).getByRole("alert").textContent,
    ).toBe("Only an admin device can change keys.");
    expect(screen.getByText("Gmail")).toBeTruthy();
  });

  it("offers no Remove to a device that isn't the admin", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(setup("saved", false));
    await renderPage();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove Composio key/ })).toBeNull();
  });

  it("says a key set on the host can't be changed here, with no Remove", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(setup("env"));
    await renderPage();
    const note = screen.getByText("Set on the host itself, so it can't be changed here.", {
      exact: false,
    });
    expect(note.textContent).toBe(
      "Composio keySet on the host itself, so it can't be changed here.",
    );
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
  });

  it("behaves as before on an older host: the apps, and no Remove", async () => {
    vi.mocked(getSetupStatus).mockRejectedValue(new KleioApiError(404, "not found"));
    await renderPage();
    expect(screen.getByText("Gmail")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
    expect(screen.queryByText(/Set on the host itself/)).toBeNull();
    cleanup();

    // And the form to add a key, which the host itself turns away if it must.
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
    await act(async () => {
      render(<AppsPage />);
    });
    expect(await screen.findByLabelText("Composio API key")).toBeTruthy();
  });

  it("tells a device that isn't the admin who can add the key, in place of the form", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(setup("missing", false));
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
    await act(async () => {
      render(<AppsPage />);
    });
    expect(await screen.findByText("Only your admin device can add the key.")).toBeTruthy();
    expect(screen.getByText("Your apps go here once Composio is set up.")).toBeTruthy();
    expect(screen.queryByLabelText("Composio API key")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("offers Remove as soon as a key is saved here", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(setup("missing"));
    vi.mocked(listConnections).mockResolvedValueOnce({ configured: false, connections: [] });
    vi.mocked(setSetupKey).mockResolvedValue(setup("saved"));
    await act(async () => {
      render(<AppsPage />);
    });
    fireEvent.change(await screen.findByLabelText("Composio API key"), {
      target: { value: "ak_test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Gmail", {}, { timeout: 2000 });
    expect(ask()).toBeTruthy();
  });
});

// The desktop's page: the shelf, the quiet list under Add an app, and Remove.
describe("AppsPage's shelf", () => {
  const NOW = Date.parse("2026-11-20T12:00:00Z");
  const D = 24 * 3600e3;
  const at = (ms: number): string => new Date(NOW - ms).toISOString();
  const conn = (id: string, toolkit: string, name: string, status: string, createdAt: string) => ({
    id,
    toolkit,
    name,
    logo: null,
    status,
    createdAt,
  });
  const GMAIL_A = conn("g1", "gmail", "Gmail", "ACTIVE", at(21 * D));
  const GMAIL_B = conn("g2", "gmail", "Gmail", "ACTIVE", at(2 * D));
  const SLACK_PENDING = conn("s1", "slack", "Slack", "INITIATED", at(60e3));
  const NOTION_EXPIRED = conn("n1", "notion", "Notion", "EXPIRED", at(60 * D));
  const GITHUB_FAILED = conn("h1", "github", "GitHub", "FAILED", at(D));
  const LINEAR_ODD = conn("l1", "linear", "Linear", "INACTIVE", at(9 * D));
  const DRIVE_UNDATED = conn("d1", "googledrive", "Google Drive", "ACTIVE", "");
  const ALL = [
    GMAIL_A,
    GMAIL_B,
    SLACK_PENDING,
    NOTION_EXPIRED,
    GITHUB_FAILED,
    LINEAR_ODD,
    DRIVE_UNDATED,
  ];

  beforeEach(() => {
    takeSettingsIntent();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const shelf = (): HTMLElement => screen.getByRole("region", { name: "Your apps" });
  const items = (): HTMLElement[] => [...shelf().querySelectorAll<HTMLElement>(".ap-item")];
  const addSection = (): HTMLElement =>
    screen.getByRole("heading", { name: "Add an app" }).closest("section") as HTMLElement;
  const removeGroup = (): HTMLElement => screen.getByRole("region", { name: "Remove" });
  const whats = (): (string | null)[] =>
    [...removeGroup().querySelectorAll(".st-danger-what")].map((el) => el.textContent);

  async function renderWith(connections: (typeof GMAIL_A)[]): Promise<void> {
    vi.mocked(listConnections).mockResolvedValue({ configured: true, connections });
    await act(async () => {
      render(<AppsPage />);
    });
    await waitFor(() => expect(listToolkits).toHaveBeenCalled(), { timeout: 2000 });
    await act(async () => {});
  }

  it("says a connection's state and since when, in one line", () => {
    expect(connectionLine(GMAIL_A, NOW)).toBe("Connected 21 d ago");
    expect(connectionLine(conn("x", "x", "X", "ACTIVE", at(3 * 3600e3)), NOW)).toBe(
      "Connected 3 h ago",
    );
    expect(connectionLine(DRIVE_UNDATED, NOW)).toBe("Connected");
    // Just made, or a host whose clock is ahead: never "in 2 min".
    expect(connectionLine(conn("x", "x", "X", "ACTIVE", at(5e3)), NOW)).toBe("Connected just now");
    expect(connectionLine(conn("x", "x", "X", "ACTIVE", at(-120e3)), NOW)).toBe(
      "Connected just now",
    );
    expect(connectionLine(SLACK_PENDING, NOW)).toBe("Finish signing in, in your browser");
    expect(connectionLine(NOTION_EXPIRED, NOW)).toBe("Sign-in expired");
    expect(connectionLine(GITHUB_FAILED, NOW)).toBe("Didn't connect");
    expect(connectionLine(LINEAR_ODD, NOW)).toBe("inactive");
  });

  it("stands every connection on the shelf, whatever its state, with its line and its mark", async () => {
    vi.mocked(listToolkits).mockResolvedValue({
      toolkits: [GMAIL, NOTION, SLACK],
      nextCursor: null,
    });
    await renderWith(ALL);
    expect(
      items().map((li) => [
        li.querySelector(".ap-name")?.textContent,
        li.querySelector(".ap-line")?.textContent,
        li.querySelector(".ap-dot")?.className,
      ]),
    ).toEqual([
      ["Gmail", "Connected 21 d ago", "ap-dot is-connected"],
      ["Gmail", "Connected 2 d ago", "ap-dot is-connected"],
      ["Slack", "Finish signing in, in your browser", "ap-dot is-pending"],
      ["Notion", "Sign-in expiredReconnect", "ap-dot is-expired"],
      ["GitHub", "Didn't connectReconnect", "ap-dot is-failed"],
      ["Linear", "inactive", "ap-dot is-other"],
      ["Google Drive", "Connected", "ap-dot is-connected"],
    ]);
    // A state and when, never what the catalogue says the app does.
    expect(shelf().textContent).not.toMatch(/Email by Google|Docs and wikis|Team chat/);
    expect(
      within(shelf()).getByText(
        "Kleio and every specialist can use these now. You signed in once, in your browser.",
      ),
    ).toBeTruthy();
    // None of the phone's card or tiles.
    expect(screen.queryByText("Your apps")).toBeNull();
    expect(document.querySelector(".app-mine, .app-grid, .app-tile")).toBeNull();
  });

  it("lists under Add an app only the apps with no connection of any state", async () => {
    vi.mocked(listToolkits).mockResolvedValue({
      toolkits: [GMAIL, NOTION, SLACK, HACKER_NEWS, X],
      nextCursor: null,
    });
    await renderWith([GMAIL_A, SLACK_PENDING, NOTION_EXPIRED]);
    const rows = [...addSection().querySelectorAll<HTMLElement>(".ap-add-list > li")];
    expect(rows.map((li) => li.dataset.app)).toEqual(["hackernews", "twitter"]);
    expect(within(addSection()).queryByText("Waiting…")).toBeNull();
    // Each row is one button named for what it does, showing the category and how.
    const connectX = within(addSection()).getByRole("button", { name: "Connect Twitter" });
    expect(connectX.className).toBe("ap-add-row");
    expect(connectX.textContent).toBe("TTwitterProductivityNeeds your own keys");
    // What the app does is the row's tooltip, not in the list.
    expect(connectX.title).toBe("Posts.");
    expect(addSection().textContent).not.toContain("Posts.");
    // An app that needs no sign-in is not a button.
    const ready = within(addSection()).getByText("Ready · no sign-in").closest(".ap-add-row");
    expect(ready?.tagName).toBe("SPAN");
    expect(
      within(addSection()).getByText("Search hundreds of apps. Connecting opens your browser."),
    ).toBeTruthy();
    expect(within(addSection()).getByLabelText("Search apps").getAttribute("type")).toBe("search");
  });

  it("says so when everything on the page is connected, and when a search finds nothing", async () => {
    vi.mocked(listToolkits).mockResolvedValue({ toolkits: [GMAIL], nextCursor: null });
    await renderWith([GMAIL_A]);
    expect(within(addSection()).getByText("Every app here is connected.")).toBeTruthy();
    vi.mocked(listToolkits).mockResolvedValue({ toolkits: [], nextCursor: null });
    fireEvent.change(screen.getByLabelText("Search apps"), { target: { value: "zzz" } });
    expect(await within(addSection()).findByText("No apps match “zzz”.")).toBeTruthy();
    // The shelf is as it was.
    expect(items()).toHaveLength(1);
  });

  it("shows a row as opening while its sign-in starts", async () => {
    let started: (r: { redirectUrl: string; connectionId: string }) => void = () => {};
    vi.mocked(connectToolkit).mockReturnValue(new Promise((r) => (started = r)));
    await renderWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Connect Notion" }));
    const row = screen.getByRole<HTMLButtonElement>("button", { name: "Connect Notion" });
    expect(row.querySelector(".ap-add-how")?.textContent).toBe("Opening…");
    expect(row.disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Connect Gmail" }).disabled).toBe(
      true,
    );
    await act(async () =>
      started({ redirectUrl: "https://connect.example/start", connectionId: "c9" }),
    );
    expect(openUrl).toHaveBeenCalledWith("https://connect.example/start");
  });

  it("puts a logo on a light tile only once it has loaded", async () => {
    await renderWith([GMAIL_A]);
    const icon = items()[0]?.querySelector(".ap-icon") as HTMLElement;
    const img = icon.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://logos.composio.dev/api/gmail");
    expect(icon.className).toBe("ap-icon");
    expect(icon.querySelector(".ap-icon-letter")?.textContent).toBe("G");
    act(() => {
      img.dispatchEvent(new Event("load"));
    });
    expect(icon.className).toBe("ap-icon has-logo");
    expect(icon.querySelector(".ap-icon-letter")).toBeNull();
  });

  it("reconnects an expired or failed app from the shelf", async () => {
    vi.mocked(connectToolkit).mockResolvedValue({
      redirectUrl: "https://connect.example/again",
      connectionId: "n1",
    });
    await renderWith([GMAIL_A, NOTION_EXPIRED, GITHUB_FAILED]);
    expect(
      within(shelf())
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Reconnect Notion", "Reconnect GitHub"]);
    await act(async () => {
      fireEvent.click(within(shelf()).getByRole("button", { name: "Reconnect Notion" }));
    });
    expect(connectToolkit).toHaveBeenCalledExactlyOnceWith("notion");
    expect(openUrl).toHaveBeenCalledWith("https://connect.example/again");
  });

  it("holds one Disconnect per connection in Remove, told apart, with the key last", async () => {
    await renderWith(ALL);
    expect(whats()).toEqual([
      "Gmail · Connected 21 d ago",
      "Gmail · Connected 2 d ago",
      "Slack · Finish signing in, in your browser",
      "Notion · Sign-in expired",
      "GitHub · Didn't connect",
      "Linear · inactive",
      "Google Drive · Connected",
      "Composio key, saved on your host",
    ]);
    // Destructive controls only there.
    expect(shelf().querySelector("[aria-label^='Disconnect'], .btn-destructive")).toBeNull();
    expect(within(removeGroup()).getAllByRole("button", { name: "Disconnect Gmail" })).toHaveLength(
      2,
    );
    // No filled button once Composio is set up.
    expect(document.querySelectorAll(".ap-page .btn-primary")).toHaveLength(0);
  });

  it("asks first with focus on Keep, then moves focus to the next app's item", async () => {
    vi.mocked(disconnect).mockResolvedValue(undefined);
    vi.mocked(listToolkits).mockResolvedValue({ toolkits: [GMAIL, NOTION], nextCursor: null });
    await renderWith([GMAIL_A, NOTION_EXPIRED]);
    const ask = (name: string): HTMLElement =>
      within(removeGroup()).getByRole("button", { name: `Disconnect ${name}` });

    fireEvent.click(ask("Gmail"));
    expect(disconnect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    expect(
      screen.getByText("Kleio and your specialists lose Gmail until you connect it again."),
    ).toBeTruthy();

    vi.mocked(listConnections).mockResolvedValue({
      configured: true,
      connections: [NOTION_EXPIRED],
    });
    await act(async () => {
      fireEvent.click(within(removeGroup()).getByRole("button", { name: "Disconnect" }));
    });
    expect(disconnect).toHaveBeenCalledExactlyOnceWith("g1");
    // Gmail leaves the shelf and joins Add an app.
    expect(items().map((li) => li.dataset.app)).toEqual(["notion"]);
    expect(within(addSection()).getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
    expect(document.activeElement).toBe(ask("Notion"));

    // With no app left, focus goes to Add an app, not to the key.
    fireEvent.click(ask("Notion"));
    vi.mocked(listConnections).mockResolvedValue({ configured: true, connections: [] });
    await act(async () => {
      fireEvent.click(within(removeGroup()).getByRole("button", { name: "Disconnect" }));
    });
    expect(disconnect).toHaveBeenLastCalledWith("n1");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Add an app" }));
    expect(whats()).toEqual(["Composio key, saved on your host"]);
  });

  it("says why a disconnect failed, and keeps the app", async () => {
    vi.mocked(disconnect).mockRejectedValue(new KleioApiError(500, "disk full"));
    await renderWith([GMAIL_A]);
    fireEvent.click(within(removeGroup()).getByRole("button", { name: "Disconnect Gmail" }));
    await act(async () => {
      fireEvent.click(within(removeGroup()).getByRole("button", { name: "Disconnect" }));
    });
    expect(within(removeGroup()).getByRole("alert").textContent).toBe("disk full");
    expect(items()).toHaveLength(1);
    // Still asking, so it can be tried again or kept.
    expect(within(removeGroup()).getByRole("button", { name: "Keep" })).toBeTruthy();
  });

  it("shows three empty places and what to do when nothing is connected", async () => {
    await renderWith([]);
    expect(shelf().querySelectorAll(".ap-shelf.is-empty .ap-slot")).toHaveLength(3);
    expect(shelf().querySelector(".ap-shelf")?.getAttribute("aria-hidden")).toBe("true");
    expect(
      within(shelf()).getByText("Nothing connected yet. Pick an app below to start."),
    ).toBeTruthy();
  });

  it("shows the empty shelf and what Composio brings before it is set up", async () => {
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
    await act(async () => {
      render(<AppsPage />);
    });
    await screen.findByText("Your apps go here once Composio is set up.");
    expect(shelf().querySelectorAll(".ap-shelf.is-empty .ap-slot")).toHaveLength(3);
    expect(
      screen.getByText(
        "Gmail, Calendar, Notion and hundreds more can then work for Kleio and every specialist, through Composio on your host.",
      ),
    ).toBeTruthy();
    // The key form's Save is the page's one filled button; there is no search yet.
    expect(
      [...document.querySelectorAll(".ap-page .btn-primary")].map((b) => b.textContent),
    ).toEqual(["Save"]);
    expect(screen.queryByLabelText("Search apps")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add an app" })).toBeNull();
  });

  it("says the host didn't answer, rests the search, and tries again when asked", async () => {
    vi.mocked(listConnections).mockRejectedValue(new KleioApiError(0, "host unreachable"));
    await act(async () => {
      render(<AppsPage />);
    });
    const line = await within(shelf()).findByRole("status");
    expect(line.textContent).toBe("Couldn't reach your host to list your apps.Try again");
    expect(shelf().querySelectorAll(".ap-shelf.is-empty .ap-slot")).toHaveLength(3);
    expect(screen.getByLabelText<HTMLInputElement>("Search apps").disabled).toBe(true);
    expect(within(addSection()).getByText("Apps load when your host answers.")).toBeTruthy();
    expect(listToolkits).not.toHaveBeenCalled();
    // Not shown as a failed connect.
    expect(screen.queryByRole("alert")).toBeNull();

    vi.mocked(listConnections).mockResolvedValue({ configured: true, connections: [GMAIL_A] });
    const before = vi.mocked(listConnections).mock.calls.length;
    await act(async () => {
      fireEvent.click(within(shelf()).getByRole("button", { name: "Try again" }));
    });
    expect(vi.mocked(listConnections).mock.calls.length).toBe(before + 1);
    expect(items()).toHaveLength(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Search apps").disabled).toBe(false);
  });

  it("keeps the shelf when a later read fails, and says it couldn't refresh", async () => {
    await renderWith([GMAIL_A, NOTION_EXPIRED]);
    vi.mocked(listConnections).mockRejectedValue(new KleioApiError(0, "host unreachable"));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(items().map((li) => li.dataset.app)).toEqual(["gmail", "notion"]);
    const line = within(shelf()).getByRole("status");
    expect(line.textContent).toBe("Couldn't reach your host to refresh your apps.Try again");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Search apps").disabled).toBe(false);
    expect(whats()).toHaveLength(3);

    vi.mocked(listConnections).mockResolvedValue({ configured: true, connections: [GMAIL_A] });
    await act(async () => {
      fireEvent.click(within(line).getByRole("button", { name: "Try again" }));
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(items().map((li) => li.dataset.app)).toEqual(["gmail"]);
  });

  it("puts focus on the first Reconnect when Overview's Fix opened it, once and without pressing", async () => {
    leaveSettingsIntent("apps-fix");
    await renderWith([GMAIL_A, NOTION_EXPIRED, GITHUB_FAILED]);
    const first = within(shelf()).getByRole("button", { name: "Reconnect Notion" });
    expect(document.activeElement).toBe(first);
    expect(connectToolkit).not.toHaveBeenCalled();
    expect(takeSettingsIntent()).toBeNull();
    // A later read moves nothing.
    first.blur();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(document.activeElement).toBe(document.body);
  });

  it("moves no focus when the tab is opened any other way", async () => {
    await renderWith([GMAIL_A, NOTION_EXPIRED]);
    expect(document.activeElement).toBe(document.body);
  });
});

// The iPhone draws the same page: the shelf, with the key's Remove at its end.
describe("AppsPage on the iPhone", () => {
  beforeEach(() => {
    document.documentElement.classList.add("platform-ios");
  });

  it("asks the host who may change the Composio key, and ends with Remove", async () => {
    await renderPage();
    expect(getSetupStatus).toHaveBeenCalled();
    const group = screen.getByRole("region", { name: "Remove" });
    expect(within(group).getByText("Composio key, saved on your host")).toBeTruthy();
  });

  it("stands your apps on the shelf and lists the rest under Add an app, with no card or tiles", async () => {
    vi.mocked(listConnections).mockResolvedValue({
      configured: true,
      connections: [
        {
          id: "conn-1",
          toolkit: "gmail",
          name: "Gmail",
          logo: null,
          status: "ACTIVE",
          createdAt: "",
        },
      ],
    });
    await act(async () => {
      render(<AppsPage />);
    });
    await screen.findByText("Notion", {}, { timeout: 2000 });

    expect(document.querySelector(".ap-page .ap-shelf")).not.toBeNull();
    expect(document.querySelectorAll(".ap-add-list .ap-add-row")).toHaveLength(1);
    expect(document.querySelector(".app-mine-row, .app-grid, .app-tile")).toBeNull();
    expect(screen.queryByText("Your apps")).toBeNull();
  });

  it("tells a device that isn't the admin who can add the key, in place of the form", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(setup("missing", false));
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
    await act(async () => {
      render(<AppsPage />);
    });
    expect(await screen.findByText("Only your admin device can add the key.")).toBeTruthy();
    expect(screen.queryByLabelText("Composio API key")).toBeNull();
  });
});
