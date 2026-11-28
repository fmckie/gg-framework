// @vitest-environment jsdom
// The iPhone draws the desktop's look. A rule of the redesign is under
// `html:root`, so both get it; only a `:hover` rule keeps the desktop's
// `html:not(.platform-ios)`, because a tap leaves iOS's hover stuck on
// (scripts/share-desktop-css.mjs rescopes what a merge brings in). What the
// phone's width, touch and keyboard force is kleio-phone.css, which has to win
// the cascade against the rules it fits: these work that out from the real
// stylesheets (weight, order, !important) on the real session's markup.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("sizes every place to its picture, in every tier, and the row to what rises over it", () => {
    for (const tier of ["solo", "one", "two", "crowd"]) {
      document.querySelector(".cast-page")?.setAttribute("data-tier", tier);
      expect(fitted(".cast-page", "--size"), tier).toMatchObject({ value: "56px" });
      expect(fitted(".cast-page", "--slot"), tier).toMatchObject({ value: "76px" });
      expect(fitted(".cast-page", "--row-h")?.value, tier).toBe(
        "calc(var(--size) + var(--floor) + 36px)",
      );
    }
    expect(fitted(".cast-page", "--inset")).toMatchObject({ value: "16px" });
    expect(fitted(".cast-row", "width")).toMatchObject({ value: "max-content" });
  });

  it("scrolls the shelf sideways only, each place settling at the edge, nothing bouncing", () => {
    document.body.innerHTML = `
      <div class="cast-page" data-tier="crowd">
        <div class="cast" data-scroll><div class="cast-row"><button class="cast-actor"></button></div></div>
        <p class="cast-more">4 more below · scroll</p>
      </div>`;
    expect(fitted(".cast", "overflow-x")).toMatchObject({ value: "auto" });
    expect(fitted(".cast", "overflow-y")).toMatchObject({ value: "hidden" });
    expect(fitted(".cast", "max-height")).toMatchObject({ value: "none" });
    expect(fitted(".cast", "scroll-snap-type")).toMatchObject({ value: "x mandatory" });
    expect(fitted(".cast", "scroll-padding-inline")).toMatchObject({ value: "var(--inset)" });
    expect(fitted(".cast", "overscroll-behavior-x")).toMatchObject({ value: "none" });
    // A swipe up or down still moves the page around it.
    expect(fitted(".cast", "overscroll-behavior-y")).toMatchObject({ value: "auto" });
    expect(fitted(".cast", "mask-image")).toMatchObject({ value: "none" });
    expect(fitted(".cast-actor", "scroll-snap-align")).toMatchObject({ value: "start" });
    expect(fitted(".cast-actor", "height")?.value).toBe("calc(var(--size) + var(--floor) + 12px)");
    expect(fitted(".cast-more", "display")).toMatchObject({ value: "none" });
  });

  it("wraps a long word or link in the spotlight, so the page stays the screen's width", () => {
    document.body.innerHTML = `
      <div class="cast-page" data-tier="one"><section class="cast-profile"><div class="cast-p-id">
        <p class="cast-p-job">https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789</p>
      </div></section></div>`;
    expect(fitted(".cast-profile", "overflow-wrap")).toMatchObject({ value: "anywhere" });
  });

  it("leads the spotlight with who it is and its buttons, Details at their end", () => {
    document.body.innerHTML = `
      <div class="cast-page" data-tier="crowd"><section class="cast-profile">
        <div class="cast-p-id"><div class="cast-p-head"><h2>Email</h2></div>
          <p class="cast-p-state"></p>
          <p class="cast-p-job clamp-text"><span class="clamp-body">Every weekday…</span></p></div>
        <div class="cast-p-actions"><button class="btn btn-primary btn-sm">Open chat</button></div>
        <button class="btn btn-ghost btn-sm cast-p-more" aria-expanded="false">Details</button>
      </section></div>`;
    expect(fitted(".cast-p-id", "display")).toMatchObject({ value: "flex" });
    expect(fitted(".cast-profile", "grid-template-columns")).toMatchObject({
      value: "minmax(0, 1fr) auto",
    });
    expect(fitted(".cast-p-id", "grid-column")).toMatchObject({ value: "1 / -1" });
    expect(fitted(".cast-p-actions", "grid-column")).toMatchObject({ value: "1" });
    expect(fitted(".cast-p-more", "grid-column")).toMatchObject({ value: "2" });
    expect(fitted(".cast-p-more", "min-height")).toMatchObject({ value: "44px" });
    expect(fitted(".cast-p-actions", "border-top")).toMatchObject({ value: "0" });
    // The job is one line until tapped.
    expect(fitted(".cast-p-job", "display")).toMatchObject({ value: "block" });
    expect(fitted(".cast-p-job > .clamp-body", "-webkit-line-clamp")).toMatchObject({
      value: "1",
    });
  });

  it("keeps a header with a menu to one row, its pills their numbers", () => {
    document.body.innerHTML = `
      <div class="picker kleio-screen has-dock">
        <div class="kleio-page">
          <div class="picker-head kleio-head has-menu">
            <button class="btn btn-ghost btn-icon">Back</button>
            <h1 class="picker-title">Specialists</h1>
            <span class="cast-pills"><span class="cast-pill">3<span class="cast-pill-word"> working</span></span></span>
            <input class="picker-search" />
            <span class="picker-head-actions"><span class="kleio-menu-wrap">
              <button class="btn btn-ghost btn-icon kleio-menu-btn"></button>
              <div class="kleio-menu" role="menu"><button role="menuitem">Connect apps</button></div>
            </span></span>
          </div>
          <div class="cast-page"></div>
        </div>
        <div class="settings-tab-dock"><div class="settings-tabs"><button class="settings-tab"></button></div></div>
      </div>`;
    expect(fitted(".kleio-head > .picker-title", "flex")).toMatchObject({ value: "1 1 0" });
    expect(fitted(".kleio-head > .cast-pills", "flex")).toMatchObject({ value: "none" });
    expect(fitted(".cast-pill-word", "position")).toMatchObject({ value: "absolute" });
    expect(fitted(".kleio-head > .picker-search", "flex")).toMatchObject({ value: "1 1 100%" });
    expect(fitted(".kleio-menu-btn", "width")).toMatchObject({ value: "44px" });
    expect(fitted(".kleio-menu-btn", "height")).toMatchObject({ value: "44px" });
    expect(fitted(".kleio-menu > button", "min-height")).toMatchObject({ value: "44px" });
    expect(fitted(".kleio-menu", "position")).toMatchObject({ value: "absolute" });
    // The Specialists and Groups switch is in the flow, and the list's spacer for it goes.
    expect(fitted(".kleio-screen > .settings-tab-dock", "position")).toMatchObject({
      value: "static",
    });
    expect(fitted(".settings-tab-dock .settings-tab", "height")).toMatchObject({ value: "44px" });
    const spacer = RULES.filter(
      (rule) =>
        rule.selector.endsWith(".kleio-screen.has-dock .cast-page::after") &&
        rule.declarations.has("content"),
    );
    const phone = spacer.find((rule) => rule.sheet === "./kleio-phone.css");
    expect(phone?.declarations.get("content")?.value).toBe("none");
    for (const other of spacer) expect(phone!.weight).toBeGreaterThanOrEqual(other.weight);
  });

  it("draws a room's members as one row of faces, and its chips as one row", () => {
    document.body.innerHTML = `
      <div class="cast-room">
        <div class="cast-room-stage is-crowd"><div class="cast-shelf"></div>
          <div class="cast-room-members">
            <button class="cast-actor cast-member is-live"><span class="cast-figure"></span>
              <span class="cast-name">Quill</span><span class="cast-state">Replying…</span></button>
          </div>
        </div>
        <div class="cast-composer"><div class="cast-mentions"><button>@Quill</button></div></div>
      </div>`;
    expect(fitted(".cast-room-stage", "height")).toMatchObject({ value: "56px" });
    for (const gone of [".cast-shelf", ".cast-name", ".cast-state"])
      expect(fitted(gone, "display"), gone).toMatchObject({ value: "none" });
    expect(fitted(".cast-member", "width")).toMatchObject({ value: "44px" });
    expect(fitted(".cast-member", "height")).toMatchObject({ value: "44px" });
    expect(fitted(".cast-member .cast-figure", "box-shadow")?.value).toContain("--primary-hi");
    expect(fitted(".cast-mentions", "flex-wrap")).toMatchObject({ value: "nowrap" });
    expect(fitted(".cast-mentions", "overflow-x")).toMatchObject({ value: "auto" });
    expect(fitted(".cast-mentions button", "height")).toMatchObject({ value: "44px" });
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
    expect(controls.length).toBeGreaterThan(2);
    for (const control of controls) {
      expect(phoneStyle(control, "min-height")).toMatchObject({
        value: "36px",
        sheet: "./kleio-phone.css",
      });
    }
  });

  it("drops the title line of counts, which the Branch panel holds, and keeps a Chat's", () => {
    const title = app.querySelector(".chat-head-title");
    if (!title) throw new Error("no title line");
    expect(phoneStyle(title, "display")).toMatchObject({
      value: "none",
      sheet: "./kleio-phone.css",
    });
    const ci = document.createElement("span");
    ci.className = "chat-head-ci";
    title.append(ci);
    expect(phoneStyle(title, "display")?.value).not.toBe("none");
    title.classList.add("chat-head-identity");
    ci.remove();
    expect(phoneStyle(title, "display")?.value).not.toBe("none");
  });

  it("keeps Back, Autopilot and New in the tools row, and the rest in More", async () => {
    const nav = app.querySelector(".chat-head-nav");
    if (!nav) throw new Error("no tools row");
    const names = [...nav.querySelectorAll("button, label")].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim(),
    );
    expect(names).toEqual(expect.arrayContaining(["Back to this project's sessions", "New"]));
    expect(nav.querySelector(".autopilot-toggle")).not.toBeNull();
    for (const gone of ["Notes", "Tasks", "Checklist", "Help"])
      expect(
        names.some((name) => name?.startsWith(gone)),
        gone,
      ).toBe(false);
    screen.getByRole("button", { name: /^More/ }).click();
    const more = await screen.findByRole("region", { name: "More" });
    expect(
      [...more.querySelectorAll(".priority-action")].map((action) => action.textContent),
    ).toEqual(["Notes", "Tasks", "Checklist", "Help"]);
  });

  it("presses each header control on 44px: 36 drawn and 4 more each way", () => {
    const tap = RULES.find(
      (rule) =>
        rule.sheet === "./kleio-phone.css" &&
        rule.selector ===
          'html.platform-ios .app.app-session .chat-head :is(button, [role="button"])::after',
    );
    expect(tap?.declarations.get("inset")?.value).toBe("-5px");
    expect(app.querySelector(".chat-head .nav-toggle")?.matches(".chat-head button")).toBe(true);
  });

  it("hides the idle line only for its quip, and joins the composer box back up", () => {
    const line = app.querySelector(".task-activity");
    if (!line) throw new Error("no activity line");
    expect(line.getAttribute("data-phase")).toBe("idle");
    expect(line.hasAttribute("data-quip")).toBe(true);
    expect(phoneStyle(line, "display")).toMatchObject({ value: "none" });
    const composer = app.querySelector(":scope > .inputwrap");
    if (!composer) throw new Error("no composer");
    expect(phoneStyle(composer, "border-radius")).toMatchObject({ value: "12px" });
    line.removeAttribute("data-quip");
    expect(phoneStyle(line, "display")?.value).not.toBe("none");
    expect(phoneStyle(composer, "border-radius")?.value).not.toBe("12px");
  });

  it("puts the status row on one line: no words, no Helper, the model cut short", () => {
    const right = app.querySelector(".footer > .footer-right");
    if (!right) throw new Error("no status row");
    expect(phoneStyle(right, "flex-wrap")).toMatchObject({
      value: "nowrap",
      sheet: "./kleio-phone.css",
    });
    for (const word of app.querySelectorAll(".footer :is(.ctx-word, .thinking-word)"))
      expect(phoneStyle(word, "position")).toMatchObject({ value: "absolute" });
    expect(app.querySelectorAll(".footer .model-anchor")).toHaveLength(1);
    const model = app.querySelector(".footer .model-trigger");
    if (model) expect(phoneStyle(model, "text-overflow")).toMatchObject({ value: "ellipsis" });
  });

  it("hides the activity line's Stop only while the composer's red Stop shows", () => {
    const right = app.querySelector(".task-activity .statusrow-right");
    const send = app.querySelector(".inputwrap .icon-circle-primary");
    if (!right || !send) throw new Error("no activity row or send button");
    const stop = document.createElement("button");
    stop.className = "cancel";
    right.append(stop);
    expect(send.getAttribute("data-action")).toBe("send");
    expect(phoneStyle(stop, "display")?.value).not.toBe("none");
    send.setAttribute("data-action", "stop");
    expect(phoneStyle(stop, "display")).toMatchObject({ value: "none" });
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
        <div class="home-version-row"><button class="kleio-status is-up">Connected to mac-mini-1</button></div>
        <div class="home-actions">${plates}<button class="kleio-plate home-brief">Voice agent</button></div>
        <button class="home-settings" aria-label="Settings"></button>
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

  it("draws Settings' gear 44px square and the host's pill 44px tall, for a thumb", () => {
    const gear = document.querySelector(".home-settings");
    const pill = document.querySelector(".kleio-status");
    if (!gear || !pill) throw new Error("no gear or pill");
    expect(phoneStyle(gear, "width")).toMatchObject({ value: "44px", sheet: "./kleio-phone.css" });
    expect(phoneStyle(gear, "height")).toMatchObject({ value: "44px", sheet: "./kleio-phone.css" });
    const tall = phoneStyle(pill, "min-height");
    expect(tall).toMatchObject({ value: "44px", sheet: "./kleio-phone.css" });
    // Its own 28px height gives way to the minimum.
    expect(phoneStyle(pill, "height")?.value).toBe("28px");
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

  it("is one row: the views and ⋯ drawn 36px and pressed on 44, its menu's entries 44", async () => {
    const { GoalPanel } = await import("../placeholder/GoalPanel");
    render(
      <div className="app app-session">
        <GoalPanel
          goal={{ id: "g", name: "API latency", needsKickoff: false, phase: "active" }}
          view="workers"
          onViewChange={() => {}}
          running
          models={[]}
          onSelectWorkerModel={() => {}}
          onPauseChange={() => {}}
        />
      </div>,
    );
    const bar = screen.getByRole("group", { name: "Goal" });
    expect(phoneStyle(bar, "grid-template-columns")).toMatchObject({
      value: "minmax(0, 1fr) auto auto",
    });
    expect(phoneStyle(bar, "padding")).toMatchObject({ value: "6px 12px 6px 16px" });
    const name = bar.querySelector(".goal-bar-name");
    expect(name && phoneStyle(name, "white-space")).toMatchObject({ value: "nowrap" });
    const more = screen.getByRole("button", { name: "Goal actions" });
    for (const control of [...bar.querySelectorAll(".goal-bar-views > button"), more])
      expect(phoneStyle(control, "height"), control.textContent ?? "").toMatchObject({
        value: "36px",
        sheet: "./kleio-phone.css",
      });
    const reach = (selector: string): string | undefined =>
      RULES.find((rule) => rule.selector === selector)?.declarations.get("inset")?.value;
    expect(
      reach("html.platform-ios .app.app-session > .goal-panel .goal-bar-views > button::after"),
    ).toBe("-4px 0");
    expect(
      reach("html.platform-ios .app.app-session > .goal-panel .goal-bar .kleio-menu-btn::after"),
    ).toBe("-5px");
    // Its menu opens over the courtyard after it.
    const panel = bar.parentElement!;
    expect(phoneStyle(panel, "z-index")).toMatchObject({ value: "5" });

    fireEvent.click(more);
    for (const name of ["Pause the goal", "Goal settings"])
      expect(phoneStyle(screen.getByRole("button", { name }), "min-height"), name).toMatchObject({
        value: "44px",
      });
    const model = screen.getByRole("combobox");
    expect(model.closest(".kleio-menu .goal-menu-model")).not.toBeNull();
    expect(phoneStyle(model, "height")).toMatchObject({ value: "44px" });
    expect(phoneStyle(model, "width")).toMatchObject({ value: "100%" });
    expect(phoneStyle(model, "font-size")).toMatchObject({ value: "max(16px, 1em)" });

    fireEvent.click(screen.getByRole("button", { name: "Goal settings" }));
    const close = await screen.findByRole("button", { name: "Close" });
    expect(close.closest(".goal-form-modal")).not.toBeNull();
    expect(phoneStyle(close, "height")).toMatchObject({ value: "44px" });
    expect(phoneStyle(close, "width")).toMatchObject({ value: "44px" });
  });

  it("drops the Workers' status row, and the gods' lane from the goal's Chat only", () => {
    document.body.innerHTML = `
      <div class="app app-session">
        <div class="goal-panel"><div class="placeholder-bar goal-status"></div></div>
        <div class="liveregion"><div class="oly-lane"></div></div>
      </div>
      <div class="app app-session">
        <div class="liveregion"><div class="oly-lane"></div></div>
      </div>`;
    const status = document.querySelector(".goal-status");
    const [goalLane, lane] = document.querySelectorAll(".oly-lane");
    if (!status || !goalLane || !lane) throw new Error("no goal markup");
    expect(phoneStyle(status, "display")).toMatchObject({ value: "none" });
    expect(phoneStyle(goalLane, "display")).toMatchObject({ value: "none" });
    expect(phoneStyle(lane, "display")).toBeNull();
    expect(phoneStyle(lane, "zoom")).toMatchObject({ value: "0.72" });
  });

  it("scrolls the finish card with the Workers, at a thumb's 44px", () => {
    document.body.innerHTML = `
      <div class="app app-session"><section class="goal-workers"><div class="placeholder-scroll">
        <section class="goal-finish" data-outcome="done"><div>
          <span class="goal-finish-actions"><button>Close</button></span>
        </div></section>
      </div></section></div>`;
    const card = document.querySelector(".goal-finish");
    const close = document.querySelector(".goal-finish-actions > button");
    if (!card || !close) throw new Error("no finish card");
    expect(phoneStyle(card, "display")).toMatchObject({ value: "block" });
    expect(phoneStyle(card, "box-shadow")?.value).toContain("var(--kleio-done)");
    expect(phoneStyle(close, "height")).toMatchObject({ value: "44px" });
  });
});

describe("on the iPhone, Settings", () => {
  beforeEach(() => {
    document.documentElement.classList.add("platform-ios");
    const tabs = Array.from(
      { length: 9 },
      (_, i) => `<button class="settings-tab${i === 0 ? " is-active" : ""}" role="tab"></button>`,
    ).join("");
    document.body.innerHTML = `
      <div class="app">
        <div class="picker settings-screen">
          <div class="picker-head"><button class="btn btn-ghost btn-icon" aria-label="Back"></button></div>
          <div class="settings-scroll"><div class="settings-page">
            <div class="gn-page"></div><div class="ov-page"></div>
          </div></div>
          <div class="settings-tab-dock"><div class="settings-tabs" role="tablist">${tabs}</div></div>
        </div>
      </div>`;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("platform-ios");
  });

  const style = (selector: string, property: string): Winner | null => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no ${selector}`);
    return phoneStyle(el, property);
  };

  it("makes the header Back's height, Back pressed on 44px", () => {
    expect(style(".settings-screen > .picker-head", "padding-block")).toMatchObject({
      value: "0",
    });
    expect(style(".picker-head > .btn-icon", "height")).toMatchObject({ value: "44px" });
    expect(style(".picker-head > .btn-icon", "width")).toMatchObject({ value: "44px" });
  });

  it("gives each of the nine tabs 44px square, in a tray that scrolls sideways", () => {
    expect(style(".settings-tab-dock", "padding")).toMatchObject({ value: "0 4px" });
    expect(style(".settings-tabs", "overflow-x")).toMatchObject({ value: "auto" });
    const tabs = [...document.querySelectorAll(".settings-tab")];
    expect(tabs).toHaveLength(9);
    for (const tab of tabs) {
      expect(phoneStyle(tab, "width")).toMatchObject({ value: "44px" });
      expect(phoneStyle(tab, "height")).toMatchObject({ value: "44px" });
      expect(phoneStyle(tab, "flex")).toMatchObject({ value: "0 0 44px" });
    }
  });

  it("starts a page's words 24px under the header, not 48 or 54", () => {
    expect(style(".settings-page", "padding-top")).toMatchObject({ value: "8px" });
    expect(style(".gn-page", "padding-top")).toMatchObject({ value: "0" });
    expect(style(".ov-page", "padding-top")).toMatchObject({ value: "16px" });
  });
});

describe("on the iPhone, a dialog", () => {
  beforeEach(() => document.documentElement.classList.add("platform-ios"));
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("platform-ios");
  });

  const style = (selector: string, property: string): Winner | null => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no ${selector}`);
    return phoneStyle(el, property);
  };
  const dialog = (className: string, body: string): void => {
    document.body.innerHTML = `
      <div class="modal-backdrop"><div class="modal ${className}" role="dialog">
        <div class="modal-head"><h2 class="modal-title">Title</h2>
          <button class="modal-close" aria-label="Close">×</button></div>
        ${body}
      </div></div>`;
  };

  it("heads a dialog with one 44px row, its × a 44px square, its buttons 12px under", () => {
    dialog(
      "",
      '<p>Start fresh?</p><div class="modal-actions"><button class="modal-btn">Cancel</button></div>',
    );
    expect(style(".modal", "padding-top")).toMatchObject({ value: "12px" });
    expect(style(".modal-head", "min-height")).toMatchObject({ value: "44px" });
    expect(style(".modal-head", "margin-bottom")).toMatchObject({ value: "0" });
    expect(style(".modal-close", "width")).toMatchObject({ value: "44px" });
    expect(style(".modal-close", "height")).toMatchObject({ value: "44px" });
    expect(style(".modal-actions", "margin-top")).toMatchObject({ value: "12px" });
    expect(style(".modal-actions", "display")?.value).not.toBe("none");
  });

  it("drops a footer whose one button is the ×, and keeps one with more", () => {
    dialog(
      "",
      '<div class="modal-actions"><button class="modal-btn modal-btn-close">Close</button></div>',
    );
    expect(style(".modal-actions", "display")).toMatchObject({ value: "none" });
    dialog(
      "",
      `<div class="modal-actions"><button class="modal-btn">Disconnect</button>
        <button class="modal-btn modal-btn-close">Close</button></div>`,
    );
    expect(style(".modal-actions", "display")?.value).not.toBe("none");
  });

  it("opens Notes as a sheet the screen's height, its page filling it", () => {
    dialog("notes-modal", '<textarea class="notes-input"></textarea>');
    expect(style(".modal", "height")?.value).toMatch(/^calc\(100dvh /);
    expect(style(".modal", "flex-direction")).toMatchObject({ value: "column" });
    expect(style(".notes-input", "flex")).toMatchObject({ value: "1 1 auto" });
    expect(style(".notes-input", "height")).toMatchObject({ value: "auto" });
  });

  it("makes plan review's title a 44px row, and the panels' extras go", () => {
    document.body.innerHTML = `
      <div class="app app-session">
        <div class="plan-review"><div class="plan-review-banner"><div class="plan-logo"></div></div></div>
        <section class="model-panel"><div class="model-summary"></div><div class="model-helper"></div></section>
        <section class="composer-panel more-panel"><header class="panel-header">
          <span class="panel-esc">esc</span><button class="panel-close"></button></header></section>
      </div>`;
    expect(style(".plan-review-banner", "padding")).toMatchObject({
      value: "var(--safe-top) 16px 0",
    });
    expect(style(".plan-logo", "padding")).toMatchObject({ value: "12px 0" });
    expect(style(".model-summary", "display")).toMatchObject({ value: "none" });
    expect(style(".model-helper", "min-height")).toMatchObject({ value: "44px" });
    expect(style(".panel-esc", "display")).toMatchObject({ value: "none" });
    expect(style(".panel-close", "margin-left")).toMatchObject({ value: "auto" });
  });
});

describe("on the iPhone, a list's heading", () => {
  beforeEach(() => document.documentElement.classList.add("platform-ios"));
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("platform-ios");
  });

  const browser = (body: string, back = true): void => {
    document.body.innerHTML = `
      <div class="picker chat-browser">
        <div class="picker-head">${back ? '<button class="btn btn-ghost btn-icon" aria-label="Back"></button>' : ""}</div>
        <div class="chat-browser-heading">
          <h1 class="chat-browser-title">Chats</h1>
          <div class="chat-browser-controls">
            <label class="chat-browser-search">Search chats<input type="search" /></label>
            <button class="chat-browser-new">+ New chat</button>
          </div>
        </div>
        <div class="picker-list">${body}</div>
      </div>`;
  };
  const style = (selector: string, property: string): Winner | null => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no ${selector}`);
    return phoneStyle(el, property);
  };

  it("puts Back on the title's line, and the title clear of it", () => {
    browser("<ul></ul>");
    expect(style(".picker-head", "position")).toMatchObject({ value: "absolute" });
    expect(style(".chat-browser-title", "padding-left")).toMatchObject({ value: "44px" });
    expect(style(".chat-browser-title", "min-height")).toMatchObject({ value: "44px" });
    browser("<ul></ul>", false);
    expect(style(".chat-browser-title", "padding-left")).toBeNull();
  });

  it("sets New beside the search, whose label is its unseen name", () => {
    browser("<ul></ul>");
    expect(style(".chat-browser-controls > .chat-browser-new", "flex")).toMatchObject({
      value: "none",
    });
    expect(style(".chat-browser-search", "flex")).toMatchObject({ value: "1 1 auto" });
    expect(style(".chat-browser-search", "font-size")).toMatchObject({ value: "0" });
    const input = document.querySelector("input");
    expect(input?.labels?.[0]?.textContent).toBe("Search chats");
    expect(phoneStyle(input!, "font-size")).toMatchObject({ value: "max(16px, 1em)" });
    expect(style(".chat-browser-controls", "display")?.value).not.toBe("none");
  });

  it("hides the heading's search and New while the list's own New is all there is", () => {
    browser(
      '<div class="picker-empty"><span>None yet.</span><button class="btn">New</button></div>',
    );
    expect(style(".chat-browser-controls", "display")).toMatchObject({ value: "none" });
    // An error has no New of its own: the heading's stays.
    browser('<div class="picker-empty">Could not load.</div>');
    expect(style(".chat-browser-controls", "display")?.value).not.toBe("none");
    browser('<div class="goal-browser-empty" role="alert"><button>Try again</button></div>');
    expect(style(".chat-browser-controls", "display")?.value).not.toBe("none");
    browser('<div class="goal-browser-empty"><button>+ New goal</button></div>');
    expect(style(".chat-browser-controls", "display")).toMatchObject({ value: "none" });
  });

  const projects = (body: string, search = true): void => {
    document.body.innerHTML = `
      <div class="picker project-picker">
        <div class="picker-head">
          <button class="btn btn-ghost btn-icon" aria-label="Back"></button>
          <span class="picker-title">Choose a project</span>
          <span class="badge">32</span>
          ${search ? '<input class="picker-search" aria-label="Search projects" />' : ""}
          <span class="picker-head-actions">
            <button class="btn btn-ghost btn-sm">Open existing</button>
            <button class="btn btn-primary btn-sm">+ New project</button>
          </span>
        </div>
        <div class="picker-list">${body}</div>
      </div>`;
  };

  it("sets + New project on Projects' title line, and Open existing beside the search", () => {
    projects("");
    const head = ".project-picker > .picker-head";
    expect(style(`${head} > .picker-head-actions`, "display")).toMatchObject({
      value: "contents",
    });
    expect(style(`${head} .btn-primary`, "order")).toMatchObject({ value: "1" });
    expect(style(`${head} > .picker-search`, "order")).toMatchObject({ value: "3" });
    expect(style(`${head} .btn-ghost:not(.btn-icon)`, "order")).toMatchObject({ value: "4" });
    expect(style(`${head} > .picker-title`, "text-overflow")).toMatchObject({ value: "ellipsis" });
    const end = RULES.find(
      (rule) =>
        rule.selector ===
        "html.platform-ios .project-picker > .picker-head:has(> .picker-search)::after",
    );
    expect(end?.declarations.get("flex-basis")?.value).toBe("100%");
    expect(end?.declarations.get("order")?.value).toBe("2");
  });

  it("hides Projects' heading buttons while the empty list holds its own, and keeps Back", () => {
    projects(
      '<div class="picker-empty"><button class="btn btn-ghost">Open existing</button></div>',
      false,
    );
    for (const button of document.querySelectorAll(".picker-head-actions > .btn"))
      expect(phoneStyle(button, "display"), button.textContent ?? "").toMatchObject({
        value: "none",
      });
    expect(style(".picker-head > .btn-icon", "display")?.value).not.toBe("none");
    projects('<div class="picker-empty">No projects yet.</div>', false);
    expect(style(".picker-head-actions > .btn-primary", "display")?.value).not.toBe("none");
  });
});

describe("on the iPhone, a description", () => {
  beforeEach(() => document.documentElement.classList.add("platform-ios"));
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("platform-ios");
  });
  const style = (selector: string, property: string): Winner | null => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no ${selector}`);
    return phoneStyle(el, property);
  };

  it("is two lines with an ellipsis until tapped, then whole, and wraps long words", () => {
    document.body.innerHTML = `
      <div class="kleio-chat-intro">
        <p class="kleio-chat-intro-job clamp-text" role="button" aria-expanded="false">
          <span class="clamp-body">Every weekday…</span></p></div>
      <div class="kleio-panel"><p class="kleio-job-text clamp-text" data-open="" role="button">
        <span class="clamp-body">Every weekday…</span></p></div>`;
    const shut = ".kleio-chat-intro-job > .clamp-body";
    expect(style(shut, "display")).toMatchObject({ value: "-webkit-box" });
    expect(style(shut, "-webkit-line-clamp")).toMatchObject({ value: "2" });
    expect(style(shut, "overflow")).toMatchObject({ value: "hidden" });
    expect(style(".kleio-job-text > .clamp-body", "display")).toMatchObject({ value: "block" });
    expect(style(".kleio-job-text > .clamp-body", "-webkit-line-clamp")).toBeNull();
    for (const selector of [".kleio-chat-intro", ".kleio-job-text", ".kleio-chat-intro-job"])
      expect(style(selector, "overflow-wrap"), selector).toMatchObject({ value: "anywhere" });
  });

  it("is pressed on 44px however few its lines, without growing", () => {
    document.body.innerHTML = `
      <p class="cast-p-job clamp-text" role="button"><span class="clamp-body">One line</span></p>`;
    expect(style(".clamp-text", "min-height")).toMatchObject({ value: "0" });
    expect(style(".clamp-text", "position")).toMatchObject({ value: "relative" });
    const reach = RULES.find(
      (rule) => rule.selector === 'html.platform-ios .clamp-text[role="button"]::before',
    );
    expect(reach?.declarations.get("inset")?.value).toBe("calc(min(0px, (100% - 44px) / 2)) 0");
  });
});

describe("on the iPhone, a session's foot", () => {
  beforeEach(() => document.documentElement.classList.add("platform-ios"));
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.classList.remove("platform-ios", "bottom-covered");
  });
  const style = (selector: string, property: string): Winner | null => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`no ${selector}`);
    return phoneStyle(el, property);
  };

  it("puts the status row above the activity line, so the composer sits on the home indicator", () => {
    document.body.innerHTML = `
      <div class="app app-session">
        <div class="transcript-frame"></div>
        <div class="liveregion"><div class="task-activity"></div></div>
        <div class="inputwrap"></div>
        <div class="footer"><div class="footer-right"></div></div>
        <div class="sr-only"></div>
      </div>`;
    expect(style(".transcript-frame", "order")).toBeNull();
    expect(style(".footer", "order")).toMatchObject({ value: "0" });
    for (const selector of [".liveregion", ".inputwrap", ".sr-only"])
      expect(style(selector, "order"), selector).toMatchObject({ value: "1" });
    // The page's own padding is the home indicator's gap, and nothing under it.
    expect(style(".app", "padding-bottom")).toMatchObject({ value: "var(--safe-bottom)" });
    expect(style(".inputwrap", "margin-bottom")).toBeNull();
    document.documentElement.classList.add("bottom-covered");
    expect(style(".app", "padding-bottom")).toMatchObject({ value: "6px" });
  });

  it("fades a new chat's rain into the session's colour, and sets the words on a halo", () => {
    document.body.innerHTML = `
      <div class="app app-session"><div class="wake-screen">
        <canvas class="wake-rain"></canvas>
        <div class="wake-text"><span class="wake-line">What’s on your mind?</span></div>
        <p class="wake-sub">A new conversation in this project.</p>
      </div></div>`;
    // The canvas reads its trail wash from <html>: the session's own rgb(22 18 19).
    expect(phoneStyle(document.documentElement, "--wake-fade")).toMatchObject({
      value: "rgb(22 18 19 / 0.18)",
      sheet: "./kleio-phone.css",
    });
    expect(style(".wake-rain", "opacity")).toMatchObject({ value: "0.6" });
    expect(style(".wake-text", "color")).toMatchObject({ value: "#fff" });
    expect(style(".wake-text", "text-shadow")?.value).toContain("rgb(0 0 0)");
    expect(style(".wake-sub", "color")).toMatchObject({ value: "var(--text)" });
  });
});
