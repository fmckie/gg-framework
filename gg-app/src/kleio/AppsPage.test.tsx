// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import conf from "../../src-tauri/tauri.conf.json";
import { AppsPage, LOGO_ORIGIN, categoryLabel, connectionState, logoUrl } from "./AppsPage";
import { connectToolkit, disconnect, listConnections, listToolkits } from "./kleioApi";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));
vi.mock("./kleioApi", () => ({
  listConnections: vi.fn(),
  listToolkits: vi.fn(),
  connectToolkit: vi.fn(),
  disconnect: vi.fn(),
}));

const GMAIL = {
  slug: "gmail",
  name: "Gmail",
  logo: "https://somewhere.example/gmail.png",
  description: "Email by Google.",
  categories: ["productivity"],
};
const NOTION = { ...GMAIL, slug: "notion", name: "Notion", description: "Docs and wikis." };
const SLACK = { ...GMAIL, slug: "slack", name: "Slack", description: "Team chat." };

beforeEach(() => {
  vi.mocked(listConnections).mockResolvedValue({ configured: true, connections: [] });
  vi.mocked(listToolkits).mockResolvedValue({ toolkits: [GMAIL, NOTION], nextCursor: "c2" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://connect.example/start"));
    expect(connectToolkit).toHaveBeenCalledWith("gmail");
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
    const mine = screen.getByText("Your apps").closest("section") as HTMLElement;
    fireEvent.click(within(mine).getByRole("button", { name: "Disconnect Gmail" }));
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(mine).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith("conn-1"));
  });

  it("explains when the Mac mini has no Composio key", async () => {
    vi.mocked(listConnections).mockResolvedValue({ configured: false, connections: [] });
    await act(async () => {
      render(<AppsPage />);
    });
    expect(await screen.findByText("Apps aren't set up yet")).toBeTruthy();
    expect(listToolkits).not.toHaveBeenCalled();
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
