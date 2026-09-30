// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { AuthProvider, LocalEndpointRow, SidecarEvent } from "./agent";
import { authStatusWithError, getLocalModels } from "./agent";
import { LoginScreen } from "./LoginScreen";

const listeners = vi.hoisted(() => new Set<(e: SidecarEvent) => void>());

vi.mock("./agent", () => ({
  authStatusWithError: vi.fn(),
  getLocalModels: vi.fn(),
  subscribe: (fn: (e: SidecarEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
}));

vi.mock("./provider-logos", () => ({ providerLogo: () => null }));

function providers(connected: string[]): AuthProvider[] {
  return [
    { value: "anthropic", label: "Anthropic", description: "", methods: ["oauth"] },
    { value: "xai", label: "xAI (Grok)", description: "", methods: ["apikey"] },
  ].map((p) => ({ ...p, connected: connected.includes(p.value) })) as AuthProvider[];
}

function status(connected: string[]): { providers: AuthProvider[]; error: string | null } {
  return { providers: providers(connected), error: null };
}

function endpoint(over: Partial<LocalEndpointRow>): LocalEndpointRow {
  return {
    id: "e",
    label: "Endpoint",
    baseUrl: "http://127.0.0.1:1/v1",
    kind: "custom",
    custom: true,
    reachable: true,
    models: [],
    ...over,
  };
}

const TOOL_MODEL = {
  id: "local/x/m",
  rawId: "m",
  contextWindow: 128_000,
  contextWindowKnown: true,
  supportsTools: true,
  supportsImages: false,
  supportsThinking: false,
};

/** Deliver one frame the way the sidecar/Rust fan-out would. */
async function emit(type: string, data: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    for (const fn of listeners) fn({ type, data } as SidecarEvent);
    await Promise.resolve();
  });
}

async function renderScreen(): Promise<void> {
  await act(async () => {
    render(<LoginScreen onClose={vi.fn()} />);
  });
}

beforeEach(() => {
  listeners.clear();
  vi.mocked(authStatusWithError).mockReset();
  vi.mocked(getLocalModels).mockReset();
  vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
});
afterEach(cleanup);

describe("LoginScreen cross-window auth", () => {
  it("refreshes connection state when another window connects a provider", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(status([]));
    await renderScreen();
    expect(screen.getByText("0 connected")).toBeTruthy();

    // Another window completed a login; auth.json is shared, so this screen is
    // now stale. Without the auth_change subscription it stayed at "0 connected"
    // until the screen was reopened.
    vi.mocked(authStatusWithError).mockResolvedValue(status(["anthropic"]));
    await emit("auth_change", { provider: "anthropic" });

    expect(screen.getByText("1 connected")).toBeTruthy();
  });

  it("refreshes when another window disconnects a provider", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(status(["anthropic"]));
    await renderScreen();
    expect(screen.getByText("1 connected")).toBeTruthy();

    // Logout is native (Rust), so the sidecar never sees it — Rust emits
    // auth_change directly. `auth_done` would be the wrong signal here: nothing
    // logged in.
    vi.mocked(authStatusWithError).mockResolvedValue(status([]));
    await emit("auth_change", { provider: "anthropic" });

    expect(screen.getByText("0 connected")).toBeTruthy();
  });

  it("ignores unrelated agent events", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(status([]));
    await renderScreen();
    expect(authStatusWithError).toHaveBeenCalledTimes(1);

    await emit("text_delta", { text: "hi" });
    await emit("run_end", {});

    // A re-read per streamed token would be absurd.
    expect(authStatusWithError).toHaveBeenCalledTimes(1);
    expect(getLocalModels).toHaveBeenCalledTimes(1);
  });
});

describe("LoginScreen providers", () => {
  it("recommends the private models first, then lists every cloud provider", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(status([]));
    await renderScreen();

    const cards = screen.getAllByRole("region");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Private models",
      "Cloud providers",
    ]);
    const [privateCard, cloudCard] = cards as [HTMLElement, HTMLElement];
    expect(within(privateCard).getByText("Recommended")).toBeTruthy();
    expect(within(privateCard).getByText("Tinfoil")).toBeTruthy();
    expect(within(privateCard).getByText("Ollama")).toBeTruthy();
    expect(within(privateCard).getByTitle("Hugging Face — download models to Ollama")).toBeTruthy();
    expect(within(cloudCard).getByText("Anthropic")).toBeTruthy();
    expect(within(cloudCard).getByText("xAI (Grok)")).toBeTruthy();
  });

  it("shows Tinfoil and Ollama running on the Mac mini, and counts them as connected", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(status([]));
    vi.mocked(getLocalModels).mockResolvedValue({
      endpoints: [
        endpoint({
          id: "tinfoil",
          label: "Tinfoil",
          baseUrl: "http://127.0.0.1:3301/v1",
          models: [TOOL_MODEL, TOOL_MODEL],
        }),
        endpoint({
          id: "ollama",
          label: "Ollama",
          kind: "ollama",
          custom: false,
          reachable: false,
          baseUrl: "http://127.0.0.1:11434/v1",
        }),
      ],
    });
    await renderScreen();

    expect(screen.getByText("2 models")).toBeTruthy();
    expect(screen.getByText("Not running")).toBeTruthy();
    expect(screen.getByText("1 connected")).toBeTruthy();
  });

  it("says why the list is empty when the Mac mini can't answer", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({
      providers: [],
      error: "Still connecting to your Mac mini — try again in a moment.",
    });
    await renderScreen();

    expect(screen.getByRole("status").textContent).toBe(
      "Still connecting to your Mac mini — try again in a moment.",
    );
    // The private models are still offered.
    expect(screen.getByText("Tinfoil")).toBeTruthy();
  });

  it("re-reads the private models when the host rescans them", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue(status([]));
    await renderScreen();
    expect(getLocalModels).toHaveBeenCalledTimes(1);

    vi.mocked(getLocalModels).mockResolvedValue({
      endpoints: [endpoint({ id: "ollama", kind: "ollama", models: [TOOL_MODEL] })],
    });
    await emit("models_change");

    expect(getLocalModels).toHaveBeenCalledTimes(2);
    expect(screen.getByText("1 model")).toBeTruthy();
  });
});
