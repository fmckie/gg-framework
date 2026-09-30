// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Each page is exercised by its own tests; here they are stand-ins, so this
// file covers only the screen: the header, the tabs, and Back.
vi.mock("./SettingsModal", () => ({ SettingsModal: () => <p>general page</p> }));
vi.mock("./McpModal", () => ({ McpModal: () => <p>mcp page</p> }));
vi.mock("./SteroidsModal", () => ({ SteroidsModal: () => <p>steroids page</p> }));
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
vi.mock("./LoginScreen", async () => {
  const { SettingsHeaderStatus } = await import("./settings-header");
  return {
    LoginScreen: () => (
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
  getSteroidsStatus: () => Promise.resolve({ installed: true, connected: true }),
  onSteroidsChange: () => () => {},
}));

import { SettingsScreen } from "./SettingsScreen";

afterEach(() => {
  cleanup();
});

async function renderScreen(props: Partial<Parameters<typeof SettingsScreen>[0]> = {}) {
  const onClose = vi.fn();
  render(<SettingsScreen onClose={onClose} {...props} />);
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

    fireEvent.click(screen.getByRole("tab", { name: "MCP" }));

    expect(heading()).toBe("MCP");
    expect(screen.getByText("mcp page")).toBeTruthy();
    expect(screen.queryByText("general page")).toBeNull();
  });

  it("opens on the requested tab", async () => {
    await renderScreen({ initialTab: "steroids" });

    expect(heading()).toBe("Steroids");
    expect(screen.getByRole("tab", { name: "Steroids" }).getAttribute("aria-selected")).toBe(
      "true",
    );
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

  it("clears a page's header buttons when another tab opens", async () => {
    await renderScreen({ initialTab: "connection" });
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "MCP" }));

    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("goes back with the Back button", async () => {
    const { onClose } = await renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
