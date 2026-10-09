// @vitest-environment jsdom
// The iPhone layout (kleio-phone.css) makes the page unselectable, since UI
// chrome is not text, then lists what stays selectable. A message view left off
// that list can't be pressed and held to copy: the specialist and group chats
// and the voice captions were (Oct 2026). These render the real views and work
// out each element's user-select from that stylesheet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GroupsPage } from "./GroupsPage";
import type * as KleioApi from "./kleioApi";
import {
  listBlobs,
  listGroupMessages,
  listGroups,
  threadHistory,
  threadState,
  type Blob,
  type Group,
} from "./kleioApi";
import phoneCss from "./kleio-phone.css?raw";
import { ThreadChat } from "./ThreadChat";
import { VoiceMode } from "./VoiceMode";

vi.mock("./kleioApi", async (importOriginal) => ({
  ...(await importOriginal<typeof KleioApi>()),
  threadState: vi.fn(),
  threadHistory: vi.fn(),
  listBlobs: vi.fn(),
  listGroups: vi.fn(),
  listGroupMessages: vi.fn(),
  getVoiceStatus: vi.fn(async () => ({ ready: true })),
}));
vi.mock("./voiceCall", () => ({
  useCall: () => ({ phase: "speaking", lines: [], muted: false, error: null }),
  callLevels: () => ({ out: null, in: null }),
  partialLines: () => [{ who: "kleio", text: "Chef finished the dinner plan." }],
  endCall: vi.fn(),
  resetCall: vi.fn(),
  setMuted: vi.fn(),
  startCall: vi.fn(),
}));
// The orb and the waves are WebGL: not something jsdom can draw.
vi.mock("./VoiceOrb", () => ({ VoiceOrb: () => null }));
vi.mock("../HomeDither", () => ({ HomeDither: () => null }));
vi.mock("./BriefPanel", () => ({ briefMe: vi.fn() }));
vi.mock("./liveActivity", () => ({ startLiveActivity: vi.fn(async () => {}) }));
vi.mock("../agent", () => ({ openProjectPath: vi.fn(), sendPrompt: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../useDictation", () => ({
  useDictation: () => ({ state: "idle", start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("../RadioButton", () => ({ RadioButton: () => null }));
vi.mock("../WindowLayoutButton", () => ({ WindowLayoutButton: () => null }));

type Select = "text" | "none";

/** The selectors of the stylesheet's rules that set user-select, by value. */
function userSelectRules(css: string): Record<Select, string[]> {
  const rules: Record<Select, string[]> = { text: [], none: [] };
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Innermost blocks: one rule's selectors and its declarations.
  for (const [, selectors = "", body = ""] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const value = /(?:^|[\s;])user-select:\s*(text|none)\b/.exec(body)?.[1];
    if (value === "text" || value === "none")
      rules[value].push(...selectors.split(",").map((s) => s.trim()));
  }
  return rules;
}

const RULES = userSelectRules(phoneCss);

/**
 * An element's user-select on the iPhone. WebKit carries it down to children,
 * so it's the value set on the element or its nearest ancestor with one.
 */
function phoneUserSelect(el: Element): Select | "unset" {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const at = node;
    const text = RULES.text.some((s) => at.matches(s));
    const none = RULES.none.some((s) => at.matches(s));
    if (text && none) throw new Error(`both text and none set on .${at.className}`);
    if (text || none) return text ? "text" : "none";
  }
  return "unset";
}

/** Each selector's first element and its user-select: text to copy, chrome not. */
function expectSelects(text: readonly string[], chrome: readonly string[]): void {
  const got = (selectors: readonly string[]): Record<string, string> =>
    Object.fromEntries(
      selectors.map((s) => {
        const el = document.querySelector(s);
        return [s, el ? phoneUserSelect(el) : "missing"];
      }),
    );
  expect({ text: got(text), chrome: got(chrome) }).toEqual({
    text: Object.fromEntries(text.map((s) => [s, "text"])),
    chrome: Object.fromEntries(chrome.map((s) => [s, "none"])),
  });
}

const AT = "2026-10-08T09:00:00Z";
const REPLY = "Here's the plan: three courses.\n\n```sh\ncat plan.md\n```";
const CHEF: Blob = {
  id: "b1",
  name: "Chef",
  emoji: "🫧",
  color: "sky",
  job: "Plans the week's meals",
  model: null,
  createdAt: AT,
  updatedAt: AT,
  schedules: [],
  running: false,
};
const DESK: Group = {
  id: "g1",
  name: "Morning Desk",
  emoji: "☕️",
  color: "lemon",
  members: ["b1"],
  createdAt: AT,
  updatedAt: AT,
  typing: [],
};

beforeEach(() => {
  document.documentElement.classList.add("platform-ios");
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("platform-ios");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("on the iPhone, message text is selectable and chrome is not", () => {
  it("reads the phone stylesheet's rules", () => {
    expect(RULES.text.length).toBeGreaterThan(0);
    expect(RULES.none).toContain("html.platform-ios body");
  });

  it("in a specialist's chat", async () => {
    vi.mocked(threadState).mockResolvedValue({ running: false });
    vi.mocked(threadHistory).mockResolvedValue([
      { role: "user", text: '\u23F0 Scheduled task "Menu": What should we cook?' },
      { role: "user", text: "Plan Saturday's dinner" },
      { role: "assistant", text: REPLY },
    ]);
    render(
      <ThreadChat
        label="Chef"
        resolve={async () => ({ sessionId: "s1", sessionPath: null, created: false })}
      />,
    );
    await screen.findByText(/three courses/);
    expectSelects(
      [".user-msg:not(.kleio-scheduled)", ".kleio-scheduled", ".markdown p", ".markdown pre code"],
      [".kleio-scheduled-tag", ".assistant-dot", ".code-copy", ".kleio-composer button"],
    );
  });

  it("in a group chat", async () => {
    vi.mocked(listBlobs).mockResolvedValue([CHEF]);
    vi.mocked(listGroups).mockResolvedValue([DESK]);
    vi.mocked(listGroupMessages).mockResolvedValue({
      messages: [
        { seq: 1, id: "m1", author: "you", authorName: "You", emoji: "", text: "Dinner?", at: AT },
        { seq: 2, id: "m2", author: "b1", authorName: "Chef", emoji: "🫧", text: REPLY, at: AT },
      ],
      typing: [],
      lastSeq: 2,
    });
    render(<GroupsPage onClose={() => undefined} openId="g1" />);
    await screen.findByText(/three courses/);
    expectSelects(
      [".kleio-transcript .user-msg", ".kleio-gmsg .markdown p", ".kleio-gmsg .markdown pre code"],
      [
        ".kleio-gmsg .blob-av",
        ".kleio-gmsg-name",
        ".kleio-gmsg .code-copy",
        ".kleio-head-titles",
        ".kleio-composer button",
      ],
    );
  });

  it("in the voice captions", async () => {
    render(<VoiceMode />);
    await screen.findByText("Chef finished the dinner plan.");
    expectSelects([".voice-line"], [".voice-status", ".voice-button", ".voice-close"]);
  });
});
