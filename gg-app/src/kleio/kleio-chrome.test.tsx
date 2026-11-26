// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BackButton } from "../BackButton";
import { RadioButton } from "../RadioButton";
import { WindowLayoutButton } from "../WindowLayoutButton";
import { ScorecardModal } from "../ScorecardModal";
import { SessionHelp } from "../SessionHelp";
import { VoiceGuide } from "./VoiceGuide";
import mainSource from "../main.tsx?raw";
import chromeCss from "./kleio-chrome.css?raw";
import themeCss from "./kleio-theme.css?raw";

vi.mock("../agent", () => ({
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

const BAR = "html:not(.platform-ios) :not(.settings-screen) > .picker-head";
const RADIO = "html:not(.platform-ios) .radio-modal";
const GUIDE = "html:not(.platform-ios) .session-help";
const SCORECARD = "html:not(.platform-ios) .scorecard-modal";

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

  it("leaves Settings' own flat header and the iPhone's bar alone", async () => {
    await mountBar("picker settings-screen");
    expect(screen.getByRole("button", { name: "Back" }).matches(`${BAR} .btn`)).toBe(false);
    cleanup();

    document.documentElement.classList.replace("platform-macos", "platform-ios");
    await mountBar();
    expect(screen.getByRole("button", { name: "Back" }).matches(`${BAR} .btn`)).toBe(false);
  });

  it("draws the radio dialog flat: panel, station list, Play, slider and close", async () => {
    await mountBar();
    await act(async () => {
      fireEvent.click(screen.getByTitle("Internet radio"));
    });
    const dialog = screen.getByRole("dialog", { name: "Internet Radio" });
    expect(dialog.matches("html:not(.platform-ios) .modal.radio-modal")).toBe(true);

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
      "html:not(.platform-ios) .modal.radio-modal {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 6px;\n  background: var(--kleio-surface) !important;",
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
        guide: <VoiceGuide phone={false} onClose={() => undefined} />,
      },
    ];
    for (const { name, guide } of guides) {
      render(guide);
      const dialog = screen.getByRole("dialog", { name });
      expect(dialog.matches("html:not(.platform-ios) .modal.session-help")).toBe(true);
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
      "html:not(.platform-ios) .modal.session-help {\n  border-color: var(--kleio-edge) !important;\n  border-radius: 6px;\n  background: var(--kleio-surface) !important;",
    );
    expect(chromeCss).toContain(
      `${GUIDE} .session-help-section + .session-help-section {\n  padding-top: 20px;\n  border-top: 1px solid var(--kleio-rule);\n}`,
    );
  });

  it("leaves the iPhone's sheet alone", () => {
    document.documentElement.classList.replace("platform-macos", "platform-ios");
    render(<SessionHelp mode="code" phone onClose={() => undefined} />);
    const sheet = screen.getByRole("dialog", { name: "How this screen works" });
    expect(sheet.matches("html:not(.platform-ios) .modal.session-help")).toBe(false);
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
    expect(dialog.matches("html:not(.platform-ios) .modal.scorecard-modal")).toBe(true);
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
