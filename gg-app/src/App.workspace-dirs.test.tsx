// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { open } from "@tauri-apps/plugin-dialog";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

// Install native mocks before importing the real app, and keep its module
// loading in collection (see App.placeholder.test.tsx).
mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("./App");

const openDialog = vi.mocked(open);

const CWD = "/Users/will/kleio-projects/site";
const HOST = "mac-mini-1.taila6c237.ts.net";
/** What the host lists for Open existing: the session's own folder among them. */
const HOST_FOLDERS = [
  { name: "api", path: "/Users/will/kleio-projects/api", hidden: false },
  { name: "site", path: CWD, hidden: false },
  { name: "old-blog", path: "/Users/will/kleio-projects/old-blog", hidden: true },
];
const ROOTS = ["/Users/will/kleio-projects/api", "/Users/will/work/docs"];

interface Session {
  /** The paired Kleio host, or null for a local session. */
  host: string | null;
  additionalRoots: string[];
}

/** The text of an `agent_prompt` call. */
function promptText(payload: InvokeArgs | undefined): string | null {
  if (!payload || Array.isArray(payload) || payload instanceof ArrayBuffer) return null;
  if (ArrayBuffer.isView(payload)) return null;
  return typeof payload.text === "string" ? payload.text : null;
}

/** Open the window on a code session, recording the commands it sends. */
function openSession(session: Session): { calls: string[]; prompts: string[] } {
  const calls: string[] = [];
  const prompts: string[] = [];
  mockWindows("main");
  mockIPC(
    (cmd, payload) => {
      calls.push(cmd);
      switch (cmd) {
        case "window_restore_target":
          return { mode: "code", cwd: CWD, sessionPath: null };
        case "sidecar_port":
          return 45678;
        case "agent_state":
          return {
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            cwd: CWD,
            mode: "code",
            running: false,
            additionalRoots: session.additionalRoots,
          };
        case "agent_commands":
          return {
            commands: [
              { name: "add-dir", aliases: ["adddir"], description: "Add another project folder" },
              { name: "remove-dir", aliases: ["removedir"], description: "Remove an added folder" },
            ],
          };
        case "agent_models":
          return { models: [] };
        case "agent_tasks":
          return { tasks: [] };
        case "agent_history":
          return { history: [] };
        case "kleio_remote_status":
          return {
            active: session.host
              ? {
                  base: `https://${session.host}:8443`,
                  host: session.host,
                  deviceId: "d1",
                  label: "Laptop",
                  admin: false,
                }
              : null,
            paired: null,
          };
        case "agent_project_folders":
          return { folders: HOST_FOLDERS };
        case "agent_prompt": {
          const text = promptText(payload);
          if (text !== null) prompts.push(text);
          return null;
        }
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  render(<App />);
  return { calls, prompts };
}

/** Choose `/name` from the composer's command menu, as a click would. */
async function chooseCommand(name: "add-dir" | "remove-dir"): Promise<void> {
  fireEvent.change(await screen.findByRole("textbox"), { target: { value: `/${name}` } });
  const item = await screen.findByRole("button", { name: new RegExp(`^/${name}`) });
  // Async, so the native dialog's answer also lands inside act.
  await act(async () => {
    fireEvent.click(item);
  });
}

/** Paired: wait for the window to know it, so the command sees the host. */
async function waitForHost(): Promise<void> {
  await screen.findByRole("button", { name: `Connected to Kleio host ${HOST}` });
}

// jsdom implements no layout, so it ships neither scroll API the transcript
// calls on mount. Nor does it play audio or draw on a canvas, which the UI
// sounds and the wake screen try.
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
});

beforeEach(() => {
  openDialog.mockReset();
});

afterEach(() => {
  cleanup();
  clearMocks();
});

describe("/add-dir", () => {
  it("lists the host's folders when paired, and never opens this device's dialog", async () => {
    const session = openSession({ host: HOST, additionalRoots: [] });
    await waitForHost();
    await chooseCommand("add-dir");

    const dialog = await screen.findByRole("dialog", { name: "Open from mac-mini-1" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "api" }));

    await waitFor(() =>
      expect(session.prompts).toEqual(["/add-dir /Users/will/kleio-projects/api"]),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openDialog).not.toHaveBeenCalled();
  });

  it("still opens the native folder dialog in a local session", async () => {
    openDialog.mockResolvedValue("/Users/will/work/docs");
    const session = openSession({ host: null, additionalRoots: [] });
    await chooseCommand("add-dir");

    await waitFor(() => expect(session.prompts).toEqual(["/add-dir /Users/will/work/docs"]));
    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Add project folder to workspace",
    });
    expect(session.calls).not.toContain("agent_project_folders");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("/remove-dir", () => {
  it.each([
    ["local", null],
    ["paired", HOST],
  ])("lists only the session's added folders (%s)", async (_mode, host) => {
    const session = openSession({ host, additionalRoots: ROOTS });
    if (host) await waitForHost();
    await chooseCommand("remove-dir");

    const dialog = await screen.findByRole("dialog", { name: "Remove from workspace" });
    const list = within(dialog).getByRole("list", { name: "Added folders" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((row) => row.title)).toEqual(ROOTS);
    fireEvent.click(within(list).getByRole("button", { name: /^docs/ }));

    await waitFor(() => expect(session.prompts).toEqual(["/remove-dir /Users/will/work/docs"]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openDialog).not.toHaveBeenCalled();
    expect(session.calls).not.toContain("agent_project_folders");
  });

  it("says there is nothing to remove, and opens no picker, with no added folders", async () => {
    const session = openSession({ host: null, additionalRoots: [] });
    await chooseCommand("remove-dir");

    expect(await screen.findByText("No added folders to remove.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(openDialog).not.toHaveBeenCalled();
    expect(session.prompts).toEqual([]);
  });
});
