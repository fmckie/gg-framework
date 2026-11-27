// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AuthMethod, AuthProvider, LocalEndpointRow, SidecarEvent } from "../agent";
import { SettingsHeaderProvider } from "../settings-header";
import { ProvidersPage } from "./ProvidersPage";

const listeners = vi.hoisted(() => new Set<(e: SidecarEvent) => void>());
const native = vi.hoisted(() => ({
  authStatusWithError: vi.fn(),
  getLocalModels: vi.fn(),
  scanLocalModels: vi.fn(async () => ({ endpoints: [] })),
  hfPullStatus: vi.fn(async () => null),
  hfSearch: vi.fn(async () => []),
  hfPull: vi.fn(),
}));

vi.mock("../agent", () => ({
  ...native,
  isHfPullEvent: () => false,
  subscribe: (fn: (e: SidecarEvent) => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
}));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("../provider-logos", () => ({ providerLogo: () => undefined }));

const CLOUD: { value: string; label: string; methods: AuthMethod[] }[] = [
  { value: "anthropic", label: "Anthropic", methods: ["oauth"] },
  { value: "xai", label: "xAI (Grok)", methods: ["oauth", "apikey"] },
  { value: "glm", label: "Z.AI (GLM)", methods: ["apikey"] },
];

/** The cloud providers, with `connected` signed in by the methods given. */
function providers(connected: Record<string, AuthMethod[]>): AuthProvider[] {
  return CLOUD.map((p) => {
    const got = connected[p.value] ?? [];
    return {
      ...p,
      description: "",
      connected: got.length > 0,
      connectedMethods: got,
      ...(got[0] ? { activeMethod: got[0] } : {}),
    };
  }) as AuthProvider[];
}

function status(connected: Record<string, AuthMethod[]> = {}): {
  providers: AuthProvider[];
  error: string | null;
} {
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

/** The page inside a header with a status slot, as the Settings screen gives it. */
function Page(): React.ReactElement {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <header ref={setSlot} />
      <SettingsHeaderProvider slots={{ status: slot, actions: null }}>
        <ProvidersPage />
      </SettingsHeaderProvider>
    </>
  );
}

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<Page />);
  });
}

const privateList = (): HTMLElement => screen.getByRole("list", { name: "Private models" });
const connectedList = (): HTMLElement | null =>
  screen.queryByRole("list", { name: "Connected cloud providers" });
const addSection = (): HTMLElement => screen.getByRole("region", { name: "Add a provider" });
const names = (list: HTMLElement): (string | null)[] =>
  within(list)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

const PRIVATE_LINE =
  "Inside the ring, models run on your host or in secure hardware, so your chats stay yours.";

beforeEach(() => {
  listeners.clear();
  native.authStatusWithError.mockReset();
  native.getLocalModels.mockReset();
  native.getLocalModels.mockResolvedValue({ endpoints: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProvidersPage across windows", () => {
  it("follows a sign-in in another window", async () => {
    native.authStatusWithError.mockResolvedValue(status());
    await renderPage();
    expect(screen.getByText("0 connected")).toBeTruthy();
    expect(connectedList()).toBeNull();

    native.authStatusWithError.mockResolvedValue(status({ anthropic: ["oauth"] }));
    await emit("auth_change", { provider: "anthropic" });

    expect(screen.getByText("1 connected")).toBeTruthy();
    expect(names(connectedList() as HTMLElement)).toEqual([
      "Anthropic: connected with OAuth. Manage",
    ]);
  });

  it("follows a sign-out in another window", async () => {
    native.authStatusWithError.mockResolvedValue(status({ anthropic: ["oauth"] }));
    await renderPage();
    expect(screen.getByText("1 connected")).toBeTruthy();

    native.authStatusWithError.mockResolvedValue(status());
    await emit("auth_change", { provider: "anthropic" });

    expect(screen.getByText("0 connected")).toBeTruthy();
    expect(connectedList()).toBeNull();
  });

  it("re-reads nothing for unrelated events", async () => {
    native.authStatusWithError.mockResolvedValue(status());
    await renderPage();
    expect(native.authStatusWithError).toHaveBeenCalledTimes(1);

    await emit("text_delta", { text: "hi" });
    await emit("run_end", {});

    expect(native.authStatusWithError).toHaveBeenCalledTimes(1);
    expect(native.getLocalModels).toHaveBeenCalledTimes(1);
  });

  it("re-reads the private models when the host rescans them", async () => {
    native.authStatusWithError.mockResolvedValue(status());
    await renderPage();
    expect(native.getLocalModels).toHaveBeenCalledTimes(1);

    native.getLocalModels.mockResolvedValue({
      endpoints: [endpoint({ id: "ollama", kind: "ollama", models: [TOOL_MODEL] })],
    });
    await emit("models_change");

    expect(native.getLocalModels).toHaveBeenCalledTimes(2);
    expect(within(privateList()).getByText("1 model")).toBeTruthy();
  });
});

describe("ProvidersPage", () => {
  it("reads the private models first, then the connected providers, the caption, and Add a provider", async () => {
    native.authStatusWithError.mockResolvedValue(status({ anthropic: ["oauth"] }));
    await renderPage();
    const page = document.querySelector(".pv-page");
    const order = [
      privateList(),
      connectedList() as HTMLElement,
      screen.getByText(/^Inside the ring/),
      addSection(),
    ];
    for (const [i, el] of order.entries()) {
      expect(page?.contains(el)).toBe(true);
      const next = order[i + 1];
      if (next)
        expect(el.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(names(privateList())).toEqual([
      "Tinfoil: Set up on host",
      "Ollama: No key needed",
      "Hugging Face: Download models",
    ]);
    // The tiles' two section titles and the Recommended badge are gone: the ring says it.
    expect(screen.queryByText("Recommended")).toBeNull();
    expect(screen.queryByText("Cloud providers")).toBeNull();
  });

  it("labels the ring Private, and never claims the models are on your hardware", async () => {
    native.authStatusWithError.mockResolvedValue(status());
    await renderPage();
    expect(screen.getByText("Private")).toBeTruthy();
    // Tinfoil runs in secure hardware that isn't yours.
    expect(document.body.textContent).not.toMatch(/on your hardware/i);
    expect(
      within(privateList()).getByTitle(/^Tinfoil — private AI in secure hardware/),
    ).toBeTruthy();
  });

  it("says what Tinfoil and Ollama are doing on the host, marks them, and counts them as connected", async () => {
    native.authStatusWithError.mockResolvedValue(status());
    native.getLocalModels.mockResolvedValue({
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
    await renderPage();

    expect(names(privateList())).toEqual([
      "Tinfoil: 2 models",
      "Ollama: Not running",
      "Hugging Face: Download models",
    ]);
    expect(screen.getByText("1 connected")).toBeTruthy();
    const marks = within(privateList())
      .getAllByRole("button")
      .map((b) => b.querySelector(".pv-dot")?.className ?? null);
    // Filled when it answers, hollow when it doesn't; Hugging Face is an action and has no mark.
    expect(marks).toEqual(["pv-dot is-on", "pv-dot", null]);
  });

  it("says Running for a server that answers with no model able to run the agent", async () => {
    native.authStatusWithError.mockResolvedValue(status());
    native.getLocalModels.mockResolvedValue({
      endpoints: [endpoint({ id: "ollama", kind: "ollama", models: [] })],
    });
    await renderPage();
    expect(names(privateList())[1]).toBe("Ollama: Running");
  });

  it("puts a connected provider outside the ring, with how it is signed in, and not under Add", async () => {
    native.authStatusWithError.mockResolvedValue(
      status({ anthropic: ["oauth"], xai: ["oauth", "apikey"] }),
    );
    await renderPage();
    const outside = connectedList() as HTMLElement;
    expect(names(outside)).toEqual([
      "Anthropic: connected with OAuth. Manage",
      "xAI (Grok): connected with OAuth and API key. Manage",
    ]);
    expect(privateList().contains(outside)).toBe(false);
    // Which sign-in is in use, as the tiles said.
    expect(
      within(outside)
        .getAllByTitle(/ — connected, /)
        .map((el) => [el.textContent, el.getAttribute("title")]),
    ).toEqual([
      ["OAuth", "OAuth — connected, in use"],
      ["OAuth", "OAuth — connected, in use"],
      ["API key", "API key — connected, standby"],
    ]);
    // Add lists exactly the ones not connected, each with how it signs in.
    expect(names(addSection())).toEqual(["Add Z.AI (GLM), with API key"]);
    expect(screen.getByText("2 connected")).toBeTruthy();
  });

  it("lists every provider under Add when none is connected, and says nothing goes to the cloud", async () => {
    native.authStatusWithError.mockResolvedValue(status());
    await renderPage();
    expect(names(addSection())).toEqual([
      "Add Anthropic, with OAuth",
      "Add xAI (Grok), with OAuth or API key",
      "Add Z.AI (GLM), with API key",
    ]);
    expect(screen.getByText(`${PRIVATE_LINE} Nothing goes to a cloud provider yet.`)).toBeTruthy();
  });

  it("says where messages go once a cloud provider is connected", async () => {
    native.authStatusWithError.mockResolvedValue(status({ anthropic: ["oauth"] }));
    await renderPage();
    expect(
      screen.getByText(`${PRIVATE_LINE} Outside it, your messages go to the company you picked.`),
    ).toBeTruthy();
  });

  it("says every cloud provider is connected when there is none left to add", async () => {
    native.authStatusWithError.mockResolvedValue(
      status({ anthropic: ["oauth"], xai: ["apikey"], glm: ["apikey"] }),
    );
    await renderPage();
    expect(within(addSection()).getByText("Every cloud provider is connected.")).toBeTruthy();
    expect(within(addSection()).queryByRole("button")).toBeNull();
  });

  it("says it is checking until the list is read, and claims nothing about the cloud meanwhile", async () => {
    native.authStatusWithError.mockReturnValue(new Promise(() => {}));
    await renderPage();
    expect(within(addSection()).getByText("Checking providers…")).toBeTruthy();
    expect(screen.getByText(PRIVATE_LINE)).toBeTruthy();
    expect(screen.queryByText(/connected$/)).toBeNull();
  });

  it("says why the list is empty when the host can't answer, and still offers the private models", async () => {
    native.authStatusWithError.mockResolvedValue({
      providers: [],
      error: "Still connecting to your host — try again in a moment.",
    });
    await renderPage();

    expect(screen.getByRole("status").textContent).toBe(
      "Still connecting to your host — try again in a moment.",
    );
    // Marked as a fault, so it doesn't read as ordinary copy.
    expect(screen.getByRole("status").classList.contains("is-fault")).toBe(true);
    expect(names(privateList())).toHaveLength(3);
    // The list couldn't be read, so it doesn't claim nothing goes to the cloud.
    expect(screen.getByText(PRIVATE_LINE)).toBeTruthy();
    expect(screen.queryByText(/Nothing goes to a cloud provider yet/)).toBeNull();
  });

  it("opens each cloud provider's own dialog, connected or not", async () => {
    native.authStatusWithError.mockResolvedValue(status({ anthropic: ["oauth"] }));
    await renderPage();
    for (const [name, title] of [
      ["Anthropic: connected with OAuth. Manage", "Connect Anthropic"],
      ["Add xAI (Grok), with OAuth or API key", "Connect xAI (Grok)"],
    ] as const) {
      const button = screen.getByRole("button", { name });
      button.focus();
      fireEvent.click(button);
      expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(button);
    }
  });

  it("loads the local-model and download forms only when chosen, without scanning or downloading", async () => {
    native.authStatusWithError.mockResolvedValue({ providers: [], error: null });
    await renderPage();
    const local = screen.getByRole("button", { name: /^Ollama/ });
    // The ring shows the last scan (a cheap read); probing waits for the form.
    await waitFor(() => expect(native.getLocalModels).toHaveBeenCalledTimes(1));
    expect(native.scanLocalModels).not.toHaveBeenCalled();
    expect(native.hfPullStatus).not.toHaveBeenCalled();
    local.focus();
    fireEvent.click(local);
    await screen.findByRole("dialog", { name: /Local models/i });
    await waitFor(() => expect(native.scanLocalModels).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(local);
    const hub = screen.getByRole("button", { name: /^Hugging Face/ });
    hub.focus();
    fireEvent.click(hub);
    await screen.findByRole("combobox", { name: "Search Hugging Face models" });
    // The dialog's Escape listener attaches in the same effect pass as its status read.
    await waitFor(() => expect(native.hfPullStatus).toHaveBeenCalledTimes(1));
    expect(native.hfPull).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(hub);
  });
});
