// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  authStatusWithError,
  getLocalModels,
  listJiwa,
  listMemories,
  openUrl,
  type Memory,
  type MemorySnapshot,
  type SidecarEvent,
} from "../agent";
import { toast } from "../toast";
import {
  getSetupStatus,
  getVoiceStatus,
  KleioApiError,
  removeSetupKey,
  removeVoiceKey,
  setSetupKey,
  setVoiceKey,
  setVoiceName,
  type SetupStatus,
  type VoiceStatus,
} from "./kleioApi";
import type * as KleioApi from "./kleioApi";
import { KleioPage, keptWhen } from "./KleioPage";
import { quotableMemories } from "./quotableMemories";
import { setVoiceReady, talkToKleio } from "./VoiceMode";

let eventHandler: ((event: SidecarEvent) => void) | undefined;

vi.mock("../agent", () => ({
  authStatusWithError: vi.fn(),
  getLocalModels: vi.fn(),
  listJiwa: vi.fn(),
  listMemories: vi.fn(),
  openUrl: vi.fn(async () => undefined),
  subscribe: vi.fn((handler: (event: SidecarEvent) => void) => {
    eventHandler = handler;
    return vi.fn();
  }),
  isJiwaChangeEvent: (event: SidecarEvent) => event.type === "jiwa_change",
  isMemoryChangeEvent: (event: SidecarEvent) => event.type === "memory_change",
}));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("../LazyMemoryModal", () => ({
  MemoryModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Brain window">
      <button type="button" onClick={onClose}>
        Close Brain
      </button>
    </div>
  ),
}));
vi.mock("./VoiceGuide", () => ({
  VoiceGuide: () => <div role="dialog" aria-label="Voice guide" />,
}));
vi.mock("./VoiceMode", () => ({ setVoiceReady: vi.fn(), talkToKleio: vi.fn() }));
// Covered by its own tests; here it only has to be the page's quiet section.
vi.mock("./DictationCard", () => ({
  DictationCard: ({ section }: { section?: boolean }) => (
    <section aria-label="Dictation">{section ? "dictation section" : "dictation card"}</section>
  ),
}));
vi.mock("./kleioApi", async (importOriginal) => {
  const actual = await importOriginal<typeof KleioApi>();
  return {
    // The real error type and wording; only the calls to the host are fakes.
    KleioApiError: actual.KleioApiError,
    errorText: actual.errorText,
    getVoiceStatus: vi.fn(),
    setVoiceKey: vi.fn(),
    removeVoiceKey: vi.fn(),
    setVoiceName: vi.fn(),
    getSetupStatus: vi.fn(),
    setSetupKey: vi.fn(),
    removeSetupKey: vi.fn(),
  };
});

function voice(ready: boolean, name = "marin"): VoiceStatus {
  return { ready, voice: name, model: "gpt-live", voices: ["marin", "cedar"], speed: 1 };
}
function setup(keys: Partial<SetupStatus["keys"]> = {}, admin = true): SetupStatus {
  return { admin, keys: { openai: "missing", composio: "missing", typesafe: "missing", ...keys } };
}
function memory(
  id: string,
  text: string,
  updatedAt: string,
  category: Memory["category"] = "other",
): Memory {
  return { id, text, category, importance: 3, createdAt: updatedAt, updatedAt };
}
function snapshot(memories: Memory[]): MemorySnapshot {
  return { softLimit: 60, hardLimit: 90, memories };
}
const jiwa = (count: number) => ({
  softLimit: 60,
  hardLimit: 90,
  jiwa: Array.from({ length: count }, (_, i) => ({
    id: `j${i}`,
    text: `Instruction ${i}`,
    category: "voice" as const,
    importance: 3,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  })),
});
const PROVIDER = {
  value: "anthropic",
  label: "Anthropic",
  description: "",
  methods: [],
  connected: true,
  connectedMethods: [],
};

beforeEach(() => {
  eventHandler = undefined;
  vi.mocked(getVoiceStatus).mockResolvedValue(voice(true));
  vi.mocked(getSetupStatus).mockResolvedValue(setup({ openai: "saved" }));
  vi.mocked(listMemories).mockResolvedValue(snapshot([]));
  vi.mocked(listJiwa).mockResolvedValue(jiwa(0));
  vi.mocked(authStatusWithError).mockResolvedValue({ providers: [PROVIDER], error: null });
  vi.mocked(getLocalModels).mockResolvedValue({ endpoints: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderPage(
  onOpenTab = vi.fn(),
  onIntroduce: () => Promise<void> = vi.fn(async () => {}),
): Promise<{ onOpenTab: typeof onOpenTab; onIntroduce: typeof onIntroduce }> {
  await act(async () => {
    render(<KleioPage onOpenTab={onOpenTab} onIntroduce={onIntroduce} />);
  });
  return { onOpenTab, onIntroduce };
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(el);
  });
}
const region = (name: string): HTMLElement => screen.getByRole("region", { name });
const button = (name: string): HTMLElement => screen.getByRole("button", { name });

describe("KleioPage", () => {
  it("puts Voice, what Kleio kept, Dictation and Group chats, then Remove, in that order", async () => {
    await renderPage();
    const names = screen
      .getAllByRole("region")
      .map(
        (r) =>
          r.getAttribute("aria-label") ??
          document.getElementById(r.getAttribute("aria-labelledby") ?? "")?.textContent,
      );
    expect(names).toEqual(["Voice", "What Kleio kept", "Dictation", "Group chats", "Remove"]);
    expect(within(region("Dictation")).getByText("dictation section")).toBeTruthy();
  });
});

describe("KleioPage's voice", () => {
  it("lets an admin device add the OpenAI key, with where to get one", async () => {
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
    vi.mocked(getSetupStatus).mockResolvedValue(setup());
    await renderPage();
    const v = region("Voice");
    expect(within(v).getByText("Give Kleio a voice.")).toBeTruthy();
    const field = within(v).getByLabelText("OpenAI API key");
    expect(field.getAttribute("type")).toBe("password");
    expect(field.getAttribute("placeholder")).toBe("OpenAI API key (sk-…)");
    expect(
      within(v).getByText("On platform.openai.com, open API keys and create a key."),
    ).toBeTruthy();
    fireEvent.click(within(v).getByRole("button", { name: "Get a key" }));
    expect(openUrl).toHaveBeenCalledWith("https://platform.openai.com/api-keys");
    // Nothing to remove yet, and nothing moves.
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
    expect(v.querySelector(".kl-orb.is-live")).toBeNull();
  });

  it("saves a key, then offers the voice and Talk now", async () => {
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
    vi.mocked(setVoiceKey).mockResolvedValue(voice(true));
    await renderPage();
    fireEvent.change(screen.getByLabelText("OpenAI API key"), { target: { value: " sk-test " } });
    await click(within(region("Voice")).getByRole("button", { name: "Save" }));

    expect(setVoiceKey).toHaveBeenCalledWith("sk-test");
    expect(setVoiceReady).toHaveBeenCalledWith(true);
    expect(within(region("Voice")).getByText("Talk to Kleio out loud.")).toBeTruthy();
    expect(button("Talk now")).toBeTruthy();
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
  });

  it("says in words, under the field, why a key was refused", async () => {
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
    vi.mocked(setVoiceKey).mockRejectedValue(new KleioApiError(400, "bad_key"));
    await renderPage();
    const field = screen.getByLabelText("OpenAI API key");
    fireEvent.change(field, { target: { value: "sk-wrong" } });
    await click(within(region("Voice")).getByRole("button", { name: "Save" }));

    const alert = within(region("Voice")).getByRole("alert");
    expect(alert.textContent).toBe("OpenAI didn't accept that key. Check you copied all of it.");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("picks her voice, and says when the change applies", async () => {
    vi.mocked(setVoiceName).mockResolvedValue(voice(true, "cedar"));
    await renderPage();
    const picker = screen.getByLabelText("Kleio's conversation voice") as HTMLSelectElement;
    expect(picker.value).toBe("marin");
    expect(
      within(picker).getByRole("option", { name: "Marin (natural, recommended)" }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.change(picker, { target: { value: "cedar" } });
    });
    expect(setVoiceName).toHaveBeenCalledWith("cedar");
    expect((screen.getByLabelText("Kleio's conversation voice") as HTMLSelectElement).value).toBe(
      "cedar",
    );
    expect(screen.getByText("Changes apply from your next conversation.")).toBeTruthy();
  });

  it("says why her voice couldn't be changed", async () => {
    vi.mocked(setVoiceName).mockRejectedValue(new KleioApiError(403, "forbidden"));
    await renderPage();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Kleio's conversation voice"), {
        target: { value: "cedar" },
      });
    });
    expect(within(region("Voice")).getByRole("alert").textContent).toBe(
      "Only an admin device can set the key.",
    );
  });

  it("starts a conversation with Talk now, the page's one filled button", async () => {
    await renderPage();
    const talk = button("Talk now");
    fireEvent.click(talk);
    expect(talkToKleio).toHaveBeenCalledOnce();
    // The Typesafe fold's Save keeps KeyForm's class; the stylesheet draws it as a
    // secondary there, which the capture harness measures.
    const filled = [...document.querySelectorAll(".btn-primary")].filter(
      (b) => !b.closest(".kl-disclose"),
    );
    expect(filled).toEqual([talk]);
    expect(region("Voice").querySelector(".kl-orb.is-live")).not.toBeNull();
  });

  it("keeps what she reads, and where it goes, in full", async () => {
    await renderPage();
    expect(
      within(region("Voice")).getByText(
        "A natural, two-way conversation, run by OpenAI with your own key, kept on your host. What she reads, including your memories, chats, files and project details, goes to OpenAI under that key. A typical day costs a few cents.",
      ),
    ).toBeTruthy();
  });

  it("opens the guide to what her voice can do", async () => {
    await renderPage();
    expect(screen.queryByRole("dialog", { name: "Voice guide" })).toBeNull();
    fireEvent.click(button("What Kleio Voice can do"));
    expect(screen.getByRole("dialog", { name: "Voice guide" })).toBeTruthy();
  });

  it("lets a device that isn't the admin talk, without the picker, the key or Remove", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(
      setup({ openai: "saved", typesafe: "saved" }, false),
    );
    await renderPage();
    fireEvent.click(button("Talk now"));
    expect(talkToKleio).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Kleio's conversation voice")).toBeNull();
    expect(
      within(region("Voice")).getByText("Only your admin device can change her voice or its key."),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("gives a device that isn't the admin no key form, and says who can add it", async () => {
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
    vi.mocked(getSetupStatus).mockResolvedValue(setup({}, false));
    await renderPage();
    expect(
      within(region("Voice")).getByText("Only your admin device can add the key."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
    expect(screen.queryByLabelText("Typesafe API key")).toBeNull();
    expect(
      within(region("Group chats")).getByText("Only your admin device can add the key."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("says the host isn't answering, and asks again on Try again", async () => {
    const away = new KleioApiError(0, "kleio_api: request timed out");
    vi.mocked(getVoiceStatus).mockRejectedValueOnce(away);
    vi.mocked(getSetupStatus).mockRejectedValueOnce(away);
    await renderPage();
    const v = region("Voice");
    expect(within(v).getByText("Her voice lives on your host.")).toBeTruthy();
    expect(within(v).getByRole("alert").textContent).toBe("Your host isn't answering right now.");
    expect(within(region("Group chats")).getByRole("alert").textContent).toBe(
      "Your host isn't answering right now.",
    );
    expect(screen.queryByRole("button", { name: "Talk now" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
    expect(v.querySelector(".kl-orb.is-live")).toBeNull();

    // One Try again asks for everything the host didn't say.
    await click(within(v).getByRole("button", { name: "Try again" }));
    expect(getVoiceStatus).toHaveBeenCalledTimes(2);
    expect(getSetupStatus).toHaveBeenCalledTimes(2);
    expect(button("Talk now")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says why it couldn't check her voice when the host answered badly", async () => {
    vi.mocked(getVoiceStatus).mockRejectedValueOnce(new KleioApiError(500, "engine crashed"));
    await renderPage();
    expect(within(region("Voice")).getByRole("alert").textContent).toBe(
      "Couldn't check her voice: engine crashed",
    );
    await click(within(region("Voice")).getByRole("button", { name: "Try again" }));
    expect(getVoiceStatus).toHaveBeenCalledTimes(2);
    // Setup had answered, so it isn't asked again.
    expect(getSetupStatus).toHaveBeenCalledOnce();
  });

  it("tells an older host to update first, with no form", async () => {
    const old = new KleioApiError(404, "not found");
    vi.mocked(getVoiceStatus).mockRejectedValue(old);
    vi.mocked(getSetupStatus).mockRejectedValue(old);
    await renderPage();
    expect(
      within(region("Voice")).getByText("Your host needs the latest Kleio first."),
    ).toBeTruthy();
    expect(
      within(region("Group chats")).getByText("Your host needs the latest Kleio to change this."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
  });
});

describe("KleioPage's memories", () => {
  const NOW = Date.parse("2026-11-19T12:00:00.000Z");
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("quotes the three newest, newest first, and counts the rest", async () => {
    vi.mocked(listMemories).mockResolvedValue(
      snapshot([
        memory("a", "Prefers short replies.", "2026-10-01T09:00:00.000Z", "preference"),
        memory("b", "Works on Kleio most weekdays.", "2026-11-18T09:00:00.000Z", "project"),
        memory("c", "Lives in Edinburgh.", "2026-11-19T09:00:00.000Z", "identity"),
        memory("d", "Weekly planning is on Mondays.", "2026-11-10T09:00:00.000Z"),
      ]),
    );
    vi.mocked(listJiwa).mockResolvedValue(jiwa(2));
    await renderPage();
    const kept = region("What Kleio kept");
    const quotes = [...kept.querySelectorAll(".kl-quote-text")].map((q) => q.textContent);
    expect(quotes).toEqual([
      "“Lives in Edinburgh.”",
      "“Works on Kleio most weekdays.”",
      "“Weekly planning is on Mondays.”",
    ]);
    const when = [...kept.querySelectorAll(".kl-quote-when")].map((q) => q.textContent);
    expect(when).toEqual(["today", "yesterday", "9 days ago"]);
    expect(within(kept).getByText("And 1 more in Brain.")).toBeTruthy();
    expect(within(kept).getByText("4 memories and 2 Jiwa instructions.")).toBeTruthy();
  });

  it("never quotes a health or relationship memory, and still counts it", async () => {
    vi.mocked(listMemories).mockResolvedValue(
      snapshot([
        memory("h", "Takes a tablet each morning.", "2026-11-19T10:00:00.000Z", "health"),
        memory("r", "Is seeing someone new.", "2026-11-19T09:00:00.000Z", "relationship"),
        memory("p", "Prefers short replies.", "2026-11-01T09:00:00.000Z", "preference"),
      ]),
    );
    await renderPage();
    const kept = region("What Kleio kept");
    expect([...kept.querySelectorAll(".kl-quote-text")].map((q) => q.textContent)).toEqual([
      "“Prefers short replies.”",
    ]);
    expect(kept.textContent).not.toContain("tablet");
    expect(kept.textContent).not.toContain("seeing someone");
    expect(within(kept).getByText("And 2 more in Brain.")).toBeTruthy();
    expect(within(kept).getByText("3 memories and 0 Jiwa instructions.")).toBeTruthy();
  });

  it("points to Brain when everything she kept is private", async () => {
    vi.mocked(listMemories).mockResolvedValue(
      snapshot([memory("h", "Takes a tablet each morning.", "2026-11-19T10:00:00.000Z", "health")]),
    );
    await renderPage();
    const kept = region("What Kleio kept");
    expect(within(kept).getByText("What she kept is in Brain.")).toBeTruthy();
    expect(kept.querySelector(".kl-quote-text")).toBeNull();
    expect(kept.textContent).not.toContain("tablet");
  });

  it("says there's nothing yet, with both buttons", async () => {
    await renderPage();
    const kept = region("What Kleio kept");
    expect(
      within(kept).getByText(
        "Nothing yet. Introduce yourself: Kleio asks a few short questions and saves your answers.",
      ),
    ).toBeTruthy();
    expect(within(kept).getByRole("button", { name: "Introduce yourself" })).toBeTruthy();
    expect(within(kept).getByRole("button", { name: "Open Brain" })).toBeTruthy();
  });

  it("reads again on each Brain change", async () => {
    await renderPage();
    vi.mocked(listMemories).mockResolvedValue(
      snapshot([memory("a", "Prefers short replies.", "2026-11-19T09:00:00.000Z")]),
    );
    await act(async () => eventHandler?.({ type: "memory_change" } as SidecarEvent));
    expect(within(region("What Kleio kept")).getByText("“Prefers short replies.”")).toBeTruthy();
  });

  it("says why it couldn't check Brain, and checks again on Try again", async () => {
    vi.mocked(listJiwa).mockRejectedValueOnce(new Error("the engine isn't running"));
    await renderPage();
    const kept = region("What Kleio kept");
    expect(within(kept).getByRole("alert").textContent).toBe(
      "Couldn't check Brain: the engine isn't running",
    );
    expect(within(kept).queryByRole("button", { name: "Open Brain" })).toBeNull();
    await click(within(kept).getByRole("button", { name: "Try again" }));
    expect(within(kept).getByRole("button", { name: "Open Brain" })).toBeTruthy();
  });

  it("starts the Introduce-yourself chat when there's a model", async () => {
    const { onIntroduce, onOpenTab } = await renderPage();
    await click(button("Introduce yourself"));
    expect(onIntroduce).toHaveBeenCalledOnce();
    expect(onOpenTab).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("asks for a model first, and opens AI Providers, when there's none", async () => {
    vi.mocked(authStatusWithError).mockResolvedValue({
      providers: [{ ...PROVIDER, connected: false }],
      error: null,
    });
    const { onIntroduce, onOpenTab } = await renderPage();
    await click(button("Introduce yourself"));
    expect(toast).toHaveBeenCalledWith("Connect an AI model first.", "warning");
    expect(onOpenTab).toHaveBeenCalledWith("providers");
    expect(onIntroduce).not.toHaveBeenCalled();
  });

  it("shows why the chat couldn't start", async () => {
    await renderPage(
      vi.fn(),
      vi.fn(async () => {
        throw new Error("Choose a projects folder in Settings first.");
      }),
    );
    await click(button("Introduce yourself"));
    expect(within(region("What Kleio kept")).getByRole("alert").textContent).toBe(
      "Couldn't start the chat: Choose a projects folder in Settings first.",
    );
  });

  it("opens Brain, then reads again and returns focus to Open Brain", async () => {
    await renderPage();
    await click(button("Open Brain"));
    expect(screen.getByRole("dialog", { name: "Brain window" })).toBeTruthy();

    vi.mocked(listMemories).mockResolvedValue(
      snapshot([memory("a", "Prefers short replies.", "2026-11-19T09:00:00.000Z")]),
    );
    await click(button("Close Brain"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(region("What Kleio kept")).getByText("“Prefers short replies.”")).toBeTruthy();
    expect(document.activeElement).toBe(button("Open Brain"));
  });

  it("words how long ago a line was kept", () => {
    const day = 86_400_000;
    expect(keptWhen(new Date(NOW - 3 * day).toISOString(), NOW)).toBe("3 days ago");
    expect(keptWhen(new Date(NOW - 21 * day).toISOString(), NOW)).toBe("3 weeks ago");
    expect(keptWhen(new Date(NOW - 90 * day).toISOString(), NOW)).toBe("3 months ago");
    expect(keptWhen("not a date", NOW)).toBe("");
  });

  it("orders what may be quoted without changing the list it was given", () => {
    const given = [
      memory("a", "old", "2026-01-01T00:00:00.000Z"),
      memory("b", "new", "2026-02-01T00:00:00.000Z"),
    ];
    expect(quotableMemories(given).map((m) => m.id)).toEqual(["b", "a"]);
    expect(given.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("KleioPage's group chats", () => {
  const groups = (): HTMLElement => region("Group chats");

  it("folds the Typesafe key form away, and saves a key from it", async () => {
    vi.mocked(setSetupKey).mockResolvedValue(setup({ openai: "saved", typesafe: "saved" }));
    await renderPage();
    const fold = groups().querySelector("details");
    expect(fold?.open).toBe(false);
    expect(within(groups()).getByText("Add a Typesafe key")).toBeTruthy();
    expect(
      within(groups()).getByText(
        "Optional. Without it, group chats still work, with simpler rules.",
      ),
    ).toBeTruthy();

    fireEvent.change(within(groups()).getByLabelText("Typesafe API key"), {
      target: { value: "ts-key" },
    });
    await click(within(groups()).getByRole("button", { name: "Save" }));

    expect(setSetupKey).toHaveBeenCalledWith("typesafe", "ts-key");
    expect(within(groups()).getByText("Typesafe key saved on your host.")).toBeTruthy();
    expect(within(groups()).queryByLabelText("Typesafe API key")).toBeNull();
    expect(button("Remove Typesafe key…")).toBeTruthy();
  });

  it("says in words why Typesafe refused a key", async () => {
    vi.mocked(setSetupKey).mockRejectedValue(new KleioApiError(400, "bad_key"));
    await renderPage();
    fireEvent.change(within(groups()).getByLabelText("Typesafe API key"), {
      target: { value: "wrong" },
    });
    await click(within(groups()).getByRole("button", { name: "Save" }));
    expect(within(groups()).getByRole("alert").textContent).toBe(
      "Typesafe didn't accept that key. Check you copied all of it.",
    );
  });

  it("says a key set on the host can't be changed here: no form, nothing to remove", async () => {
    vi.mocked(getVoiceStatus).mockResolvedValue(voice(false));
    vi.mocked(getSetupStatus).mockResolvedValue(setup({ typesafe: "env" }));
    await renderPage();
    expect(
      within(groups()).getByText("Set on the host itself, so it can't be changed here."),
    ).toBeTruthy();
    expect(within(groups()).queryByLabelText("Typesafe API key")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Typesafe key…" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Remove" })).toBeNull();
  });

  it("tells a device that isn't the admin who can change a saved key", async () => {
    vi.mocked(getSetupStatus).mockResolvedValue(setup({ typesafe: "saved" }, false));
    await renderPage();
    expect(
      within(groups()).getByText(
        "Typesafe key saved on your host. Only your admin device can change it.",
      ),
    ).toBeTruthy();
  });

  it("says why it couldn't read the key, and reads again on Try again", async () => {
    vi.mocked(getSetupStatus).mockRejectedValueOnce(new KleioApiError(500, "disk full"));
    await renderPage();
    expect(within(groups()).getByRole("alert").textContent).toBe("disk full");
    await click(within(groups()).getByRole("button", { name: "Try again" }));
    expect(getSetupStatus).toHaveBeenCalledTimes(2);
    expect(within(groups()).getByText("Add a Typesafe key")).toBeTruthy();
    // Her voice had answered, so it isn't asked again.
    expect(getVoiceStatus).toHaveBeenCalledOnce();
  });
});

describe("KleioPage's Remove group", () => {
  beforeEach(() => {
    vi.mocked(getSetupStatus).mockResolvedValue(setup({ openai: "saved", typesafe: "saved" }));
  });

  it("holds both saved keys, last on the page, and nowhere else", async () => {
    await renderPage();
    const remove = region("Remove");
    expect(within(remove).getByText("OpenAI key, saved on your host")).toBeTruthy();
    expect(within(remove).getByText("Typesafe key, saved on your host")).toBeTruthy();
    expect(document.querySelector(".kl-page")?.lastElementChild).toBe(remove);
    for (const b of screen.getAllByRole("button", { name: /^Remove/ }))
      expect(remove.contains(b)).toBe(true);
  });

  it("asks before removing the OpenAI key: focus moves to Keep, and Keep returns it", async () => {
    await renderPage();
    fireEvent.click(button("Remove OpenAI key…"));

    expect(removeVoiceKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Keep"));
    expect(
      screen.getByText(
        "Talk now stops until a key is added again, and Brief me reads in the system's own voice.",
      ),
    ).toBeTruthy();

    fireEvent.click(button("Keep"));
    expect(removeVoiceKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Remove OpenAI key…"));
    expect(button("Talk now")).toBeTruthy();
  });

  it("removes the OpenAI key on the confirm click, and brings back the key form", async () => {
    vi.mocked(removeVoiceKey).mockResolvedValue(voice(false));
    await renderPage();
    fireEvent.click(button("Remove OpenAI key…"));
    await click(button("Remove OpenAI key"));

    expect(removeVoiceKey).toHaveBeenCalledOnce();
    expect(setVoiceReady).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("OpenAI API key")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Talk now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove OpenAI key…" })).toBeNull();
    expect(region("Voice").querySelector(".kl-orb.is-live")).toBeNull();
    // The Typesafe key is still there to remove.
    expect(button("Remove Typesafe key…")).toBeTruthy();
  });

  it("says why the OpenAI key couldn't be removed, and keeps it", async () => {
    vi.mocked(removeVoiceKey).mockRejectedValue(new KleioApiError(403, "forbidden"));
    await renderPage();
    fireEvent.click(button("Remove OpenAI key…"));
    await click(button("Remove OpenAI key"));
    expect(within(region("Remove")).getByRole("alert").textContent).toBe(
      "Only an admin device can set the key.",
    );
    expect(button("Talk now")).toBeTruthy();
  });

  it("asks before removing the Typesafe key: focus moves to Keep, and Keep returns it", async () => {
    await renderPage();
    fireEvent.click(button("Remove Typesafe key…"));

    expect(removeSetupKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Keep"));
    expect(
      screen.getByText("Group chats keep working, with simpler rules for who answers."),
    ).toBeTruthy();

    fireEvent.click(button("Keep"));
    expect(removeSetupKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button("Remove Typesafe key…"));
  });

  it("removes the Typesafe key on the confirm click, and brings back its form", async () => {
    vi.mocked(removeSetupKey).mockResolvedValue(setup({ openai: "saved" }));
    await renderPage();
    fireEvent.click(button("Remove Typesafe key…"));
    await click(button("Remove Typesafe key"));

    expect(removeSetupKey).toHaveBeenCalledWith("typesafe");
    expect(within(region("Group chats")).getByLabelText("Typesafe API key")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Typesafe key…" })).toBeNull();
  });

  it("says why the Typesafe key couldn't be removed", async () => {
    vi.mocked(removeSetupKey).mockRejectedValue(new KleioApiError(403, "forbidden"));
    await renderPage();
    fireEvent.click(button("Remove Typesafe key…"));
    await click(button("Remove Typesafe key"));
    expect(within(region("Remove")).getByRole("alert").textContent).toBe(
      "Only an admin device can change keys.",
    );
    expect(
      within(region("Group chats")).getByText("Typesafe key saved on your host."),
    ).toBeTruthy();
  });
});
