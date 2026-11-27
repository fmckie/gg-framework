// @vitest-environment jsdom
// The iPhone draws the desktop's look. A rule of the redesign is under
// `html:root`, so both get it; only a `:hover` rule keeps the desktop's
// `html:not(.platform-ios)`, because a tap leaves iOS's hover stuck on
// (scripts/share-desktop-css.mjs rescopes what a merge brings in). What the
// phone's width, touch and keyboard force is kleio-phone.css, which has to win
// the cascade against the rules it fits: these work that out from the real
// stylesheets (weight, order, !important) on the real session's markup.
import { cleanup, render, screen } from "@testing-library/react";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentState } from "../agent";
import { SETUP_SEEN_KEY } from "../app-entry-view";

mockWindows("main");
mockIPC(() => new Promise(() => {}));
const { default: App } = await import("../App");

const DESKTOP = "html:not(.platform-ios)";
const SHARED = "html:root";
const PHONE = "html.platform-ios";
/** An iPhone 16, in points. */
const SCREEN = { width: 393, height: 852 };

const SHEETS = import.meta.glob<string>("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});
/** The order main.tsx loads them in. Any other sheet belongs to a component,
 *  and may load after these (a lazy page's does), so it is taken last: a phone
 *  rule has to outweigh it, not just follow it. */
const LOADED = [
  "../App.css",
  "../glass.css",
  "./kleio-theme.css",
  "./kleio-pages.css",
  "./kleio-settings.css",
  "./kleio-chrome.css",
  "./kleio-phone.css",
];

type Declaration = { value: string; important: boolean };
type Rule = {
  sheet: string;
  selector: string;
  weight: number;
  order: number;
  declarations: Map<string, Declaration>;
};
type Winner = Declaration & { property: string; selector: string; sheet: string };

/** Index after the string that opens at `i`, or `i` when none does. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  if (quote !== '"' && quote !== "'") return i;
  let end = i + 1;
  while (end < text.length && text[end] !== quote) end += text[end] === "\\" ? 2 : 1;
  return end + 1;
}

/** Index of the bracket that closes the one at `open`. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const close = pairs[text[open] ?? ""];
  let depth = 0;
  for (let i = open; i < text.length;) {
    const next = skipString(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (text[i] === text[open]) depth += 1;
    else if (text[i] === close && --depth === 0) return i;
    i += 1;
  }
  throw new Error(`unclosed ${text[open]} in: ${text.slice(open, open + 60)}`);
}

/** Split on `separator` outside brackets and strings. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (char === '"' || char === "'") i = skipString(text, i);
    else if (char === "(" || char === "[") i = closing(text, i) + 1;
    else {
      if (char === separator) {
        parts.push(text.slice(from, i));
        from = i + 1;
      }
      i += 1;
    }
  }
  parts.push(text.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** A selector's weight: ids, classes and types as one number. */
function weight(selector: string): number {
  let total = 0;
  for (let i = 0; i < selector.length;) {
    const char = selector[i] ?? "";
    const word = (from: number): string => /^[\w-]*/.exec(selector.slice(from))?.[0] ?? "";
    if (char === "[") {
      total += 100;
      i = closing(selector, i) + 1;
    } else if (char === "#" || char === ".") {
      total += char === "#" ? 10000 : 100;
      i += 1 + word(i + 1).length;
    } else if (char === ":") {
      const element = selector[i + 1] === ":";
      const name = word(i + (element ? 2 : 1));
      i += name.length + (element ? 2 : 1);
      let inside: string | null = null;
      if (selector[i] === "(") {
        const end = closing(selector, i);
        inside = selector.slice(i + 1, end);
        i = end + 1;
      }
      if (element) total += 1;
      else if (name === "is" || name === "not" || name === "has")
        total += Math.max(...splitTop(inside ?? "", ",").map(weight));
      else if (name !== "where") total += 100;
    } else if (/[a-zA-Z]/.test(char)) {
      total += 1;
      i += word(i).length;
    } else i += 1;
  }
  return total;
}

/** Whether a media query holds on the phone: portrait, touch, motion allowed. */
function onPhone(query: string): boolean {
  return splitTop(query, ",").some((alternative) =>
    alternative.split(/\band\b/).every((feature) => {
      const [, name = "", value = ""] = /\(\s*([\w-]+)\s*:\s*([^)]+)\)/.exec(feature) ?? [];
      const size = Number.parseFloat(value);
      if (name === "max-width") return SCREEN.width <= size;
      if (name === "min-width") return SCREEN.width >= size;
      if (name === "max-height") return SCREEN.height <= size;
      if (name === "hover") return value.trim() === "none";
      if (name === "prefers-reduced-motion") return value.trim() === "no-preference";
      return false;
    }),
  );
}

function readRules(sheet: string, css: string, rules: Rule[]): void {
  for (let i = 0; i < css.length;) {
    const open = css.indexOf("{", i);
    if (open < 0) return;
    const close = closing(css, open);
    const prelude = css.slice(i, open).trim();
    const body = css.slice(open + 1, close);
    i = close + 1;
    if (prelude.startsWith("@media")) {
      if (onPhone(prelude.slice(6))) readRules(sheet, body, rules);
    } else if (prelude.startsWith("@supports")) readRules(sheet, body, rules);
    else if (!prelude.startsWith("@")) {
      const declarations = new Map<string, Declaration>();
      for (const line of splitTop(body, ";")) {
        const colon = line.indexOf(":");
        const value = line.slice(colon + 1).trim();
        declarations.set(line.slice(0, colon).trim(), {
          value: value.replace(/\s*!important$/, "").replace(/\s+/g, " "),
          important: value.endsWith("!important"),
        });
      }
      for (const selector of splitTop(prelude, ","))
        rules.push({
          sheet,
          selector: selector.replace(/\s+/g, " "),
          weight: weight(selector),
          order: rules.length,
          declarations,
        });
    }
  }
}

const RULES: Rule[] = [];
const text = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
for (const sheet of LOADED) readRules(sheet, text(SHEETS[sheet] ?? ""), RULES);
for (const [sheet, css] of Object.entries(SHEETS))
  if (!LOADED.includes(sheet)) readRules(sheet, text(css), RULES);

/** What the phone's cascade gives `el` for the first of `properties` (a
 *  longhand and the shorthands that set it) that any rule sets. */
function phoneStyle(el: Element, ...properties: string[]): Winner | null {
  let best: Winner | null = null;
  let bestRank = [-1, -1, -1];
  for (const rule of RULES) {
    // A pseudo-element's rule styles no element.
    if (rule.selector.includes("::")) continue;
    for (const property of properties) {
      const declared = rule.declarations.get(property);
      if (!declared || !matches(el, rule.selector)) continue;
      const rank = [declared.important ? 1 : 0, rule.weight, rule.order];
      const differs = rank.findIndex((n, i) => n !== bestRank[i]);
      if ((rank[differs] ?? 0) < (bestRank[differs] ?? 0)) continue;
      best = { ...declared, property, selector: rule.selector, sheet: rule.sheet };
      bestRank = rank;
    }
  }
  return best;
}

/** A selector jsdom cannot read (a vendor pseudo-class) matches nothing. */
function matches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

describe("the desktop's rules, shared with the iPhone", () => {
  const selectors = RULES.map((rule) => `${rule.sheet}: ${rule.selector}`);

  it("reads every stylesheet", () => {
    expect(Object.keys(SHEETS)).toEqual(expect.arrayContaining(LOADED));
    expect(RULES.length).toBeGreaterThan(3000);
  });

  it("gives the shared scope and the phone's the weight of the desktop's, so nothing moved", () => {
    expect([weight(SHARED), weight(PHONE)]).toEqual([weight(DESKTOP), weight(DESKTOP)]);
  });

  it("keeps a rule desktop only for one reason, a hover", () => {
    expect(selectors.filter((s) => s.includes(DESKTOP) && !s.includes(":hover"))).toEqual([]);
  });

  it("shares no hover, which a tap would leave on", () => {
    expect(selectors.filter((s) => s.includes(SHARED) && s.includes(":hover"))).toEqual([]);
  });
});

// kleio-cast.css loads with its page, after the phone's sheet, so a tie goes to
// the Cast: the cascade above takes it last, and the phone's rule must still win.
describe("on the iPhone, the Cast", () => {
  beforeEach(() => {
    document.documentElement.classList.add("platform-ios");
    document.body.innerHTML = `
      <div class="cast-page" data-tier="crowd">
        <div class="cast"><div class="cast-row"></div></div>
        <section class="cast-profile is-group"><div class="cast-p-col"></div></section>
      </div>
      <div class="cast-form cast-gform">
        <div class="cast-creator">
          <div class="cast-creator-grid"><div class="cast-who"></div></div>
        </div>
      </div>
      <div class="cast-room"><div class="cast-thread"></div><div class="cast-composer"></div></div>`;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("platform-ios");
  });

  const fitted = (selector: string, property: string): Winner | null => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no ${selector}`);
    return phoneStyle(el, property);
  };

  it("is one column: the profile, in any tier, and the form", () => {
    for (const selector of [".cast-profile", ".cast-creator-grid"])
      expect(fitted(selector, "grid-template-columns"), selector).toMatchObject({
        value: "minmax(0, 1fr)",
        sheet: "./kleio-phone.css",
      });
    expect(fitted(".cast-p-col", "padding-left")).toMatchObject({ value: "0" });
    expect(fitted(".cast-who", "position")).toMatchObject({ value: "static" });
  });

  it("keeps a place wide enough to press, on a shelf that scrolls sideways", () => {
    expect(fitted(".cast-page", "--slot")?.value).toMatch(/^max\(84px, /);
    expect(fitted(".cast-page", "--inset")).toMatchObject({ value: "16px" });
    expect(fitted(".cast", "overflow-x")).toMatchObject({ value: "auto" });
    expect(fitted(".cast-row", "width")).toMatchObject({ value: "max-content" });
  });

  it("gives the room's thread and message box the screen's width", () => {
    expect(fitted(".cast-thread", "padding")).toMatchObject({ value: "0 16px" });
    expect(fitted(".cast-composer", "padding")).toMatchObject({ value: "8px 16px 12px" });
  });
});

const STATE: AgentState = {
  cwd: "/workspaces/chrome",
  mode: "code",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  running: false,
  thinkingLevel: "medium",
  supportedThinkingLevels: ["low", "medium", "high"],
};
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

describe("on the iPhone, a Code session", () => {
  let app: HTMLElement;

  beforeEach(async () => {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    localStorage.setItem(SETUP_SEEN_KEY, "1");
    document.documentElement.classList.add("platform-ios");
    mockWindows("main");
    mockIPC((command) => {
      switch (command) {
        case "window_restore_target":
          return { mode: "code", cwd: STATE.cwd, sessionPath: null };
        case "sidecar_port":
          return 12345;
        case "agent_state":
          return STATE;
        case "agent_models":
          return { models: [{ id: STATE.model, provider: STATE.provider }] };
        case "agent_commands":
          return { commands: [] };
        case "agent_tasks":
          return { tasks: [] };
        case "agent_history":
          return { history: [] };
        case "plugin:log|log":
          return null;
        default:
          return new Promise(() => {});
      }
    });
    const { container } = render(<App />);
    await screen.findByRole("button", { name: "Back to this project's sessions" });
    await screen.findByText("chrome");
    const root = container.querySelector<HTMLElement>(".app.app-session");
    if (!root) throw new Error("no session root");
    app = root;
  });
  afterEach(() => {
    cleanup();
    clearMocks();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove("platform-ios");
    if (scrollToDescriptor)
      Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("matches a :has() rule, so no rule is skipped unseen", () => {
    expect(app.matches(".app:has(> .chat-head)")).toBe(true);
  });

  it("sets every field at 16px or more, so iOS never zooms the page", () => {
    const fields = [...app.querySelectorAll("input, textarea, select")];
    expect(fields.some((field) => field.matches("textarea.input"))).toBe(true);
    for (const field of fields) {
      expect(phoneStyle(field, "font-size", "font")).toMatchObject({
        property: "font-size",
        value: "max(16px, 1em)",
        important: true,
        sheet: "./kleio-phone.css",
      });
    }
  });

  it("makes each control in the header 36px tall, for a thumb", () => {
    const controls = [...app.querySelectorAll(".chat-head :is(.btn, .nav-toggle, .kleio-badge)")];
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) {
      expect(phoneStyle(control, "min-height")).toMatchObject({
        value: "36px",
        sheet: "./kleio-phone.css",
      });
    }
  });

  it("shows the rank in the tools row, which the phone used to hide", () => {
    const rank = app.querySelector(".chat-head-nav .rank-badge-wrap");
    if (!rank) throw new Error("no rank in the tools row");
    expect(phoneStyle(rank, "display")?.value).not.toBe("none");
  });

  it("has the session's bloom, scaled to the screen", () => {
    const bloom = phoneStyle(app, "background-image", "background");
    expect(bloom).toMatchObject({ important: true, sheet: "./kleio-phone.css" });
    expect(bloom?.value).toContain("80vw 64vw at 0 0,");
    expect(bloom?.value).not.toContain("620px");
    expect(phoneStyle(app, "background-color")?.value).toBe("#161213");
  });
});

// Home's ways in are the desktop's plates on the iPhone too (KleioHome.tsx).
// The desktop's grid is three, two and one, which a 393px screen can't hold:
// the phone sets them two to a row, at the desktop's own scale.
describe("on the iPhone, Kleio's Home", () => {
  beforeEach(() => {
    document.documentElement.classList.add("platform-ios");
    const plates = ["Chat", "Code", "Motion", "Goals", "Specialists"]
      .map((label) => `<button class="kleio-plate">${label}</button>`)
      .join("");
    document.body.innerHTML = `
      <div class="home kleio-home">
        <div class="home-actions">${plates}<button class="kleio-plate home-brief">Voice agent</button></div>
      </div>`;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("platform-ios");
  });

  it("sets the desktop's plates two to a row, at the desktop's scale", () => {
    const row = document.querySelector(".home-actions");
    if (!row) throw new Error("no .home-actions");
    expect(phoneStyle(row, "display")).toMatchObject({ value: "grid" });
    expect(phoneStyle(row, "--plate-scale")).toMatchObject({
      value: "calc(4 / 3)",
      sheet: "./kleio-phone.css",
    });
    expect(phoneStyle(row, "grid-template-columns")?.value).toMatch(/^repeat\(4, /);
    const plates = [...row.querySelectorAll(".kleio-plate")];
    expect(plates).toHaveLength(6);
    for (const plate of plates)
      expect(phoneStyle(plate, "grid-column"), plate.textContent ?? "").toMatchObject({
        value: "span 2",
      });
  });

  it("leaves a plate its full height: no rule left from the pills squeezes it", () => {
    const brief = document.querySelector(".home-brief");
    if (!brief) throw new Error("no .home-brief");
    expect(phoneStyle(brief, "height")?.value).toBe("calc(46px * var(--s))");
  });
});

describe("on the iPhone, a goal's bar", () => {
  beforeEach(() => document.documentElement.classList.add("platform-ios"));
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove("platform-ios");
  });

  it("is the desktop's bar, with every control and the settings dialog's Close 44px for a thumb", async () => {
    const { GoalPanel } = await import("../placeholder/GoalPanel");
    render(
      <div className="app app-session">
        <GoalPanel
          goal={{ id: "g", name: "API latency", needsKickoff: false, phase: "active" }}
          view="workers"
          onViewChange={() => {}}
          models={[]}
          onSelectWorkerModel={() => {}}
          onPauseChange={() => {}}
        />
      </div>,
    );
    const bar = screen.getByRole("group", { name: "Goal" });
    expect(bar.className).toBe("goal-bar");
    const controls = [
      ...bar.querySelectorAll(".goal-bar-views > button, .goal-bar-actions > button"),
      screen.getByRole("combobox"),
    ];
    expect(controls).toHaveLength(5);
    for (const control of controls)
      expect(phoneStyle(control, "height"), control.textContent ?? "").toMatchObject({
        value: "44px",
        sheet: "./kleio-phone.css",
      });

    screen.getByRole("button", { name: "Goal settings" }).click();
    const close = await screen.findByRole("button", { name: "Close" });
    expect(close.closest(".goal-form-modal")).not.toBeNull();
    expect(phoneStyle(close, "height")).toMatchObject({ value: "44px" });
    expect(phoneStyle(close, "width")).toMatchObject({ value: "44px" });
  });
});
