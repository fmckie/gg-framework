// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChatsCircleIcon, CirclesThreeIcon } from "@phosphor-icons/react";
import { BackButton } from "../BackButton";
import { RadioButton } from "../RadioButton";
import { WindowLayoutButton } from "../WindowLayoutButton";
import { Badge } from "../Badge";
import { ConfirmModal } from "../ConfirmModal";
import { InitGitModal } from "../InitGitModal";
import { McpElicitModal } from "../McpElicitModal";
import { NotesModal } from "../NotesModal";
import { TasksModal } from "../TasksModal";
import { Toaster } from "../Toaster";
import { toast } from "../toast";
import { UpdateBanner } from "../UpdateBanner";
import { Schedules } from "./BlobSchedules";
import { CastSchedules } from "./CastSchedules";
import { KleioHead, KleioPanel } from "./KleioChrome";
import { ScorecardModal } from "../ScorecardModal";
import { SettingsTabBar } from "../SettingsTabBar";
import { SessionHelp } from "../SessionHelp";
import { VoiceGuide } from "./VoiceGuide";
import mainSource from "../main.tsx?raw";
import chromeCss from "./kleio-chrome.css?raw";
import themeCss from "./kleio-theme.css?raw";
import type { SidecarEvent } from "../agent";
import type * as KleioApi from "./kleioApi";
import type * as KleioRemote from "./useKleioRemote";

const elicitListeners = vi.hoisted(() => new Set<(e: SidecarEvent) => void>());

vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  listRuns: vi.fn(async () => []),
}));
vi.mock("./useKleioRemote", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioRemote>()),
  useKleioRemote: () => ({ status: null, refresh: async () => undefined }),
}));
vi.mock("../agent", () => ({
  mcpElicit: vi.fn(async () => undefined),
  subscribe: (fn: (e: SidecarEvent) => void) => {
    elicitListeners.add(fn);
    return () => elicitListeners.delete(fn);
  },
  getRadioState: vi.fn(async () => ({
    stations: [
      { id: "groove", name: "Groove Salad", description: "Chilled downtempo" },
      { id: "drone", name: "Drone Zone", description: "Atmospheric textures" },
    ],
    current: null,
    volume: 70,
  })),
  setRadio: vi.fn(),
  setRadioVolume: vi.fn(),
  setupWindows: vi.fn(),
  arrangeAllWindows: vi.fn(),
}));

const BAR = "html:root :not(.settings-screen) > .picker-head";
const RADIO = "html:root .radio-modal";
const GUIDE = "html:root .session-help";
const SCORECARD = "html:root .scorecard-modal";
const NOTES = "html:root .notes-modal";
const MODAL = "html:root .modal";
const SWITCH = "html:root .cl-switch";
const CAST_SWITCH = "html:root .cast-switch";
const KLEIO = "html:root .kleio-screen";

/** A specialist with one weekly schedule, as its page and its dialogs get it. */
const scout = {
  id: "b1",
  name: "Scout",
  emoji: "",
  color: "sky" as const,
  job: "Morning weather",
  model: null,
  createdAt: "",
  updatedAt: "",
  schedules: [
    {
      id: "s1",
      label: "Morning check-in",
      prompt: "Check the weather.",
      kind: "weekly" as const,
      time: "07:30",
      days: [1, 3, 5],
      timezone: "Europe/London",
      enabled: true,
      notify: true,
      nextRunAt: null,
    },
  ],
  running: false,
};

/** A screen's top bar as the pickers build it: Back, then Radio and Windows.
 *  Awaited, so the radio's stations have arrived before anything is read. */
async function mountBar(screenClass = "picker"): Promise<HTMLElement> {
  let container: HTMLElement = document.body;
  await act(async () => {
    ({ container } = render(
      <div className={screenClass}>
        <div className="picker-head">
          <BackButton onClick={() => undefined} />
          <span className="picker-head-actions">
            <RadioButton />
            <WindowLayoutButton />
          </span>
        </div>
      </div>,
    ));
  });
  return container;
}

// jsdom has no layout, so no scrollIntoView: the open station list calls it.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// The Mac's markup: Windows is an icon under a native select (platform.ts).
beforeEach(() => {
  document.documentElement.classList.add("platform-macos");
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("platform-macos", "platform-ios");
});

describe("the flat top bar and radio dialog", () => {
  it("is loaded after Settings' sheet and before the iPhone's", () => {
    const at = ["theme", "pages", "settings", "chrome", "phone"].map((name) =>
      mainSource.indexOf(`import "./kleio/kleio-${name}.css";`),
    );
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("uses the session's palette and none of the glass", () => {
    const used = new Set(chromeCss.match(/--kleio-[a-z0-9-]+/g));
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(themeCss, name).toContain(`  ${name}: `);
    expect(chromeCss).not.toMatch(/liquid-rim|blur\(|var\(--glass/);
  });

  it("takes the glass off Back, Radio and Windows in a screen's top bar", async () => {
    const container = await mountBar();
    const quiet = [
      screen.getByRole("button", { name: "Back" }),
      screen.getByTitle("Internet radio"),
      container.querySelector(".winlayout-icon-btn"),
    ];
    for (const control of quiet) expect(control?.matches(`${BAR} .btn-ghost`)).toBe(true);
    expect(chromeCss).toContain(
      `${BAR} .btn {\n  border-radius: 3px;\n  box-shadow: none;\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n  filter: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${BAR} .btn-ghost {\n  border-color: transparent;\n  background: none;\n  color: var(--kleio-text-2);\n  font-weight: 400;\n}`,
    );
  });

  it("leaves Settings' own flat header alone, and draws the iPhone's bar like the desktop's", async () => {
    await mountBar("picker settings-screen");
    expect(screen.getByRole("button", { name: "Back" }).matches(`${BAR} .btn`)).toBe(false);
    cleanup();

    document.documentElement.classList.replace("platform-macos", "platform-ios");
    await mountBar();
    expect(screen.getByRole("button", { name: "Back" }).matches(`${BAR} .btn-ghost`)).toBe(true);
  });

  it("draws the radio dialog flat: panel, station list, Play, slider and close", async () => {
    await mountBar();
    await act(async () => {
      fireEvent.click(screen.getByTitle("Internet radio"));
    });
    const dialog = screen.getByRole("dialog", { name: "Internet Radio" });
    expect(dialog.matches("html:root .modal.radio-modal")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Station" }));
    const parts: Array<[Element, string]> = [
      [screen.getByRole("button", { name: "Station" }), ".dropdown-trigger"],
      [screen.getByRole("listbox", { name: "Station" }), ".dropdown-menu"],
      [screen.getByRole("option", { name: /Drone Zone/ }), ".dropdown-option"],
      [screen.getByRole("button", { name: "Play" }), ".modal-btn.primary"],
      [screen.getByLabelText("Radio volume"), ".radio-volume-input"],
      [screen.getByRole("button", { name: "Close" }), ".modal-close"],
    ];
    for (const [part, selector] of parts) {
      expect(part.matches(`${RADIO} ${selector}`), selector).toBe(true);
      expect(chromeCss, selector).toContain(`${RADIO} ${selector}`);
    }
    expect(chromeCss).toContain(
      "html:root .modal.radio-modal {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 6px;\n  background: var(--kleio-surface) !important;",
    );
    expect(chromeCss).toContain(
      `${RADIO} .dropdown-menu {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 3px;\n  background: var(--kleio-surface) !important;`,
    );
  });
});

describe("the flat guide", () => {
  it("is one box for every screen: each mode's topics, and Kleio Voice's, in the same panel", () => {
    const guides = [
      ...(["code", "chat", "motion"] as const).map((mode) => ({
        name: "How this screen works",
        guide: <SessionHelp mode={mode} phone={false} onClose={() => undefined} />,
      })),
      {
        name: "What Kleio Voice can do",
        guide: <VoiceGuide onClose={() => undefined} />,
      },
    ];
    for (const { name, guide } of guides) {
      render(guide);
      const dialog = screen.getByRole("dialog", { name });
      expect(dialog.matches("html:root .modal.session-help")).toBe(true);
      const parts: Array<[Element | null, string]> = [
        [within(dialog).getByRole("button", { name: "Close" }), ".modal-close"],
        [within(dialog).getByRole("heading", { name }), ".modal-title"],
        [dialog.querySelector("h3"), ".session-help-heading"],
        [dialog.querySelector("li svg"), ".session-help-icon"],
        [dialog.querySelector("li p"), ".session-help-text"],
      ];
      for (const [part, selector] of parts) {
        expect(part?.matches(`${GUIDE} ${selector}`), selector).toBe(true);
        expect(chromeCss, selector).toContain(`${GUIDE} ${selector}`);
      }
      cleanup();
    }
    expect(chromeCss).toContain(
      "html:root .modal.session-help {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 6px;\n  background: var(--kleio-surface) !important;",
    );
    expect(chromeCss).toContain(
      `${GUIDE} .session-help-section + .session-help-section {\n  padding-top: 20px;\n  border-top: 1px solid var(--kleio-rule);\n}`,
    );
  });

  it("is the same panel on the iPhone, for the session's guide and Kleio Voice's", () => {
    document.documentElement.classList.replace("platform-macos", "platform-ios");
    render(<SessionHelp mode="code" phone onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "How this screen works" });
    expect(dialog.matches("html:root .modal.session-help")).toBe(true);
    expect(dialog.querySelector("li p")?.matches(`${GUIDE} .session-help-text`)).toBe(true);
    cleanup();

    render(<VoiceGuide onClose={() => undefined} />);
    const voice = screen.getByRole("dialog", { name: "What Kleio Voice can do" });
    expect(voice.matches("html:root .modal.session-help")).toBe(true);
    expect(voice.classList.contains("session-help-sheet")).toBe(false);
  });
});

describe("the flat scorecard", () => {
  const snapshot = {
    level: 21,
    rankName: "Vibesmith",
    tierName: "Vibe",
    effectId: "gradient",
    xpIntoLevel: 942,
    xpForLevel: 1008,
    percent: 93,
    streak: { current: 2, best: 9 },
    totals: { prompts: 1144, commits: 18, linesShipped: 15491, projects: 4 },
    memberSince: "2026-04-29T10:00:00Z",
  } as Parameters<typeof ScorecardModal>[0]["snapshot"];

  it("draws the rank's dialog as the flat panel, its meters square with no glow", () => {
    render(<ScorecardModal snapshot={snapshot} onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "Vibesmith" });
    expect(dialog.matches("html:root .modal.scorecard-modal")).toBe(true);
    // The rank keeps the colours it earned: only its weight is the sheet's.
    expect(within(dialog).getByText("Vibesmith").className).toContain("rank-fx-gradient");

    const parts: Array<[Element | null, string]> = [
      [within(dialog).getByRole("button", { name: "Close" }), ".modal-close"],
      [within(dialog).getByText("21"), ".scorecard-level-num"],
      [dialog.querySelector(".scorecard-bar"), ":is(.scorecard-bar, .scorecard-stat-bar)"],
      [dialog.querySelector(".scorecard-stat-bar"), ":is(.scorecard-bar, .scorecard-stat-bar)"],
      [dialog.querySelector(".scorecard-bar > span"), ".scorecard-bar > span"],
    ];
    for (const [part, selector] of parts) {
      expect(part?.matches(`${SCORECARD} ${selector}`), selector).toBe(true);
      expect(chromeCss, selector).toContain(`${SCORECARD} ${selector}`);
    }
    expect(chromeCss).toContain(
      `${SCORECARD} :is(.scorecard-bar, .scorecard-stat-bar) {\n  height: 4px;\n  border-radius: 0;\n  background: var(--kleio-track) !important;\n  box-shadow: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${SCORECARD} .scorecard-bar > span {\n  background: var(--kleio-lapis);\n}`,
    );
  });
});

describe("the flat notes", () => {
  it("draws the notebook as the flat panel around one flat page, lapis-edged while focused", () => {
    render(<NotesModal value="Ship list" onChange={() => undefined} onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "Your notes" });
    expect(dialog.matches("html:root .modal.notes-modal")).toBe(true);
    const page = within(dialog).getByRole("textbox", { name: "Your notes" });
    // The page takes focus as the dialog opens, so its focus rule is its resting look.
    expect(document.activeElement).toBe(page);

    const parts: Array<[Element, string]> = [
      [within(dialog).getByRole("button", { name: "Close" }), ".modal-close"],
      [within(dialog).getByRole("heading", { name: "Your notes" }), ".modal-title"],
      [page, ".notes-input"],
    ];
    for (const [part, selector] of parts) {
      expect(part.matches(`${NOTES} ${selector}`), selector).toBe(true);
      expect(chromeCss, selector).toContain(`${NOTES} ${selector}`);
    }
    expect(chromeCss).toContain(
      "html:root .modal.notes-modal {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 6px;\n  background: var(--kleio-surface) !important;",
    );
    // !important: NotesModal sets the page's fill inline.
    expect(page.getAttribute("style")).toContain("background");
    expect(chromeCss).toContain(
      `${NOTES} .notes-input {\n  border-color: var(--kleio-edge);\n  border-radius: 3px;\n  background: rgb(0 0 0 / 0.18) !important;`,
    );
    expect(chromeCss).toContain(
      `${NOTES} .notes-input:focus {\n  border-color: var(--kleio-lapis);\n}`,
    );
  });
});

describe("every other dialog, flat", () => {
  const none = (): void => undefined;

  it("draws any shared dialog as the flat panel: square close, bounded buttons, one crimson action", () => {
    const dialogs = [
      {
        name: "Delete this chat?",
        dialog: (
          <ConfirmModal
            title="Delete this chat?"
            message="This can't be undone."
            confirmLabel="Delete"
            onConfirm={none}
            onClose={none}
          />
        ),
        action: "Delete",
      },
      {
        name: "Initialize Git",
        dialog: <InitGitModal defaultName="cookbook" onClose={none} onInitialize={none} />,
        action: "Initialize",
      },
    ];
    for (const { name, dialog, action } of dialogs) {
      render(dialog);
      const box = screen.getByRole("dialog", { name });
      // No class of its own: the one rule for `.modal` is what reaches it.
      expect(box.className).toBe("modal");
      expect(box.matches(MODAL)).toBe(true);
      expect(
        within(box).getByRole("button", { name: "Close" }).matches(`${MODAL} .modal-close`),
      ).toBe(true);
      expect(
        within(box)
          .getByRole("button", { name: "Cancel" })
          .matches(`${MODAL} :is(.modal-btn, .btn)`),
      ).toBe(true);
      expect(
        within(box)
          .getByRole("button", { name: action })
          .matches(`${MODAL} :is(.modal-btn.primary, .btn-primary)`),
      ).toBe(true);
      cleanup();
    }
    expect(chromeCss).toContain(
      `${MODAL} {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 6px;\n  background: var(--kleio-surface) !important;`,
    );
    expect(chromeCss).toContain(
      `${MODAL} :is(.modal-btn.primary, .btn-primary) {\n  border-color: transparent;\n  background: var(--kleio-crimson);\n  color: #fff;\n}`,
    );
  });

  it("draws a dialog's fields and choices flat, and a task's Run as a bounded button", () => {
    render(<InitGitModal defaultName="cookbook" onClose={none} onInitialize={none} />);
    const git = screen.getByRole("dialog", { name: "Initialize Git" });
    expect(within(git).getByDisplayValue("cookbook").matches(`${MODAL} .modal-input`)).toBe(true);
    const choice = git.querySelector('.modal-radio input[type="radio"]');
    expect(
      choice?.matches(`${MODAL} .modal-radio input:is([type="checkbox"], [type="radio"])`),
    ).toBe(true);
    expect(chromeCss).toContain(
      `${MODAL} .modal-input {\n  border-color: var(--kleio-edge);\n  border-radius: 3px;\n  background: rgb(0 0 0 / 0.18) !important;`,
    );
    cleanup();

    const tasks = [
      { id: "1", title: "Add export", prompt: "Add it", status: "pending" as const, createdAt: "" },
    ];
    render(
      <TasksModal
        tasks={tasks}
        running={false}
        onRun={none}
        onRunAll={none}
        onDelete={none}
        onClose={none}
      />,
    );
    const run = within(screen.getByRole("dialog", { name: "Tasks" })).getAllByRole("button", {
      name: /Run/,
    });
    for (const button of run) expect(button.matches(`${MODAL} :is(.modal-btn, .btn)`)).toBe(true);
  });

  it("draws a server's prompt for input flat, a ticked box keeping its fill under the pointer", () => {
    render(<McpElicitModal />);
    const data = {
      id: "e1",
      server: "Linear",
      message: "Which team?",
      requestedSchema: {
        required: ["team"],
        properties: {
          title: { type: "string", title: "Issue title" },
          team: { type: "string", title: "Team", enum: ["eng", "design"] },
          urgent: { type: "boolean", title: "Mark as urgent" },
        },
      },
    };
    act(() => {
      for (const fn of elicitListeners) fn({ type: "mcp_elicit", data } as SidecarEvent);
    });
    const box = screen.getByRole("dialog", { name: "Linear needs your input" });
    expect(box.className).toBe("modal");
    for (const name of ["Issue title", "Team *"]) {
      expect(within(box).getByLabelText(name).matches(`${MODAL} .modal-input`), name).toBe(true);
    }
    for (const name of ["Decline", "Cancel"]) {
      const button = within(box).getByRole("button", { name });
      expect(button.matches(`${MODAL} :is(.modal-btn, .btn)`), name).toBe(true);
    }
    expect(
      within(box)
        .getByRole("button", { name: "Send" })
        .matches(`${MODAL} :is(.modal-btn.primary, .btn-primary)`),
    ).toBe(true);
    const tick = within(box).getByRole("checkbox", { name: "Mark as urgent" });
    expect(tick.matches(`${MODAL} .modal-radio input:is([type="checkbox"], [type="radio"])`)).toBe(
      true,
    );
    // The pointer's rule stops at a ticked box, so the lapis fill below it stands.
    expect(chromeCss).toContain(
      `input:is([type="checkbox"], [type="radio"]):hover:not(:disabled, :checked) {\n  border-color: var(--kleio-lapis);\n  background-color: rgb(0 0 0 / 0.18);\n}`,
    );
    expect(chromeCss).toContain(
      `${MODAL} .modal-radio input:is([type="checkbox"], [type="radio"]):checked {\n  border-color: var(--kleio-lapis);\n  background-color: var(--kleio-lapis);`,
    );
  });

  it("draws a schedule's dialog flat: bounded kinds, square day chips, a flat list and Settings' switch", async () => {
    await act(async () => {
      render(<Schedules blob={scout} onChanged={async () => undefined} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("dialog", { name: "Edit schedule" });
    expect(box.className).toBe("modal");

    const kinds = within(box).getByRole("radiogroup", { name: "When" });
    expect(kinds.matches(`${MODAL} .kleio-seg`)).toBe(true);
    expect(
      within(kinds)
        .getByRole("radio", { name: "Weekly" })
        .matches(`${MODAL} .kleio-seg button[aria-checked="true"]`),
    ).toBe(true);
    expect(
      within(box)
        .getByRole("button", { name: "Mon" })
        .matches(`${MODAL} .kleio-day[aria-pressed="true"]`),
    ).toBe(true);
    expect(within(box).getByRole("button", { name: "Tue" }).matches(`${MODAL} .kleio-day`)).toBe(
      true,
    );
    const notify = within(box).getByRole("checkbox", { name: /Notify me/ });
    expect(notify.matches(`${SWITCH} > input`)).toBe(true);
    fireEvent.click(within(kinds).getByRole("radio", { name: "Repeat" }));
    expect(
      within(box).getByRole("button", { name: "Every" }).matches(`${MODAL} .dropdown-trigger`),
    ).toBe(true);

    // No pill, rim, bead or blur is left on any of them.
    expect(chromeCss).toContain(
      `${MODAL} .kleio-seg {\n  padding: 2px;\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;\n  background: none;\n  box-shadow: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${MODAL} .kleio-seg button[aria-checked="true"] {\n  background: var(--kleio-raised);\n  box-shadow: none;`,
    );
    expect(chromeCss).toContain(
      `${MODAL} .kleio-day {\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;\n  background: transparent;\n  box-shadow: none;`,
    );
    expect(chromeCss).toContain(
      `${MODAL} .kleio-day[aria-pressed="true"] {\n  border-color: var(--kleio-lapis);\n  background: var(--kleio-raised);\n  box-shadow: none;`,
    );
    expect(chromeCss).toContain(
      `${MODAL} .dropdown-trigger {\n  border-color: var(--kleio-edge);\n  border-radius: 3px;\n  background: rgb(0 0 0 / 0.18);\n  box-shadow: none;`,
    );
    expect(chromeCss).toContain(
      `${MODAL} .dropdown-menu {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 3px;\n  background: var(--kleio-surface) !important;\n  box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${SWITCH} > input:active + span::before {\n  float: none;\n  display: block;\n  box-sizing: border-box;\n  width: 26px;\n  height: 14px;\n  margin: 0;\n  border: 1px solid var(--kleio-muted);\n  border-radius: 0;\n  background: none;\n  box-shadow: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${SWITCH} > input:active:not(:disabled) + span::after {\n  top: 3px;\n  right: auto;\n  left: 3px;\n  width: 8px;\n  height: 8px;\n  border-radius: 0;\n  background: var(--kleio-text-2);\n  box-shadow: none;`,
    );
  });

  it("draws the iPhone's dialogs the same: the redesign is shared", () => {
    document.documentElement.classList.replace("platform-macos", "platform-ios");
    render(
      <ConfirmModal title="Delete this chat?" message="Gone." onConfirm={none} onClose={none} />,
    );
    expect(screen.getByRole("dialog", { name: "Delete this chat?" }).matches(MODAL)).toBe(true);
  });
});

describe("toasts, the update banner and the bar's pills, flat", () => {
  it("draws a toast as a flat slip in the session's tones", async () => {
    await act(async () => {
      render(<Toaster />);
      toast("Saved your settings", "success", 0);
    });
    // The message is also in the screen reader's live region: take the slip itself.
    const slip = document.querySelector(".toast");
    expect(slip?.textContent).toContain("Saved your settings");
    expect(slip?.matches("html:root .toast")).toBe(true);
    // Toaster colours the mark inline from these tokens, so the rule re-points them.
    expect(slip?.querySelector(".toast-icon")?.getAttribute("style")).toContain("--success");
    expect(chromeCss).toContain(
      "html:root .toast {\n  --primary: var(--kleio-lapis);\n  --success: var(--kleio-done);\n  --warning: var(--kleio-lapis);",
    );
  });

  it("draws the update banner as a quiet bar with a bounded Install, and its progress in lapis", () => {
    const update = {
      update: null,
      version: "2.3.0",
      phase: "available",
      progress: null,
      install: async () => undefined,
    } as Parameters<typeof UpdateBanner>[0]["update"];
    const view = render(<UpdateBanner update={update} />);
    const banner = screen.getByRole("button", { name: /Kleio just got an update/ });
    expect(banner.matches("html:root .update-banner")).toBe(true);
    expect(screen.getByText("Install").matches("html:root .update-banner .badge")).toBe(true);
    view.rerender(<UpdateBanner update={{ ...update, phase: "installing", progress: 42 }} />);
    const fill = screen.getByRole("progressbar").querySelector(".update-banner-fill");
    expect(fill?.matches("html:root .update-banner .update-banner-fill")).toBe(true);
    expect(chromeCss).toContain("html:root .update-banner::after {\n  display: none;\n}");
  });

  it("draws a count or a state in the bar as Settings' outline pill, and not in Settings or the project list", async () => {
    const pill =
      "html:not(.platform-ios) :not(.settings-screen, .project-picker) > .picker-head :is(.badge, .settings-head-status .badge)";
    await act(async () => {
      render(
        <div className="picker kleio-screen">
          <div className="kleio-page">
            <KleioHead onBack={() => undefined} title="Specialists" status={<Badge>4</Badge>} />
          </div>
        </div>,
      );
    });
    expect(screen.getByText("4").matches(pill)).toBe(true);
    cleanup();

    for (const screenClass of ["picker settings-screen", "picker project-picker"]) {
      render(
        <div className={screenClass}>
          <div className="picker-head">
            <Badge>4</Badge>
          </div>
        </div>,
      );
      expect(screen.getByText("4").matches(pill), screenClass).toBe(false);
      cleanup();
    }
  });
});

describe("every switch on the desktop, flat", () => {
  it("draws a page's switch as it draws a dialog's: one rule for both, no bead or halo", async () => {
    await act(async () => {
      render(
        <div className="picker kleio-screen">
          <Schedules blob={scout} onChanged={async () => undefined} />
        </div>,
      );
    });
    const onPage = screen.getByRole("checkbox", { name: "Morning check-in on" });
    expect(onPage.closest(".modal")).toBeNull();
    expect(onPage.matches(`${SWITCH} > input`)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const inDialog = within(screen.getByRole("dialog", { name: "Edit schedule" })).getByRole(
      "checkbox",
      { name: /Notify me/ },
    );
    expect(inDialog.matches(`${SWITCH} > input`)).toBe(true);

    // One rule, scoped to neither: a square track and a square thumb.
    expect(chromeCss).not.toContain(".modal .cl-switch");
    expect(chromeCss).not.toContain(".kleio-screen .cl-switch");
    expect(chromeCss).toContain(
      `${SWITCH} > input:active + span::before {\n  float: none;\n  display: block;\n  box-sizing: border-box;\n  width: 26px;\n  height: 14px;\n  margin: 0;\n  border: 1px solid var(--kleio-muted);\n  border-radius: 0;\n  background: none;\n  box-shadow: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${SWITCH} > input:active:not(:disabled) + span::after {\n  top: 3px;\n  right: auto;\n  left: 3px;\n  width: 8px;\n  height: 8px;\n  border-radius: 0;\n  background: var(--kleio-text-2);\n  box-shadow: none;\n  scale: none;`,
    );
    // A press is named beside the resting thumb, so glass.css's swell loses; the
    // pointer's twin keeps the desktop's scope (a tap leaves iOS's hover on).
    expect(chromeCss).toContain(
      `${SWITCH} > input + span::after,\n${SWITCH} > input:active:not(:disabled) + span::after {`,
    );
    expect(chromeCss).toContain(
      "html:not(.platform-ios) .cl-switch:hover > input:not(:disabled) + span::after {",
    );
  });

  it("draws a specialist's form's own switch the same, and both in system colours under high contrast", async () => {
    let container: HTMLElement = document.body;
    await act(async () => {
      ({ container } = render(
        <div className="picker kleio-screen">
          <CastSchedules blob={scout} onChanged={async () => undefined} />
        </div>,
      ));
    });
    if (!container.querySelector(".cast-switch")) {
      fireEvent.click(container.querySelector(".cast-mark") as HTMLElement);
    }
    const own = container.querySelectorAll(".cast-switch input");
    expect(own.length).toBeGreaterThan(0);
    for (const input of own) expect(input.matches(`${CAST_SWITCH} input`)).toBe(true);
    const day = container.querySelector(".cast-days button");
    expect(day?.matches(`${KLEIO} .cast-days button`)).toBe(true);

    expect(chromeCss).toContain(
      `${CAST_SWITCH} input + span {\n  box-sizing: border-box;\n  border: 1px solid var(--kleio-muted);\n  border-radius: 0;\n  background: none;\n  box-shadow: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${CAST_SWITCH} input + span::after {\n  top: 2px;\n  left: 2px;\n  width: 8px;\n  height: 8px;\n  border-radius: 0;\n  background: var(--kleio-text-2);\n  box-shadow: none;`,
    );
    expect(chromeCss).toContain(
      `${KLEIO} .cast-days button {\n  border-color: var(--kleio-edge);\n  border-radius: 3px;`,
    );
    expect(chromeCss).toContain(
      `@media (forced-colors: active) {\n  ${SWITCH} > input + span::before,\n  ${SWITCH} > input:checked + span::before,\n  ${CAST_SWITCH} input + span,\n  ${CAST_SWITCH} input:checked + span {\n    border-color: CanvasText;\n  }`,
    );
  });

  it("draws the iPhone's switches the same", async () => {
    document.documentElement.classList.replace("platform-macos", "platform-ios");
    await act(async () => {
      render(<Schedules blob={scout} onChanged={async () => undefined} />);
    });
    const onPage = screen.getByRole("checkbox", { name: "Morning check-in on" });
    expect(onPage.matches(`${SWITCH} > input`)).toBe(true);
  });
});

describe("Specialists and Groups, flat", () => {
  const tabs = [
    { id: "blobs" as const, label: "Specialists", icon: CirclesThreeIcon },
    { id: "groups" as const, label: "Groups", icon: ChatsCircleIcon },
  ];

  it("draws a specialist's side cards and the dock as flat panels, with no blur behind", () => {
    render(
      <div className="picker kleio-screen has-dock">
        <KleioPanel title="Job" />
        <SettingsTabBar tabs={tabs} selected="blobs" onSelect={() => undefined} panelId="p" />
      </div>,
    );
    expect(screen.getByRole("region", { name: "Job" }).matches(`${KLEIO} .kleio-panel`)).toBe(true);
    expect(screen.getByRole("tablist").matches(`${KLEIO} .settings-tabs`)).toBe(true);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.matches(`${KLEIO} .settings-tab`)).toBe(true);
    }
    expect(chromeCss).toContain(
      `${KLEIO} .kleio-panel {\n  border: 1px solid var(--kleio-rule-strong);\n  border-radius: 6px;\n  background: none;\n  box-shadow: none;\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}`,
    );
    expect(chromeCss).toContain(
      `${KLEIO} .settings-tabs {\n  border: 1px solid var(--kleio-rule-strong);\n  border-radius: 12px;\n  background: var(--kleio-surface);\n  box-shadow: none;\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}`,
    );
  });

  it("has no pill, rim or blur left on its buttons, chips, message boxes or what you said", () => {
    // A profile's actions, a first group's button and Delete: bounded, with one crimson.
    expect(chromeCss).toContain(
      `${KLEIO} .cast-p-actions .btn,\n${KLEIO} .cast-btn-lg,\n${KLEIO} .kleio-danger-btn {\n  --glass-hover-scale: 1;\n  --glass-press-scale: 1;\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;\n  background: transparent;\n  box-shadow: none;\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;`,
    );
    expect(chromeCss).toContain(
      `${KLEIO} .cast-p-actions .btn-primary,\n${KLEIO} .btn-primary.cast-btn-lg {\n  border-color: transparent;\n  background: var(--kleio-crimson);\n  color: #fff;\n}`,
    );
    expect(chromeCss).toContain(`${KLEIO} .metal-button > .action-metal {\n  display: none;\n}`);
    // Both message boxes, their mic and Send, the @mention and try-this chips, a member's tick.
    for (const rule of [
      `${KLEIO} .kleio-composer .inputwrap {\n  border: 1px solid var(--kleio-rule-strong);\n  border-radius: 12px;\n  background: var(--kleio-surface);\n  box-shadow: none;\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}`,
      `${KLEIO} .kleio-composer .icon-circle {\n  --glass-hover-scale: 1;\n  --glass-press-scale: 1;\n  border-radius: 3px;\n  box-shadow: none;\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}`,
      `${KLEIO} .cast-input {\n  border-color: var(--kleio-rule-strong);\n  border-radius: 12px;`,
      `${KLEIO} .cast-send {\n  border-radius: 3px;\n}`,
      `${KLEIO} .cast-mentions button {\n  border-color: var(--kleio-edge);\n  border-radius: 3px;`,
      `${KLEIO} .kleio-example {\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;`,
      `${KLEIO} .kleio-check {\n  border-radius: 3px;`,
      `${KLEIO} .cast-shuffle {\n  border-color: var(--kleio-edge);\n  border-radius: 3px;`,
      `${KLEIO} .kleio-transcript .user-msg {\n  border-color: var(--kleio-rule);\n  border-radius: 14px 14px 4px 14px;\n  background: var(--kleio-raised);\n  box-shadow: none;`,
    ]) {
      expect(chromeCss).toContain(rule);
    }
  });

  it("draws the iPhone's specialists the same", () => {
    document.documentElement.classList.replace("platform-macos", "platform-ios");
    render(
      <div className="picker kleio-screen">
        <KleioPanel title="Job" />
      </div>,
    );
    expect(screen.getByRole("region", { name: "Job" }).matches(`${KLEIO} .kleio-panel`)).toBe(true);
  });
});
