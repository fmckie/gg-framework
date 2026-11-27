// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState, SidecarEvent } from "./agent";

// The real app, review box and accept flow; only the native boundary is mocked.
mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("./App");
const agent = await import("./agent");

const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  // jsdom has no matchMedia; report reduced motion so nothing waits on animation.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearMocks();
  localStorage.clear();
  if (scrollToDescriptor)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

const PLAN = "# Plan\n\n## Steps\n1. Do the first thing\n2. Do the second thing\n";

function harness(acceptOutcome: "ok" | "refused"): {
  accepts: ReturnType<typeof vi.fn>;
  prompts: ReturnType<typeof vi.fn>;
  emit: (event: SidecarEvent) => void;
} {
  const listeners = new Set<(event: SidecarEvent) => void>();
  vi.spyOn(agent, "subscribe").mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  const state: AgentState = {
    cwd: "/workspaces/plan-review",
    mode: "code",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    running: false,
  };
  const accepts = vi.fn();
  const prompts = vi.fn();
  mockWindows("main");
  mockIPC((command, payload) => {
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
      case "agent_accept_plan":
        accepts(payload);
        if (acceptOutcome === "refused") {
          return Promise.reject("cannot accept a plan while the agent is running");
        }
        return null;
      case "agent_prompt":
        prompts(payload);
        return null;
      case "plugin:log|log":
        return null;
      default:
        return new Promise(() => {});
    }
  });
  return {
    accepts,
    prompts,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
  };
}

async function openReview(emit: (event: SidecarEvent) => void): Promise<void> {
  await screen.findByRole("textbox");
  act(() => emit({ type: "plan_review", data: { planPath: "/tmp/plan.md", content: PLAN } }));
  await screen.findByRole("dialog", { name: "Review plan" });
}

describe("plan review accept", () => {
  it("accepts the plan and then sends the implement prompt", async () => {
    const { accepts, prompts, emit } = harness("ok");
    render(<App />);
    await openReview(emit);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(prompts).toHaveBeenCalledTimes(1));
    expect(accepts).toHaveBeenCalledWith(expect.objectContaining({ planPath: "/tmp/plan.md" }));
    expect(screen.queryByRole("dialog", { name: "Review plan" })).toBeNull();
  });

  it("a refused accept explains itself, sends nothing, and re-opens the box", async () => {
    // Before: the refusal was swallowed, the box closed, and "implement it now"
    // went into the planning session — or nothing happened at all.
    const { accepts, prompts, emit } = harness("refused");
    render(<App />);
    await openReview(emit);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await screen.findByText("The plan couldn't be accepted");
    expect(accepts).toHaveBeenCalledTimes(1);
    expect(prompts).not.toHaveBeenCalled();
    const retry = await screen.findByRole("button", { name: "Accept" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("plan review states", () => {
  const NAMED = "# Rate-limit failed logins\n\nWhy.\n\n## Steps\n1. Share the limiter\n";

  async function openNamed(emit: (event: SidecarEvent) => void): Promise<HTMLElement> {
    await screen.findByRole("textbox");
    act(() => emit({ type: "plan_review", data: { planPath: "/tmp/plan.md", content: NAMED } }));
    return screen.findByRole("dialog", { name: "Review plan" });
  }

  it("pending: says it is waiting for your review, as a status, and shows no approved row", async () => {
    const { emit } = harness("ok");
    const { container } = render(<App />);
    const dialog = await openNamed(emit);

    const line = dialog.querySelector(".plan-review-status");
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.textContent).toBe("Waiting for your review");
    expect(container.querySelector(".plan-done")).toBeNull();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("approved: folds the plan into one titled row, takes the actions away, and the transcript goes on", async () => {
    const { accepts, prompts, emit } = harness("ok");
    // As the real sidecar does: the fresh session's reset lands before the accept resolves.
    accepts.mockImplementation(() => emit({ type: "session_reset", data: {} }));
    const { container } = render(<App />);
    await openNamed(emit);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(prompts).toHaveBeenCalledTimes(1));
    const rows = container.querySelectorAll(".plan-done");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe("\u2713Rate-limit failed logins \u00b7 Approved");
    expect(rows[0].getAttribute("role")).toBe("status");
    expect(screen.queryByRole("dialog", { name: "Review plan" })).toBeNull();
    expect(screen.queryByText("Waiting for your review")).toBeNull();
    for (const name of ["Accept", "Reject", "Feedback"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByText(/Plan accepted/)).toBeNull();

    act(() => emit({ type: "run_start", data: {} }));
    act(() => emit({ type: "text_delta", data: { text: "Out of plan mode." } }));
    // The reply's words are drawn one span each, so it is read as a whole row.
    const reply = await waitFor(() => {
      const row = container.querySelector('[data-kind="assistant"]');
      expect(row?.textContent).toContain("Out of plan mode.");
      return row as Element;
    });
    expect(rows[0].compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll(".plan-done")).toHaveLength(1);
  });

  it("approved: a plan with no heading of its own is named Plan", async () => {
    const { prompts, emit } = harness("ok");
    const { container } = render(<App />);
    await screen.findByRole("textbox");
    act(() =>
      emit({ type: "plan_review", data: { planPath: "/tmp/plan.md", content: "1. Do it" } }),
    );
    await screen.findByRole("dialog", { name: "Review plan" });

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(prompts).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".plan-done")?.textContent).toBe("\u2713Plan \u00b7 Approved");
  });

  it("rejected: leaves the rejection's own line and no approved row", async () => {
    const { accepts, prompts, emit } = harness("ok");
    const { container } = render(<App />);
    await openNamed(emit);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(prompts).toHaveBeenCalledTimes(1));
    expect(accepts).not.toHaveBeenCalled();
    expect(screen.getByText("Plan rejected. Nothing was built.")).toBeTruthy();
    expect(container.querySelector(".plan-done")).toBeNull();
    expect(container.textContent).not.toContain("Approved");
    expect(screen.queryByRole("dialog", { name: "Review plan" })).toBeNull();
  });

  it("refused: an accept the sidecar refuses shows no approved row and keeps waiting", async () => {
    const { emit } = harness("refused");
    const { container } = render(<App />);
    await openNamed(emit);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await screen.findByText("The plan couldn't be accepted");
    expect(container.querySelector(".plan-done")).toBeNull();
    expect(await screen.findByText("Waiting for your review")).toBeTruthy();
  });

  it("cancelled: a review withdrawn by a new session leaves no approved row", async () => {
    const { prompts, emit } = harness("ok");
    const { container } = render(<App />);
    await openNamed(emit);

    act(() => emit({ type: "session_reset", data: {} }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review plan" })).toBeNull());
    expect(container.querySelector(".plan-done")).toBeNull();
    expect(screen.queryByText("Waiting for your review")).toBeNull();
    expect(prompts).not.toHaveBeenCalled();
  });

  it("Autopilot approved: shows the same titled row, with Helper's line and reason under it, after the reset", async () => {
    const { accepts, prompts, emit } = harness("ok");
    const { container } = render(<App />);
    await openNamed(emit);

    // The sidecar's own order: the plan, Helper's approval, then the fresh session.
    act(() => emit({ type: "plan_exit", data: { planPath: "/tmp/plan.md", content: NAMED } }));
    act(() => emit({ type: "autopilot_plan_accepted", data: { reason: "Corpus unavailable." } }));
    act(() => emit({ type: "session_reset", data: { planTotal: 1 } }));

    const row = await waitFor(() => {
      const found = container.querySelectorAll(".plan-done");
      expect(found).toHaveLength(1);
      return found[0];
    });
    expect(row.textContent).toBe("\u2713Rate-limit failed logins \u00b7 Approved");
    expect(row.getAttribute("role")).toBe("status");
    const helper = container.querySelector('[data-kind="autopilot"]');
    expect(helper?.textContent).toContain("Plan looks solid. Approved it");
    expect(helper?.textContent).toContain("Corpus unavailable.");
    expect(
      row.compareDocumentPosition(helper as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Review plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    // Helper decided: nothing was accepted or sent from this window.
    expect(accepts).not.toHaveBeenCalled();
    expect(prompts).not.toHaveBeenCalled();
  });

  it("Autopilot rejected: Helper sends the plan back and no approved row shows", async () => {
    const { emit } = harness("ok");
    const { container } = render(<App />);
    await openNamed(emit);

    act(() => emit({ type: "plan_exit", data: { planPath: "/tmp/plan.md", content: NAMED } }));
    act(() => emit({ type: "autopilot_prompted", data: { body: "Cover the lockout case." } }));

    await waitFor(() =>
      expect(container.querySelector('[data-kind="autopilot"]')?.textContent).toContain(
        "Cover the lockout case.",
      ),
    );
    expect(container.querySelector(".plan-done")).toBeNull();
    expect(container.textContent).not.toContain("\u00b7 Approved");
    expect(screen.queryByRole("dialog", { name: "Review plan" })).toBeNull();
  });

  it("the iPhone gets the waiting line and the approved row, as the desktop does", async () => {
    document.documentElement.classList.add("platform-ios");
    try {
      const { prompts, emit } = harness("ok");
      const { container } = render(<App />);
      const dialog = await openNamed(emit);
      expect(dialog.querySelector(".plan-review-status")?.textContent).toBe(
        "Waiting for your review",
      );

      fireEvent.click(screen.getByRole("button", { name: "Accept" }));

      await waitFor(() => expect(prompts).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(container.querySelector(".plan-done")?.textContent).toBe(
          "\u2713Rate-limit failed logins \u00b7 Approved",
        ),
      );
      expect(screen.queryByText(/Plan accepted/)).toBeNull();
    } finally {
      document.documentElement.classList.remove("platform-ios");
    }
  });
});
