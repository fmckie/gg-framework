// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BackButton } from "../BackButton";
import { RadioButton } from "../RadioButton";
import { WindowLayoutButton } from "../WindowLayoutButton";
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
