// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { authStatusWithError } from "../agent";
import {
  KleioApiError,
  getSetupStatus,
  removeSetupKey,
  setSetupKey,
  type SetupStatus,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { SetupPage } from "./SetupPage";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));
vi.mock("./VoiceCard", () => ({
  VoiceCard: ({ canEdit }: { canEdit?: boolean }) => (
    <p>{canEdit ? "voice card" : "voice card, view only"}</p>
  ),
}));
vi.mock("../agent", () => ({ authStatusWithError: vi.fn() }));
vi.mock("./kleioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof KleioApi>();
  return {
    // The real error type and wording; only the calls to the host are fakes.
    KleioApiError: actual.KleioApiError,
    errorText: actual.errorText,
    getSetupStatus: vi.fn(),
    setSetupKey: vi.fn(),
    removeSetupKey: vi.fn(),
  };
});

function status(keys: Partial<SetupStatus["keys"]> = {}, admin = true): SetupStatus {
  return { admin, keys: { openai: "missing", composio: "missing", typesafe: "missing", ...keys } };
}

const PROVIDER = {
  value: "anthropic",
  label: "Anthropic",
  description: "",
  methods: [],
  connected: true,
  connectedMethods: [],
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getSetupStatus).mockResolvedValue(status());
  vi.mocked(authStatusWithError).mockResolvedValue({ providers: [PROVIDER], error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(onOpenTab = vi.fn()): Promise<typeof onOpenTab> {
  await act(async () => {
    render(<SetupPage onOpenTab={onOpenTab} />);
  });
  return onOpenTab;
}

const card = (name: string): HTMLElement => screen.getByRole("region", { name });

describe("SetupPage", () => {
  it("marks Setup as seen on this device", async () => {
    await renderPage();
    expect(localStorage.getItem("kleio-setup-seen")).toBe("1");
  });

  it("shows each card's state and its action", async () => {
    const onOpenTab = await renderPage();
    expect(within(card("Host")).getByText("Done")).toBeTruthy();
    fireEvent.click(within(card("Host")).getByRole("button", { name: "Connection" }));
    expect(onOpenTab).toHaveBeenCalledWith("connection");

    expect(within(card("AI provider")).getByText("Signed in to Anthropic.")).toBeTruthy();
    expect(screen.getByText("voice card")).toBeTruthy();
    expect(within(card("Apps (Composio)")).getByText("Needed")).toBeTruthy();
    expect(within(card("Group chats (Typesafe Jev)")).getByText("Optional")).toBeTruthy();
  });

  it("asks to sign in when no AI provider is", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({
      providers: [{ ...PROVIDER, connected: false }],
      error: null,
    });
    const onOpenTab = await renderPage();
    const ai = card("AI provider");
    expect(within(ai).getByText("Needed")).toBeTruthy();
    fireEvent.click(within(ai).getByRole("button", { name: "Sign in" }));
    expect(onOpenTab).toHaveBeenCalledWith("providers");
  });

  it("gives an admin the key forms and Get a key links", async () => {
    await renderPage();
    const apps = card("Apps (Composio)");
    expect(within(apps).getByLabelText("Composio API key").getAttribute("type")).toBe("password");
    expect(
      within(apps).getByText("In Composio, open Settings, then API Keys, and create a key."),
    ).toBeTruthy();
    fireEvent.click(within(apps).getByRole("button", { name: "Get a key" }));
    expect(openUrl).toHaveBeenCalledWith("https://dashboard.composio.dev");

    const groups = card("Group chats (Typesafe Jev)");
    expect(within(groups).getByLabelText("Typesafe API key")).toBeTruthy();
    fireEvent.click(within(groups).getByRole("button", { name: "Get a key" }));
    expect(openUrl).toHaveBeenCalledWith("https://console.typesafe.ai");
  });

  it("shows a non-admin device the states but no forms", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(status({ composio: "saved" }, false));
    await renderPage();
    expect(screen.getByText("Finish this on your admin device.")).toBeTruthy();
    expect(screen.getByText("voice card, view only")).toBeTruthy();
    expect(within(card("Apps (Composio)")).getByText("Done")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText("Typesafe API key")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove key" })).toBeNull();
  });

  it("saves a key and shows it done", async () => {
    vi.mocked(setSetupKey).mockResolvedValue(status({ composio: "saved" }));
    await renderPage();
    const apps = card("Apps (Composio)");
    const input = within(apps).getByLabelText("Composio API key");
    fireEvent.change(input, { target: { value: "ak_live" } });
    await act(async () => {
      fireEvent.click(within(apps).getByRole("button", { name: "Save" }));
    });
    expect(setSetupKey).toHaveBeenCalledWith("composio", "ak_live");
    expect(within(apps).getByText("Done")).toBeTruthy();
    expect(within(apps).queryByLabelText("Composio API key")).toBeNull();
    expect(within(apps).getByRole("button", { name: "Remove key" })).toBeTruthy();
  });

  it("removes a saved key", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(status({ typesafe: "saved" }));
    vi.mocked(removeSetupKey).mockResolvedValue(status());
    await renderPage();
    const groups = card("Group chats (Typesafe Jev)");
    await act(async () => {
      fireEvent.click(within(groups).getByRole("button", { name: "Remove key" }));
    });
    expect(removeSetupKey).toHaveBeenCalledWith("typesafe");
    expect(within(groups).getByText("Optional")).toBeTruthy();
  });

  it("says a key set on the host can't be changed here", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(status({ composio: "env" }));
    await renderPage();
    const apps = card("Apps (Composio)");
    expect(within(apps).getByText("Set on the host")).toBeTruthy();
    expect(within(apps).queryByLabelText("Composio API key")).toBeNull();
    expect(within(apps).queryByRole("button", { name: "Remove key" })).toBeNull();
  });

  it("puts a refused key in plain words", async () => {
    vi.mocked(setSetupKey).mockRejectedValueOnce(new KleioApiError(422, "bad_key"));
    await renderPage();
    const apps = card("Apps (Composio)");
    fireEvent.change(within(apps).getByLabelText("Composio API key"), {
      target: { value: "nope" },
    });
    await act(async () => {
      fireEvent.click(within(apps).getByRole("button", { name: "Save" }));
    });
    expect(within(apps).getByRole("alert").textContent).toBe(
      "Composio didn't accept that key. Check you copied all of it.",
    );
  });

  it("explains a key the host set itself", async () => {
    vi.mocked(setSetupKey).mockRejectedValueOnce(new KleioApiError(409, "set_by_env"));
    await renderPage();
    const groups = card("Group chats (Typesafe Jev)");
    fireEvent.change(within(groups).getByLabelText("Typesafe API key"), {
      target: { value: "ts_x" },
    });
    await act(async () => {
      fireEvent.click(within(groups).getByRole("button", { name: "Save" }));
    });
    expect(within(groups).getByRole("alert").textContent).toBe(
      "This key is set on the host itself, so it can't be changed here.",
    );
  });

  it("tells an older host to update", async () => {
    vi.mocked(getSetupStatus).mockRejectedValue(new KleioApiError(404, "not_found"));
    await renderPage();
    for (const name of ["Apps (Composio)", "Group chats (Typesafe Jev)"]) {
      expect(within(card(name)).getByText("Your host needs the latest Kleio first.")).toBeTruthy();
    }
  });

  it("offers a retry when setup can't be read", async () => {
    vi.mocked(getSetupStatus).mockRejectedValueOnce(new KleioApiError(500, "boom"));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toContain("boom");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(getSetupStatus).toHaveBeenCalledTimes(2);
    expect(within(card("Apps (Composio)")).getByText("Needed")).toBeTruthy();
  });
});
