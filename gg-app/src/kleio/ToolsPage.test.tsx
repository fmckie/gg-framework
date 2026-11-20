// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AddMcpResult, McpServerRow, SidecarEvent } from "../agent";

const listeners = vi.hoisted(() => new Set<(e: SidecarEvent) => void>());
vi.mock("../agent", () => ({
  listMcpServers: vi.fn(),
  addMcpServer: vi.fn(),
  removeMcpServer: vi.fn(),
  loginMcpServer: vi.fn(),
  listProjects: vi.fn(),
  openUrl: vi.fn(async () => undefined),
  subscribe: (fn: (e: SidecarEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
}));
vi.mock("../toast", () => ({ toast: vi.fn() }));

import {
  addMcpServer,
  listMcpServers,
  listProjects,
  loginMcpServer,
  openUrl,
  removeMcpServer,
} from "../agent";
import { toast } from "../toast";
import { leaveSettingsIntent, takeSettingsIntent } from "./settingsIntent";
import { MAX_TICKS, ToolsPage, heldBack, serverShortForm } from "./ToolsPage";

function server(name: string, over: Partial<McpServerRow> = {}): McpServerRow {
  return {
    name,
    scope: "global",
    ok: true,
    toolCount: 3,
    kind: "http",
    summary: `https://mcp.example.com/${name}`,
    ...over,
  };
}

// The sidecar's own sentences today (mcp-rows.ts and client.ts): a held-back
// row is recognised by them, so a change there must fail here.
const UNTRUSTED =
  "Project-scope server not connected — this repo's .gg/mcp.json runs repo-controlled commands. Add or re-add a server in this project via the MCP modal to trust it.";
const FLAGGED =
  'MCP server "left-pad-mcp" not started. Blocked install (known-malware): left-pad-mcp@9.9.9 is reported as malware.';

const KEYED_ADDRESS =
  "https://user:made-up-pass@mcp.example.com:8443/v1/made-up-path-key/mcp?api_key=made-up-query-key";
const KEYED_COMMAND = "/usr/local/bin/node /srv/mcp/server.js --api-key made-up-flag-key";

const SEARCH = server("search");
const FILES = server("files", {
  kind: "stdio",
  summary: "npx -y files-mcp ~/Projects",
  toolCount: 11,
});
const NOTION = server("notion", { ok: false, toolCount: 0, requiresAuth: true, error: "401" });
const AIRTABLE = server("airtable", {
  ok: false,
  toolCount: 0,
  kind: "stdio",
  summary: KEYED_COMMAND,
  error: "Process exited with code 1\nError: Cannot find module 'airtable'",
});
const DOWN = server("down", { ok: false, toolCount: 0, summary: KEYED_ADDRESS, error: "HTTP 503" });
const REPO = server("repo-docs", {
  scope: "project",
  ok: false,
  toolCount: 0,
  kind: "stdio",
  summary: "node ./tools/docs.js --token made-up-token",
  error: UNTRUSTED,
});
const PAD = server("left-pad-mcp", {
  ok: false,
  toolCount: 0,
  kind: "stdio",
  summary: "npx -y left-pad-mcp@9.9.9",
  error: FLAGGED,
});

function emit(type: string, data: Record<string, unknown>): void {
  act(() => {
    for (const fn of listeners) fn({ type, data } as SidecarEvent);
  });
}

beforeEach(() => {
  takeSettingsIntent();
  vi.mocked(listMcpServers).mockResolvedValue([SEARCH, FILES]);
  vi.mocked(listProjects).mockResolvedValue([
    { name: "example-app", path: "/work/example-app", lastActiveDisplay: "", sources: [] },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listeners.clear();
});

async function renderPage(servers?: McpServerRow[]): Promise<void> {
  if (servers) vi.mocked(listMcpServers).mockResolvedValue(servers);
  await act(async () => {
    render(<ToolsPage />);
  });
}

const row = (name: string): HTMLElement =>
  document.querySelector<HTMLElement>(`.tl-row[data-server="${name}"]`) as HTMLElement;
const ticks = (name: string): number => row(name).querySelectorAll(".tl-tick").length;
const field = (): HTMLInputElement =>
  screen.getByLabelText<HTMLInputElement>("Server's add command");
const addButton = (): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Add" });
const removeGroup = (): HTMLElement => screen.getByRole("region", { name: "Remove" });

async function chooseProject(path: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Project" }));
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Project path"), { target: { value: path } });
  });
}

describe("ToolsPage's words", () => {
  it("says what a server is and what to paste, and never names a modal", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "Servers" })).toBeTruthy();
    expect(screen.getByText("An MCP server gives your agents extra tools.")).toBeTruthy();
    expect(
      screen.getByText(
        "Paste the server's add command. It's saved to every session, and loads after Kleio restarts.",
      ),
    ).toBeTruthy();
    expect(field().placeholder).toBe(
      "claude mcp add --transport http notion https://mcp.notion.com/mcp",
    );
    expect(document.body.textContent).not.toMatch(/MCP modal/i);
  });

  it("says so while it reads, and when there are none", async () => {
    let done: (rows: McpServerRow[]) => void = () => {};
    vi.mocked(listMcpServers).mockReturnValue(new Promise((r) => (done = r)));
    await renderPage();
    expect(screen.getByText("Reading your MCP config…")).toBeTruthy();
    await act(async () => done([]));
    expect(
      screen.getByText("No servers yet. Add one below, and its tools appear here."),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
  });
});

describe("ToolsPage's scope", () => {
  it("shows only the chosen scope's servers", async () => {
    await renderPage([SEARCH, REPO]);
    expect(row("search")).not.toBeNull();
    expect(row("repo-docs")).toBeNull();
    expect(screen.getByRole("button", { name: "Global" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByLabelText("Project path")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(row("search")).toBeNull();
    expect(row("repo-docs")).not.toBeNull();
    expect(within(removeGroup()).queryByText("search")).toBeNull();
    expect(
      screen.getByText(/It's saved to this project, and loads after Kleio restarts\./),
    ).toBeTruthy();
  });

  it("offers the project's path under Project, and reads the list again with it", async () => {
    await renderPage();
    expect(listMcpServers).toHaveBeenLastCalledWith(undefined);
    await chooseProject("/work/example-app");
    expect(listMcpServers).toHaveBeenLastCalledWith("/work/example-app");
    const options = [...document.querySelectorAll("datalist option")];
    expect(options.map((o) => o.getAttribute("value"))).toEqual(["/work/example-app"]);
    expect(screen.getByLabelText("Project path").getAttribute("list")).toBe(
      document.querySelector("datalist")?.id,
    );
  });

  it("checks again with the folder the list was read with, keeping the rows meanwhile", async () => {
    await renderPage([SEARCH, REPO]);
    await chooseProject("/work/example-app");
    const calls = vi.mocked(listMcpServers).mock.calls.length;
    let done: (rows: McpServerRow[]) => void = () => {};
    vi.mocked(listMcpServers).mockReturnValue(new Promise((r) => (done = r)));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(vi.mocked(listMcpServers).mock.calls.length).toBe(calls + 1);
    expect(listMcpServers).toHaveBeenLastCalledWith("/work/example-app");
    // Still there while it reads.
    expect(row("repo-docs")).not.toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Checking…" }).disabled).toBe(
      true,
    );
    await act(async () => done([REPO]));
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });
});

describe("ToolsPage's rows", () => {
  it("draws a tick for each tool, and counts those past the most it draws", async () => {
    await renderPage([
      server("one", { toolCount: 1 }),
      FILES,
      server("everything", { toolCount: 412 }),
    ]);
    expect(ticks("one")).toBe(1);
    expect(ticks("files")).toBe(11);
    expect(ticks("everything")).toBe(MAX_TICKS);
    expect(row("everything").querySelector(".tl-more")?.textContent).toBe("+292");
    expect(row("files").querySelector(".tl-more")).toBeNull();
    // The count beside them is always the true number.
    expect(row("everything").querySelector(".tl-count")?.textContent).toBe("412");
    expect(within(row("everything")).getByRole("img", { name: "412 tools" })).toBeTruthy();
    expect(within(row("one")).getByRole("img", { name: "1 tool" })).toBeTruthy();
    expect(
      screen.getByText("Each tick is a tool your agents can call: 424 tools in all."),
    ).toBeTruthy();
  });

  it("gives a server that didn't load a stub and says which kind in words", async () => {
    await renderPage([NOTION, AIRTABLE, PAD]);
    for (const [name, words] of [
      ["notion", "needs sign-in"],
      ["airtable", "failed"],
      ["left-pad-mcp", "held back"],
    ] as const) {
      expect(ticks(name)).toBe(4);
      expect(row(name).querySelector(".tl-tick-run")).not.toBeNull();
      expect(row(name).querySelector(".tl-count")?.textContent).toBe(words);
      expect(
        within(row(name)).getByRole("img", { name: `No tools loaded: ${words}` }),
      ).toBeTruthy();
    }
    // No ticks to explain: the caption says what that means instead of "0 tools in all".
    expect(
      screen.getByText("None of these servers has loaded, so your agents have no tools from them."),
    ).toBeTruthy();
    expect(screen.queryByText(/Each tick is a tool/)).toBeNull();
    expect(row("notion").className).toContain("is-auth");
    expect(row("airtable").className).toContain("is-failed");
    expect(row("left-pad-mcp").className).toContain("is-held");
  });

  it("shortens an address to its host and a command to its program", () => {
    expect(serverShortForm({ kind: "http", summary: "https://mcp.notion.com/mcp" })).toBe(
      "http · mcp.notion.com",
    );
    expect(serverShortForm({ kind: "http", summary: KEYED_ADDRESS })).toBe(
      "http · mcp.example.com:8443",
    );
    expect(serverShortForm({ kind: "stdio", summary: "npx -y files-mcp ~/Projects" })).toBe(
      "stdio · npx",
    );
    expect(serverShortForm({ kind: "stdio", summary: KEYED_COMMAND })).toBe("stdio · node");
    expect(serverShortForm({ kind: "stdio", summary: "C:\\tools\\uvx.exe everything" })).toBe(
      "stdio · uvx.exe",
    );
    // Neither can be read: the kind alone.
    expect(serverShortForm({ kind: "http", summary: "not an address" })).toBe("http");
    expect(serverShortForm({ kind: "stdio", summary: "" })).toBe("stdio");
    expect(serverShortForm({ kind: "stdio", summary: "TOKEN=made-up-key node x.js" })).toBe(
      "stdio",
    );
  });

  it("keeps a command's arguments and an address's path, query and sign-in part out of the row", async () => {
    await renderPage([DOWN, AIRTABLE, REPO, PAD]);
    expect(within(row("down")).getByText("http · mcp.example.com:8443")).toBeTruthy();
    expect(within(row("airtable")).getByText("stdio · node")).toBeTruthy();
    const shown = document.querySelector(".tl-page")?.textContent ?? "";
    for (const secret of ["made-up", "api_key", "--api-key", "/v1/", "server.js", "user:"])
      expect(shown).not.toContain(secret);
    // The whole text is the name's tooltip, as it always was.
    expect(within(row("down")).getByText("down").getAttribute("title")).toBe(KEYED_ADDRESS);
  });

  it("keeps the notes: why a server failed, and the tools the guard hid", async () => {
    const warning = [1, 2, 3, 4, 5]
      .map(
        (n) => `MCP tool "t${n}" from server "search" hidden: it tells the model to ignore rules.`,
      )
      .join("\n");
    await renderPage([{ ...SEARCH, warning }, AIRTABLE]);
    const hidden = within(row("search")).getByRole("list", { name: "Notes for search" });
    expect(
      within(hidden)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      'MCP tool "t1" hidden: it tells the model to ignore rules.',
      'MCP tool "t2" hidden: it tells the model to ignore rules.',
      'MCP tool "t3" hidden: it tells the model to ignore rules.',
      "and 2 more hidden",
    ]);
    // Still working: its mark and its ticks are a working server's.
    expect(row("search").className).toContain("is-ok");
    expect(ticks("search")).toBe(3);
    // Only the first line of a long error.
    const why = within(row("airtable")).getByRole("list", { name: "Notes for airtable" });
    expect(
      within(why)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Process exited with code 1"]);
  });
});

describe("ToolsPage's sign-in", () => {
  it("is a quiet button that starts the login and says so until it ends", async () => {
    vi.mocked(loginMcpServer).mockResolvedValue(undefined);
    await renderPage([SEARCH, NOTION]);
    const signIn = within(row("notion")).getByRole<HTMLButtonElement>("button", {
      name: "Sign in",
    });
    expect(signIn.className).not.toContain("btn-primary");
    expect(signIn.title).toBe('Sign in to "notion"');
    await act(async () => {
      fireEvent.click(signIn);
    });
    expect(loginMcpServer).toHaveBeenCalledExactlyOnceWith("notion", "global", undefined);
    const waiting = within(row("notion")).getByRole<HTMLButtonElement>("button", {
      name: "Signing in…",
    });
    expect(waiting.disabled).toBe(true);

    emit("mcp_auth_url", { name: "notion", url: "https://auth.example/start" });
    expect(openUrl).toHaveBeenCalledWith("https://auth.example/start");
    expect(toast).toHaveBeenCalledWith('Opening your browser to sign in to "notion"…', "info");

    const reads = vi.mocked(listMcpServers).mock.calls.length;
    vi.mocked(listMcpServers).mockResolvedValue([SEARCH, server("notion", { toolCount: 9 })]);
    await act(async () => {
      emit("mcp_auth_done", { name: "notion", toolCount: 9 });
    });
    expect(toast).toHaveBeenCalledWith('Signed in to "notion" — 9 tools.', "success");
    expect(vi.mocked(listMcpServers).mock.calls.length).toBe(reads + 1);
    expect(ticks("notion")).toBe(9);
    expect(within(row("notion")).queryByRole("button")).toBeNull();
  });

  it("signs in to a project's server in the project it was listed under", async () => {
    vi.mocked(loginMcpServer).mockResolvedValue(undefined);
    await renderPage([{ ...NOTION, scope: "project" }]);
    await chooseProject("/work/example-app");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    expect(loginMcpServer).toHaveBeenCalledWith("notion", "project", "/work/example-app");
  });

  it("says why a login failed or couldn't start, and offers Sign in again", async () => {
    vi.mocked(loginMcpServer).mockResolvedValue(undefined);
    await renderPage([NOTION]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    emit("mcp_auth_error", { name: "notion", message: "access denied" });
    expect(toast).toHaveBeenCalledWith('Login failed for "notion": access denied', "error");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign in" }).disabled).toBe(false);

    vi.mocked(loginMcpServer).mockRejectedValue(new Error("not an HTTP server"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    expect(toast).toHaveBeenCalledWith("not an HTTP server", "error");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign in" }).disabled).toBe(false);
  });
});

describe("ToolsPage's Fix", () => {
  const fix = (name: string): HTMLElement =>
    within(row(name)).getByRole("button", { name: `Fix ${name}` });

  it("opens and closes three steps under the row, and says which", async () => {
    await renderPage([SEARCH, AIRTABLE]);
    expect(within(row("search")).queryByRole("button")).toBeNull();
    const button = fix("airtable");
    expect(button.textContent).toBe("Fix");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const steps = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(steps?.hidden).toBe(true);
    expect(row("airtable").contains(steps)).toBe(true);

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(steps?.hidden).toBe(false);
    const items = within(steps as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("Run its command in Terminal to see why it stops.");
    // Only now is the whole command on the page.
    expect(items[0]?.querySelector("code")?.textContent).toBe(KEYED_COMMAND);
    expect(items[1]?.textContent).toBe("Fix what it reports there.");
    expect(items[2]?.textContent).toBe("Press Check again.");
    expect(steps?.textContent).not.toMatch(/Restart Kleio/);

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(steps?.hidden).toBe(true);
    expect(steps?.textContent).toBe("");
  });

  it("gives an address its own first step, and copies it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderPage([DOWN, AIRTABLE]);
    fireEvent.click(fix("down"));
    const steps = [...row("down").querySelectorAll(".tl-steps > li")];
    expect(steps).toHaveLength(3);
    expect(steps[0]?.textContent).toContain("Check this address opens and the server is up.");
    expect(steps[0]?.querySelector("code")?.textContent).toBe(KEYED_ADDRESS);
    await act(async () => {
      fireEvent.click(within(row("down")).getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(KEYED_ADDRESS);
    expect(within(row("down")).getByRole("button", { name: "Copied" })).toBeTruthy();
    // One server's steps at a time.
    fireEvent.click(fix("airtable"));
    expect(fix("down").getAttribute("aria-expanded")).toBe("false");
    expect(fix("airtable").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ToolsPage's held-back servers", () => {
  it("recognises the sidecar's two sentences, and nothing else", () => {
    expect(heldBack(REPO)?.why).toBe("Not started. This project's servers aren't trusted yet.");
    expect(heldBack(PAD)?.why).toBe(
      "Blocked install (known-malware): left-pad-mcp@9.9.9 is reported as malware.",
    );
    expect(
      heldBack(server("x", { ok: false, error: "Blocked: x@1.0.0 is known malware" }))?.why,
    ).toBe("Blocked: x@1.0.0 is known malware");
    expect(heldBack(AIRTABLE)).toBeNull();
    expect(heldBack(NOTION)).toBeNull();
    expect(heldBack(SEARCH)).toBeNull();
    // Only as the reason itself, not wherever the word turns up.
    expect(heldBack(server("y", { ok: false, error: "connect: Blocked by firewall" }))).toBeNull();
  });

  it("offers a project that isn't trusted no Fix and no command, and says what to do", async () => {
    await renderPage([REPO]);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    const r = row("repo-docs");
    expect(within(r).queryByRole("button")).toBeNull();
    expect(
      within(r).getByText("Not started. This project's servers aren't trusted yet."),
    ).toBeTruthy();
    expect(
      within(r).getByText(
        "If you trust this project, add one of its servers again below, with Project chosen.",
      ),
    ).toBeTruthy();
    expect(r.textContent).not.toMatch(/MCP modal|repo-controlled|docs\.js|made-up/);
    expect(r.querySelector("code")).toBeNull();
    expect(within(r).getByText("stdio · node")).toBeTruthy();
  });

  it("offers a flagged package no Fix and no command, in the guard's own words", async () => {
    const warning = 'MCP tool "t1" from server "left-pad-mcp" hidden: reason.';
    await renderPage([{ ...PAD, warning }]);
    const r = row("left-pad-mcp");
    expect(within(r).queryByRole("button")).toBeNull();
    expect(
      within(r).getByText(
        "Blocked install (known-malware): left-pad-mcp@9.9.9 is reported as malware.",
      ),
    ).toBeTruthy();
    expect(within(r).getByText("Remove it under Remove unless you're sure of it.")).toBeTruthy();
    expect(r.querySelector("code")).toBeNull();
    // Its reason is said once; any hidden-tool notes still follow.
    expect(r.textContent?.match(/Blocked install/g)).toHaveLength(1);
    expect(
      within(r)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(['MCP tool "t1" hidden: reason.']);
    // It can still be removed.
    expect(within(removeGroup()).getByRole("button", { name: "Remove left-pad-mcp" })).toBeTruthy();
  });
});

describe("ToolsPage's Add", () => {
  const added = (over: Partial<AddMcpResult> = {}): AddMcpResult => ({
    ok: true,
    name: "linear",
    connected: true,
    toolCount: 14,
    ...over,
  });
  const LINE = "claude mcp add --transport http linear https://mcp.linear.example/mcp";

  it("adds what was pasted, by its button, then reads the list again", async () => {
    vi.mocked(addMcpServer).mockResolvedValue(added());
    await renderPage();
    expect(addButton().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: `  ${LINE}  ` } });
    expect(addButton().disabled).toBe(false);
    const reads = vi.mocked(listMcpServers).mock.calls.length;
    await act(async () => {
      fireEvent.click(addButton());
    });
    expect(addMcpServer).toHaveBeenCalledExactlyOnceWith(LINE, "global", undefined);
    expect(toast).toHaveBeenCalledWith('Added "linear" — 14 tools.', "success");
    expect(field().value).toBe("");
    expect(vi.mocked(listMcpServers).mock.calls.length).toBe(reads + 1);
    expect(listMcpServers).toHaveBeenLastCalledWith(undefined);
  });

  it("adds on Enter, to the chosen project", async () => {
    vi.mocked(addMcpServer).mockResolvedValue(added({ connected: false, requiresAuth: true }));
    await renderPage();
    await chooseProject("/work/example-app");
    fireEvent.change(field(), { target: { value: LINE } });
    // Enter in the field submits its form.
    expect(field().form).toBe(addButton().form);
    expect(addButton().type).toBe("submit");
    await act(async () => {
      fireEvent.submit(field().form as HTMLFormElement);
    });
    expect(addMcpServer).toHaveBeenCalledExactlyOnceWith(LINE, "project", "/work/example-app");
    expect(toast).toHaveBeenCalledWith('Added "linear". Click "Sign in" to connect.', "info");
    expect(listMcpServers).toHaveBeenLastCalledWith("/work/example-app");
  });

  it("says when a server was saved but didn't connect, and why an add failed", async () => {
    vi.mocked(addMcpServer).mockResolvedValue(added({ connected: false, error: "HTTP 503" }));
    await renderPage();
    fireEvent.change(field(), { target: { value: LINE } });
    await act(async () => {
      fireEvent.click(addButton());
    });
    expect(toast).toHaveBeenCalledWith('Saved "linear" (not connected: HTTP 503).', "warning");

    vi.mocked(addMcpServer).mockRejectedValue(new Error("Expected: claude mcp add …"));
    fireEvent.change(field(), { target: { value: "nonsense" } });
    await act(async () => {
      fireEvent.click(addButton());
    });
    expect(toast).toHaveBeenCalledWith("Expected: claude mcp add …", "error");
    // What was typed is kept, to be put right.
    expect(field().value).toBe("nonsense");
  });

  it("warns under Project with no path, and adds nothing", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.change(field(), { target: { value: LINE } });
    await act(async () => {
      fireEvent.click(addButton());
    });
    expect(toast).toHaveBeenCalledWith("Enter or pick a project path first.", "warning");
    expect(addMcpServer).not.toHaveBeenCalled();
  });

  it("is the page's one filled button only while there are no servers, and then points at the field", async () => {
    await renderPage([]);
    expect(addButton().className).toContain("btn-primary");
    expect(document.querySelectorAll(".tl-page .btn-primary")).toHaveLength(1);
    expect(addButton().disabled).toBe(false);
    fireEvent.click(addButton());
    expect(addMcpServer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field());
    cleanup();

    await renderPage([SEARCH, NOTION, AIRTABLE]);
    expect(addButton().className).not.toContain("btn-primary");
    expect(document.querySelectorAll(".tl-page .btn-primary")).toHaveLength(0);
  });
});

describe("ToolsPage's Remove", () => {
  const ask = (name: string): HTMLElement =>
    within(removeGroup()).getByRole("button", { name: `Remove ${name}` });
  const confirm = (): HTMLElement => within(removeGroup()).getByRole("button", { name: "Remove" });

  it("holds one item per server on show and asks before removing", async () => {
    vi.mocked(removeMcpServer).mockResolvedValue({ removed: true });
    await renderPage([SEARCH, FILES, NOTION]);
    expect(
      [...removeGroup().querySelectorAll(".st-danger-what")].map((el) => el.textContent),
    ).toEqual(["search", "files", "notion"]);
    // No remove control on a row any more.
    expect(
      document.querySelector(".tl-rows [aria-label^='Delete'], .tl-rows .mcp-delete"),
    ).toBeNull();

    fireEvent.click(ask("files"));
    expect(removeMcpServer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    expect(
      screen.getByText(
        "Your agents lose its 11 tools, and any sign-in saved for it. Add it again to bring it back.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(removeMcpServer).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ask("files"));

    fireEvent.click(ask("files"));
    vi.mocked(listMcpServers).mockResolvedValue([SEARCH, NOTION]);
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(removeMcpServer).toHaveBeenCalledExactlyOnceWith("files", "global", undefined);
    expect(toast).toHaveBeenCalledWith('Removed "files".', "success");
    expect(row("files")).toBeNull();
    // Focus goes to the item now in its place.
    expect(document.activeElement).toBe(ask("notion"));
  });

  it("moves focus to the field when the last server goes", async () => {
    vi.mocked(removeMcpServer).mockResolvedValue({ removed: true });
    await renderPage([SEARCH]);
    fireEvent.click(ask("search"));
    vi.mocked(listMcpServers).mockResolvedValue([]);
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("removes a project's server from the project it was listed under", async () => {
    vi.mocked(removeMcpServer).mockResolvedValue({ removed: true });
    await renderPage([REPO]);
    await chooseProject("/work/example-app");
    fireEvent.click(ask("repo-docs"));
    // Nothing loaded, so no tool count to lose.
    expect(
      screen.getByText(
        "It's taken out of your MCP config, with any sign-in saved for it. Add it again to bring it back.",
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(removeMcpServer).toHaveBeenCalledExactlyOnceWith(
      "repo-docs",
      "project",
      "/work/example-app",
    );
    expect(listMcpServers).toHaveBeenLastCalledWith("/work/example-app");
  });

  it("says when nothing was removed, and keeps the server", async () => {
    vi.mocked(removeMcpServer).mockResolvedValue({ removed: false });
    await renderPage([SEARCH, FILES]);
    fireEvent.click(ask("search"));
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(within(removeGroup()).getByRole("alert").textContent).toBe('No "search" found.');
    expect(toast).not.toHaveBeenCalledWith('Removed "search".', "success");
    expect(row("search")).not.toBeNull();

    vi.mocked(removeMcpServer).mockRejectedValue(new Error("sidecar not ready"));
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(within(removeGroup()).getByRole("alert").textContent).toBe("sidecar not ready");
  });
});

describe("ToolsPage, arriving from Overview's Fix", () => {
  it("opens the first failed server's steps and puts focus on them, once", async () => {
    leaveSettingsIntent("tools-fix");
    await renderPage([SEARCH, NOTION, PAD, AIRTABLE, DOWN]);
    const button = within(row("airtable")).getByRole("button", { name: "Fix airtable" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("airtable")).getByRole("heading", { name: "How to fix it" }),
      ),
    );
    expect(
      within(row("down")).getByRole("button", { name: "Fix down" }).getAttribute("aria-expanded"),
    ).toBe("false");
    // The note is gone, and closing stays closed through the next read.
    expect(takeSettingsIntent()).toBeNull();
    fireEvent.click(button);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    });
    expect(
      within(row("airtable"))
        .getByRole("button", { name: "Fix airtable" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("goes to a held-back server's reason when none failed, without pressing anything", async () => {
    leaveSettingsIntent("tools-fix");
    await renderPage([SEARCH, NOTION, PAD]);
    await waitFor(() =>
      expect(document.activeElement).toBe(row("left-pad-mcp").querySelector(".tl-held")),
    );
    expect(loginMcpServer).not.toHaveBeenCalled();
  });

  it("goes to the first Sign in when only sign-ins are needed, without pressing it", async () => {
    leaveSettingsIntent("tools-fix");
    await renderPage([SEARCH, NOTION]);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row("notion")).getByRole("button", { name: "Sign in" }),
      ),
    );
    expect(loginMcpServer).not.toHaveBeenCalled();
  });

  it("shows the project's servers when that is where the fault is", async () => {
    leaveSettingsIntent("tools-fix");
    await renderPage([SEARCH, REPO]);
    await waitFor(() =>
      expect(document.activeElement).toBe(row("repo-docs")?.querySelector(".tl-held")),
    );
    expect(screen.getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("moves nothing when the tab is opened any other way", async () => {
    await renderPage([SEARCH, AIRTABLE]);
    expect(
      within(row("airtable"))
        .getByRole("button", { name: "Fix airtable" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(document.activeElement).toBe(document.body);
  });
});
