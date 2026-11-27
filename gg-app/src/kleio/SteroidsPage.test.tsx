// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { SteroidsStatus } from "../agent";

const followers = vi.hoisted(() => new Set<(s: SteroidsStatus) => void>());
vi.mock("../agent", () => ({
  getSteroidsStatus: vi.fn(),
  installSteroids: vi.fn(),
  openUrl: vi.fn(async () => undefined),
  onSteroidsChange: (cb: (s: SteroidsStatus) => void) => {
    followers.add(cb);
    return () => followers.delete(cb);
  },
}));
vi.mock("../toast", () => ({ toast: vi.fn() }));

import { getSteroidsStatus, installSteroids, openUrl } from "../agent";
import { toast } from "../toast";
import { SteroidsPage } from "./SteroidsPage";

const CONNECTED: SteroidsStatus = {
  installed: true,
  connected: true,
  version: "0.9.2",
  repos: 14,
  documents: 48213,
  path: "/Users/you/.gg/steroids",
};
const EMPTY: SteroidsStatus = {
  installed: true,
  connected: false,
  version: "0.9.2",
  repos: 0,
  documents: 0,
};
const BROKEN_ERROR = [
  "steroids status exited with code 101",
  "thread 'main' panicked at src/corpus/store.rs:214:38:",
  `the corpus database is locked: /Users/you/.gg/steroids/${"deep/".repeat(30)}corpus.sqlite`,
].join("\n");
const BROKEN: SteroidsStatus = { installed: true, connected: false, error: BROKEN_ERROR };
const MISSING: SteroidsStatus = { installed: false, connected: false };
const README = "https://github.com/KenKaiii/agent-steroids#readme";
const HINT = "No repos yet. Ask the agent: “curate a Steroids corpus for this project”.";

beforeEach(() => {
  vi.useFakeTimers();
  followers.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// The clock is fake, so no test waits on a real timer inside an act.
const flush = (): Promise<void> => act(async () => {});

/** The page under the screen's own arrangement: the screen holds the status. */
function Held({
  first,
  seen,
}: {
  first: SteroidsStatus | null;
  seen: (s: SteroidsStatus) => void;
}) {
  const [status, setStatus] = useState<SteroidsStatus | null>(first);
  const [onStatus] = useState(() => (next: SteroidsStatus) => {
    seen(next);
    setStatus(next);
  });
  return <SteroidsPage status={status} onStatus={onStatus} />;
}

async function renderPage(probe: SteroidsStatus, first: SteroidsStatus | null = probe) {
  vi.mocked(getSteroidsStatus).mockResolvedValue(probe);
  const seen = vi.fn();
  const view = render(<Held first={first} seen={seen} />);
  await flush();
  return { seen, ...view };
}

const stateLine = (): HTMLElement => screen.getByRole("status");
const stateWords = (): string | null => stateLine().querySelector(".sr-state")?.textContent ?? null;
const corpus = (): string | null => stateLine().querySelector(".sr-corpus")?.textContent ?? null;
const installButton = (): HTMLButtonElement => screen.getByRole("button", { name: /^Install/ });
const filled = (): (string | null)[] =>
  screen
    .queryAllByRole("button")
    .filter((b) => b.classList.contains("primary"))
    .map((b) => b.textContent);

describe("SteroidsPage: reading the status", () => {
  it("probes again on opening and hands the answer up", async () => {
    const { seen } = await renderPage(CONNECTED, null);

    expect(getSteroidsStatus).toHaveBeenCalledOnce();
    expect(seen).toHaveBeenCalledWith(CONNECTED);
    expect(stateWords()).toBe("Connected");
  });

  it("says Checking… on one still line until the status arrives", async () => {
    vi.mocked(getSteroidsStatus).mockReturnValue(new Promise(() => {}));
    render(<Held first={null} seen={vi.fn()} />);
    await flush();

    expect(stateLine().textContent).toBe("Checking…");
    expect(document.querySelector(".skeleton, .list-skeleton")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("It's free and works offline.")).toBeTruthy();
  });

  it("follows an install finished in another window, and stops once it has closed", async () => {
    const { seen, unmount } = await renderPage(MISSING);
    expect(followers.size).toBe(1);

    act(() => {
      for (const follow of followers) follow(EMPTY);
    });

    expect(seen).toHaveBeenLastCalledWith(EMPTY);
    expect(stateWords()).toBe("Empty corpus");
    expect(screen.queryByRole("button")).toBeNull();

    unmount();
    expect(followers.size).toBe(0);
  });
});

describe("SteroidsPage: each state in words", () => {
  it("connected: the state, its mark and the corpus", async () => {
    await renderPage(CONNECTED);

    expect(stateWords()).toBe("Connected");
    expect(stateLine().classList.contains("is-good")).toBe(true);
    expect(stateLine().querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(corpus()).toBe("v0.9.2 · 14 repos · 48k files");
    expect(document.querySelector(".sr-detail")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("counts files under a thousand as they are", async () => {
    await renderPage({ ...CONNECTED, repos: 1, documents: 999 });

    expect(corpus()).toBe("v0.9.2 · 1 repos · 999 files");
  });

  it("an empty corpus: its own mark, the corpus's zeros and what to ask for", async () => {
    await renderPage(EMPTY);

    expect(stateWords()).toBe("Empty corpus");
    expect(stateLine().classList.contains("is-next")).toBe(true);
    expect(corpus()).toBe("v0.9.2 · 0 repos · 0 files");
    const hint = screen.getByText(HINT);
    expect(hint.classList.contains("kl-error")).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("broken: the error whole, as an error, and nothing to install", async () => {
    await renderPage(BROKEN);

    expect(stateWords()).toBe("Broken");
    expect(stateLine().classList.contains("is-bad")).toBe(true);
    expect(corpus()).toBeNull();
    const detail = document.querySelector(".sr-detail");
    expect(detail?.textContent).toBe(BROKEN_ERROR);
    expect(detail?.classList.contains("kl-error")).toBe(true);
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("not installed: a quiet mark and Install, the one filled button", async () => {
    await renderPage(MISSING);

    expect(stateWords()).toBe("Not installed");
    expect(stateLine().classList.contains("is-none")).toBe(true);
    expect(corpus()).toBeNull();
    expect(document.querySelector(".sr-detail")).toBeNull();
    expect(installButton().textContent).toBe("Install Steroids");
    expect(filled()).toEqual(["Install Steroids"]);
  });

  it.each([
    ["connected", CONNECTED],
    ["an empty corpus", EMPTY],
    ["broken", BROKEN],
    ["not installed", MISSING],
  ])("says it's free and offline, in one section, when %s", async (_name, status) => {
    await renderPage(status);

    expect(screen.getByText("It's free and works offline.")).toBeTruthy();
    expect(
      screen.getByText("Lets your agent read current code from real repos first."),
    ).toBeTruthy();
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Status"]);
    expect(screen.queryByRole("button", { name: /remove|uninstall|reset/i })).toBeNull();
  });
});

describe("SteroidsPage: Install", () => {
  it("installs, hands the new status up, toasts, and moves focus to the state", async () => {
    const { seen } = await renderPage(MISSING);
    vi.mocked(installSteroids).mockResolvedValue(EMPTY);
    installButton().focus();

    fireEvent.click(installButton());
    await flush();

    expect(installSteroids).toHaveBeenCalledOnce();
    expect(seen).toHaveBeenLastCalledWith(EMPTY);
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("Steroids 0.9.2 installed.", "success");
    expect(screen.queryByRole("button")).toBeNull();
    expect(stateWords()).toBe("Empty corpus");
    // Install is gone, so focus went to the state rather than nowhere.
    expect(document.activeElement).toBe(stateLine());
  });

  it("leaves focus where it is when Install didn't have it", async () => {
    await renderPage(MISSING);
    vi.mocked(installSteroids).mockResolvedValue(EMPTY);
    const link = screen.getByRole("link");
    fireEvent.click(installButton());
    link.focus();
    await flush();

    expect(stateWords()).toBe("Empty corpus");
    expect(document.activeElement).toBe(link);
  });

  it("says Installing…, keeps focus and ignores a second press while it works", async () => {
    let finish: (s: SteroidsStatus) => void = () => {};
    await renderPage(MISSING);
    vi.mocked(installSteroids).mockReturnValue(
      new Promise<SteroidsStatus>((resolve) => {
        finish = resolve;
      }),
    );
    installButton().focus();
    fireEvent.click(installButton());
    await flush();

    expect(installButton().textContent).toBe("Installing…");
    expect(installButton().getAttribute("aria-disabled")).toBe("true");
    expect(installButton().disabled).toBe(false);
    expect(document.activeElement).toBe(installButton());
    expect(filled()).toEqual([]);

    fireEvent.click(installButton());
    await flush();
    expect(installSteroids).toHaveBeenCalledOnce();

    finish(EMPTY);
    await flush();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why an install failed and keeps Install", async () => {
    const { seen } = await renderPage(MISSING);
    seen.mockClear();
    vi.mocked(installSteroids).mockRejectedValue(new Error("the checksum didn't match"));
    installButton().focus();

    fireEvent.click(installButton());
    await flush();

    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("Install failed: the checksum didn't match", "error");
    expect(seen).not.toHaveBeenCalled();
    expect(installButton().textContent).toBe("Install Steroids");
    expect(installButton().hasAttribute("aria-disabled")).toBe(false);
    expect(filled()).toEqual(["Install Steroids"]);
    expect(document.activeElement).toBe(installButton());
    expect(stateWords()).toBe("Not installed");
  });
});

describe("SteroidsPage: the README", () => {
  it("is one link that says it opens the browser, and opens without navigating", async () => {
    await renderPage(CONNECTED);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Read the README (opens in your browser)" });
    expect(link.getAttribute("href")).toBe(README);
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

    // Not cancelled, the click would leave the app for the address.
    expect(fireEvent.click(link)).toBe(false);
    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(README);
  });
});
