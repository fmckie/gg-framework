// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Each page is exercised by its own tests; here they are stand-ins, so this
// file covers only the screen: the header, the tabs, and Back.
// The General page saves when pressed.
vi.mock("./kleio/GeneralPage", () => ({
  GeneralPage: ({ onSaved }: { onSaved?: (root: string) => void }) => (
    <button type="button" onClick={() => onSaved?.("/Users/you/Code")}>
      general page
    </button>
  ),
}));
vi.mock("./kleio/ToolsPage", () => ({ ToolsPage: () => <p>tools page</p> }));
// The Steroids page shows the status the screen holds, and reports a fault when pressed.
vi.mock("./kleio/SteroidsPage", () => ({
  SteroidsPage: ({
    status,
    onStatus,
  }: {
    status: { connected: boolean } | null;
    onStatus: (s: { installed: boolean; connected: boolean; error?: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onStatus({ installed: true, connected: false, error: "database is locked" })}
    >
      {`steroids page (${status ? (status.connected ? "connected" : "not connected") : "unknown"})`}
    </button>
  ),
}));
vi.mock("./kleio/LazyConnectionPage", async () => {
  const { SettingsHeaderAction, SettingsHeaderStatus } = await import("./settings-header");
  return {
    ConnectionPage: () => (
      <>
        <SettingsHeaderStatus>
          <span>Connected</span>
        </SettingsHeaderStatus>
        <SettingsHeaderAction>
          <button type="button">Check again</button>
        </SettingsHeaderAction>
        <p>connection page</p>
      </>
    ),
  };
});
vi.mock("./kleio/LazyAppsPage", () => ({ AppsPage: () => <p>apps page</p> }));
vi.mock("./kleio/OverviewPage", () => ({
  OverviewPage: ({ onOpenTab }: { onOpenTab: (tab: string) => void }) => (
    <button type="button" onClick={() => onOpenTab("connection")}>
      overview page
    </button>
  ),
}));
vi.mock("./kleio/KleioPage", () => ({
  KleioPage: ({ onIntroduce }: { onIntroduce: () => Promise<void> }) => (
    <button type="button" onClick={() => void onIntroduce()}>
      introduce yourself
    </button>
  ),
}));
vi.mock("./kleio/AboutPage", () => ({ AboutPage: () => <p>about page</p> }));
vi.mock("./kleio/ProvidersPage", async () => {
  const { SettingsHeaderStatus } = await import("./settings-header");
  return {
    ProvidersPage: () => (
      <>
        <SettingsHeaderStatus>
          <span>3 connected</span>
        </SettingsHeaderStatus>
        <p>providers page</p>
      </>
    ),
  };
});
vi.mock("./agent", () => ({
  waitForReady: () => Promise.resolve(),
  getSteroidsStatus: vi.fn(),
  onSteroidsChange: () => () => {},
}));
vi.mock("./toast", () => ({ toast: vi.fn() }));

import { getSteroidsStatus, type SteroidsStatus } from "./agent";
import { SettingsScreen } from "./SettingsScreen";
import { toast } from "./toast";

beforeEach(() => {
  vi.mocked(getSteroidsStatus).mockResolvedValue({ installed: true, connected: true });
});
afterEach(() => {
  cleanup();
  vi.mocked(toast).mockClear();
  document.documentElement.classList.remove("platform-ios");
});

async function renderScreen(props: Partial<Parameters<typeof SettingsScreen>[0]> = {}) {
  const onClose = vi.fn();
  render(<SettingsScreen onClose={onClose} onIntroduce={vi.fn(async () => {})} {...props} />);
  // Let the status loads settle.
  await act(async () => {
    await Promise.resolve();
  });
  return { onClose };
}

function heading(): string | null {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

describe("SettingsScreen", () => {
  it("titles the header after the open tab and follows the tab bar", async () => {
    await renderScreen();

    expect(heading()).toBe("General");
    expect(screen.getByText("general page")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Tools" }));

    expect(heading()).toBe("Tools");
    expect(screen.getByText("tools page")).toBeTruthy();
    expect(screen.queryByText("general page")).toBeNull();
  });

  it("puts Overview first, still opens on General, and lets Overview switch tabs", async () => {
    await renderScreen();
    expect(screen.getAllByRole("tab")[0]?.getAttribute("aria-label")).toBe("Overview");
    expect(heading()).toBe("General");

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(heading()).toBe("Overview");
    fireEvent.click(screen.getByRole("button", { name: "overview page" }));
    expect(heading()).toBe("Connection");
    expect(screen.getByText("connection page")).toBeTruthy();
  });

  it("hands Kleio's Introduce yourself to the app", async () => {
    const onIntroduce = vi.fn(async () => {});
    await renderScreen({ initialTab: "kleio", onIntroduce });
    expect(heading()).toBe("Kleio");

    fireEvent.click(screen.getByRole("button", { name: "introduce yourself" }));

    expect(onIntroduce).toHaveBeenCalledOnce();
  });

  it("opens on the requested tab", async () => {
    await renderScreen({ initialTab: "steroids" });

    expect(heading()).toBe("Steroids");
    expect(screen.getByRole("tab", { name: "Steroids" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByText("steroids page (connected)")).toBeTruthy();
  });

  it("shows a page's status in the header only while that page is open", async () => {
    await renderScreen();
    expect(screen.queryByText("3 connected")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "AI Providers" }));
    expect(screen.getByText("3 connected")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.queryByText("3 connected")).toBeNull();
  });

  it("has Connection in place of the Telegram Remote page", async () => {
    await renderScreen({ initialTab: "connection" });

    expect(heading()).toBe("Connection");
    expect(screen.getByText("connection page")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Remote" })).toBeNull();
    const header = document.querySelector(".picker-head");
    expect(header?.textContent).toContain("Connected");
    const check = screen.getByRole("button", { name: "Check again" });
    // In the header bar's right-aligned action group, not the page body.
    expect(check.closest(".settings-head-actions")).not.toBeNull();
  });

  it("has Apps (moved from the home screen) and About", async () => {
    await renderScreen();

    const labels = screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Overview",
      "Kleio",
      "General",
      "AI Providers",
      "Connection",
      "Apps",
      "Tools",
      "Steroids",
      "About",
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Apps" }));
    expect(heading()).toBe("Apps");
    expect(screen.getByText("apps page")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(heading()).toBe("About");
    expect(screen.getByText("about page")).toBeTruthy();
  });

  it("clears a page's header buttons when another tab opens", async () => {
    await renderScreen({ initialTab: "connection" });
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Tools" }));

    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("names the unselected tabs in tooltips on the desktop", async () => {
    await renderScreen();

    const titles = screen.getAllByRole("tab").map((t) => t.getAttribute("title"));
    // General is open: it shows its label, so it needs no tooltip.
    expect(titles).toEqual([
      "Overview",
      "Kleio",
      null,
      "AI Providers",
      "Connection",
      "Apps",
      "Tools",
      "Steroids",
      "About",
    ]);
  });

  it("gives the tabs no tooltips on the phone, which has no hover", async () => {
    document.documentElement.classList.add("platform-ios");
    await renderScreen();

    for (const tab of screen.getAllByRole("tab")) expect(tab.hasAttribute("title")).toBe(false);
  });

  it("goes back with the Back button", async () => {
    const { onClose } = await renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

// kleio/settingsLayout.tsx: one set of tabs and pages, for the desktop and the iPhone.
describe.each([
  ["the desktop", null],
  ["the iPhone", "platform-ios"],
] as const)("SettingsScreen's tabs and pages on %s", (_device, platform) => {
  beforeEach(() => {
    if (platform) document.documentElement.classList.add(platform);
  });

  const steroidsDot = (): Element | null =>
    screen.getByRole("tab", { name: "Steroids" }).querySelector(".settings-tab-alert");

  async function withSteroids(status: SteroidsStatus): Promise<void> {
    vi.mocked(getSteroidsStatus).mockResolvedValue(status);
    await renderScreen();
  }

  it("has nine tabs: Overview first, Kleio second, and MCP as Tools", async () => {
    await renderScreen();

    const labels = screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Overview",
      "Kleio",
      "General",
      "AI Providers",
      "Connection",
      "Apps",
      "Tools",
      "Steroids",
      "About",
    ]);
  });

  it("opens Overview for the tab id Setup has always had", async () => {
    await renderScreen({ initialTab: "setup" });

    expect(heading()).toBe("Overview");
    expect(screen.getByRole("button", { name: "overview page" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" }).id).toBe("settings-tab-setup");
    expect(screen.getByRole("tab", { name: "Tools" }).id).toBe("settings-tab-mcp");
  });

  it("lets Overview switch tabs, and Kleio introduce you", async () => {
    const onIntroduce = vi.fn(async () => {});
    await renderScreen({ initialTab: "kleio", onIntroduce });

    expect(heading()).toBe("Kleio");
    fireEvent.click(screen.getByRole("button", { name: "introduce yourself" }));
    expect(onIntroduce).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "overview page" }));
    expect(heading()).toBe("Connection");
  });

  it("opens the ring for AI Providers, with its count in the header", async () => {
    await renderScreen({ initialTab: "providers" });

    expect(heading()).toBe("AI Providers");
    expect(screen.getByText("providers page")).toBeTruthy();
    expect(screen.getByText("3 connected")).toBeTruthy();
  });

  it("opens the workbench for Tools", async () => {
    await renderScreen({ initialTab: "mcp" });

    expect(heading()).toBe("Tools");
    expect(screen.getByText("tools page")).toBeTruthy();
  });

  it("shows no Steroids dot when it isn't installed", async () => {
    await withSteroids({ installed: false, connected: false });

    expect(steroidsDot()).toBeNull();
  });

  it("shows no Steroids dot for an empty corpus", async () => {
    await withSteroids({ installed: true, connected: false, repos: 0 });

    expect(steroidsDot()).toBeNull();
  });

  it("shows the Steroids dot when it's installed and failing", async () => {
    await withSteroids({
      installed: true,
      connected: false,
      error: "steroids: database is locked",
    });

    expect(steroidsDot()).not.toBeNull();
    expect(document.querySelectorAll(".settings-tab-alert")).toHaveLength(1);
  });

  it("shows no Steroids dot while it works", async () => {
    await withSteroids({ installed: true, connected: true, repos: 12 });

    expect(steroidsDot()).toBeNull();
  });

  it("opens the folder page for General", async () => {
    await renderScreen({ initialTab: "general" });

    expect(heading()).toBe("General");
    expect(screen.getByRole("button", { name: "general page" })).toBeTruthy();
    // Save is on the page: nothing is put in the header.
    expect(document.querySelector(".settings-head-actions")?.childNodes).toHaveLength(0);
  });

  it("says the folder was saved when the General page saves", async () => {
    await renderScreen({ initialTab: "general" });
    expect(toast).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "general page" }));

    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("Project folder saved.", "success");
  });

  it("opens the one-section page for Steroids, with the status the screen holds", async () => {
    await renderScreen({ initialTab: "steroids" });

    expect(heading()).toBe("Steroids");
    expect(screen.getByRole("button", { name: "steroids page (connected)" })).toBeTruthy();
  });

  it("puts the dot on the Steroids tab when its page reports a fault", async () => {
    await renderScreen({ initialTab: "steroids" });
    expect(steroidsDot()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "steroids page (connected)" }));

    expect(screen.getByRole("button", { name: "steroids page (not connected)" })).toBeTruthy();
    expect(steroidsDot()).not.toBeNull();
    expect(document.querySelectorAll(".settings-tab-alert")).toHaveLength(1);
  });

  it("opens About", async () => {
    await renderScreen({ initialTab: "about" });
    expect(screen.getByText("about page")).toBeTruthy();
  });
});
