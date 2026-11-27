// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "./agent";
import { SETUP_SEEN_KEY } from "./app-entry-view";

mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("./App");
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

const REPO = "https://github.com/acme/cookbook";
const STATE: AgentState = {
  cwd: "/workspaces/chrome",
  mode: "code",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  running: false,
  isGitRepo: true,
  gitBranch: "main",
  gitDirtyFileCount: 3,
  gitHubPRs: 7,
  gitHubIssues: 1,
  gitHubRepoUrl: REPO,
};
let opened: unknown[] = [];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  localStorage.setItem(SETUP_SEEN_KEY, "1");
  opened = [];
});
afterEach(() => {
  cleanup();
  clearMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  if (scrollToDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function openCode(state: AgentState = STATE): Promise<HTMLElement> {
  mockWindows("main");
  mockIPC((command, args) => {
    switch (command) {
      case "window_restore_target":
        return { mode: "code", cwd: state.cwd, sessionPath: null };
      case "sidecar_port":
        return 12345;
      case "agent_state":
        return state;
      case "agent_models":
        return { models: [{ id: state.model, provider: state.provider }] };
      case "agent_commands":
        return { commands: [] };
      case "agent_tasks":
        return { tasks: [] };
      case "agent_history":
        return { history: [] };
      case "open_url":
        opened.push((args as { url: unknown }).url);
        return null;
      case "plugin:log|log":
        return null;
      default:
        return new Promise(() => {});
    }
  });
  const { container } = render(<App />);
  await screen.findByRole("button", { name: "Back to this project's sessions" });
  return container;
}

const rowText = (): (string | null)[] =>
  [
    ...screen
      .getByRole("navigation", { name: "Composer panel entries" })
      .querySelectorAll("button"),
  ].map((button) => button.textContent);

describe("the composer's Branch trigger and panel", () => {
  it("adds Branch to the row of a Code session with a branch and a GitHub repository", async () => {
    const container = await openCode();
    await screen.findByRole("button", { name: "Branch main" });
    expect(rowText()).toEqual(["More ···", "⑂ main"]);
    expect(container.querySelector(".branch-panel")).toBeNull();
  });

  it("shows no Branch trigger for a branch with no GitHub repository", async () => {
    const container = await openCode({ ...STATE, gitHubRepoUrl: null });
    // The branch has arrived: the title row shows it.
    await waitFor(() => expect(container.textContent).toContain("⎇ main"));
    expect(rowText()).toEqual(["More ···"]);
    expect(screen.queryByRole("button", { name: "Branch main" })).toBeNull();
  });

  it("puts Branch in the composer's place with the draft kept, and Escape gives it back", async () => {
    const container = await openCode();
    const draft = container.querySelector<HTMLTextAreaElement>(".inputwrap textarea")!;
    fireEvent.change(draft, { target: { value: "half a thought" } });
    const branch = await screen.findByRole("button", { name: "Branch main" });

    fireEvent.click(branch);
    const panel = screen.getByRole("region", { name: "Branch" });
    expect(panel.nextElementSibling).toBe(container.querySelector(".inputwrap"));
    expect(branch.getAttribute("aria-expanded")).toBe("true");
    expect(branch.getAttribute("aria-controls")).toBe(panel.id);
    expect(screen.getByRole("heading", { name: "main" })).toBeDefined();
    expect(screen.getByText("3 uncommitted files")).toBeDefined();
    expect([...panel.querySelectorAll(".branch-action")].map((e) => e.textContent)).toEqual([
      "Pull requests 7",
      "Issues 1",
      "Open on GitHub",
    ]);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".branch-panel")).toBeNull();
    expect(container.querySelector(".inputwrap textarea")).toBe(draft);
    expect(draft.value).toBe("half a thought");
    expect(document.activeElement).toBe(branch);

    fireEvent.click(branch);
    fireEvent.click(branch);
    expect(container.querySelector(".branch-panel")).toBeNull();
  });

  it("opens the repository's own pages through the app's open_url", async () => {
    await openCode();
    fireEvent.click(await screen.findByRole("button", { name: "Branch main" }));
    fireEvent.click(screen.getByRole("button", { name: "Pull requests 7" }));
    fireEvent.click(screen.getByRole("button", { name: "Issues 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Open on GitHub" }));
    await waitFor(() => expect(opened).toEqual([`${REPO}/pulls`, `${REPO}/issues`, REPO]));
    expect(screen.getByRole("region", { name: "Branch" })).toBeDefined();
  });

  it("shows one panel at a time: Branch, More and Model put each other away", async () => {
    const container = await openCode();
    const branch = await screen.findByRole("button", { name: "Branch main" });
    const more = screen.getByRole("button", { name: "More" });
    const model = await waitFor(() => {
      const trigger = container.querySelector<HTMLButtonElement>(".model-trigger:not(:disabled)");
      if (!trigger) throw new Error("no model trigger yet");
      return trigger;
    });
    const showing = (): string[] =>
      [".branch-panel", ".more-panel", ".model-panel"].filter((panel) =>
        container.querySelector(panel),
      );
    fireEvent.click(branch);
    expect(showing()).toEqual([".branch-panel"]);
    fireEvent.click(more);
    expect(showing()).toEqual([".more-panel"]);
    expect(branch.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(branch);
    expect(showing()).toEqual([".branch-panel"]);
    fireEvent.click(model);
    expect(showing()).toEqual([".model-panel"]);
    fireEvent.click(branch);
    expect(showing()).toEqual([".branch-panel"]);
  });
});
