// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getVersion } from "@tauri-apps/api/app";
import { AboutPage } from "./AboutPage";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.73.2") }));
vi.mock("./assets/kleio-mark.png", () => ({ default: "kleio-mark.png" }));
vi.mock("../agent", () => ({ openUrl: vi.fn(async () => undefined) }));

import { openUrl } from "../agent";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  document.documentElement.classList.remove("platform-ios");
});

// A macrotask runs only after the lookup (or its failure) has settled.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const TAGLINE = "Talk to your work: chat, code and specialists in one app.";
/** Every line of text on the phone's card, in order. */
const cardLines = (): string[] =>
  [...document.querySelectorAll(".about-card p")].map((p) => p.textContent ?? "");

describe("AboutPage on the phone", () => {
  beforeEach(() => {
    document.documentElement.classList.add("platform-ios");
  });

  it("shows the mark, the tagline and the version, and no credit line", async () => {
    render(<AboutPage />);
    expect(screen.getByRole("img", { name: "Kleio" })).toBeDefined();
    expect(await screen.findByText("Version 0.73.2")).toBeDefined();
    expect(cardLines()).toEqual([TAGLINE, "Version 0.73.2"]);
    expect(document.querySelector(".about-credit")).toBeNull();
    // Kleio's voice moved to the Setup page.
    expect(screen.queryByText("Talk to Kleio")).toBeNull();
  });

  it("keeps the tagline and drops the version when it can't be read", async () => {
    vi.mocked(getVersion).mockRejectedValueOnce(new Error("not in the desktop app"));
    render(<AboutPage />);
    await settle();
    expect(getVersion).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "Kleio" })).toBeDefined();
    expect(screen.queryByText(/^Version/)).toBeNull();
    expect(cardLines()).toEqual([TAGLINE]);
  });

  it("keeps its card, and none of the desktop's page", async () => {
    render(<AboutPage />);
    await settle();

    expect(document.querySelector(".settings-card.about-card")).not.toBeNull();
    expect(document.querySelector(".ab-page")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("William McKie")).toBeNull();
  });
});

const GITHUB = "https://github.com/fmckie";
const COPY = [
  "KLEIO",
  TAGLINE,
  "Designed and built by William McKie",
  "AI/ML engineer",
  "I built Kleio as my own AI harness: one place to talk, code and hand work to specialists. I hope it helps others too.",
  "GitHub (opens in your browser)",
  "Made with Tauri 2, React 19, TypeScript and Rust.",
  "The wordmark is set in Bungee, the statement in Mukta Malar, the rest in your system's typeface.",
  "This page moves with CSS and SVG alone, no animation libraries.",
];

/** Every line of text on the page, in order: a paragraph, or the wordmark. */
function copy(): string[] {
  const root = document.querySelector(".ab-page");
  if (!root) return [];
  const lines = new Map<Element, string>();
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const parent = node.parentElement;
    if (!parent) continue;
    const host = parent.closest("p, .ab-wordmark") ?? parent;
    lines.set(host, (lines.get(host) ?? "") + (node.textContent ?? ""));
  }
  return [...lines.values()].map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function motion(welcome: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: welcome && query === "(prefers-reduced-motion: no-preference)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const sign = (): SVGElement | null => document.querySelector("svg.ab-sign");
const signing = (): boolean => sign()?.classList.contains("is-signing") ?? false;
const masked = (): boolean => document.querySelector(".ab-ink")?.hasAttribute("mask") ?? false;
// jsdom has no AnimationEvent: the name is set on a plain event, and React,
// finding none, listens for the prefixed name, so both are sent.
function endAnimation(animationName: string): void {
  const svg = sign();
  if (!svg) throw new Error("no signature on the page");
  for (const type of ["animationend", "webkitAnimationEnd"]) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "animationName", { value: animationName });
    fireEvent(svg, event);
  }
}

describe("AboutPage on the desktop", () => {
  it("sets the copy, exactly and in order, ending on the version", async () => {
    render(<AboutPage />);
    await settle();

    expect(copy()).toEqual([...COPY, "Version 0.73.2"]);
    expect(screen.getByRole("region", { name: "About Kleio" })).toBeTruthy();
    expect(document.querySelector(".about-card")).toBeNull();
  });

  it("drops the version line, and leaves nothing empty, when it can't be read", async () => {
    vi.mocked(getVersion).mockRejectedValueOnce(new Error("not in the desktop app"));
    render(<AboutPage />);
    await settle();

    expect(getVersion).toHaveBeenCalledOnce();
    expect(copy()).toEqual(COPY);
    expect(document.querySelector(".ab-page")?.textContent).not.toMatch(/Version/);
    const empty = [...document.querySelectorAll(".ab-page *")].filter(
      (el) => !el.matches("hr, svg, svg *") && !el.textContent?.trim(),
    );
    expect(empty).toEqual([]);
  });

  it("carries no credit line, and claims nothing was built from scratch", async () => {
    render(<AboutPage />);
    await settle();

    const said = document.querySelector(".ab-page")?.textContent;
    expect(said).not.toMatch(/Built on/);
    expect(document.querySelectorAll(".ab-colophon-line")).toHaveLength(3);
    expect(said).not.toMatch(/from scratch/i);
    // Kleio's voice moved to the Setup page.
    expect(screen.queryByText("Talk to Kleio")).toBeNull();
  });

  it("holds one image, the mark named Kleio, and no button", async () => {
    render(<AboutPage />);
    await settle();

    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("aria-label")).toBe("Kleio");
    // The mark itself: the brand's PNG, drawn inside the signature.
    expect(images[0]?.querySelector("svg image")?.getAttribute("href")).toBe("kleio-mark.png");
    expect(document.querySelectorAll(".ab-page img")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector(".ab-page :is(input, select, textarea)")).toBeNull();
  });

  it("has one link, GitHub, which says it opens the browser and opens without navigating", async () => {
    render(<AboutPage />);
    await settle();

    expect(screen.getAllByRole("link")).toHaveLength(1);
    const link = screen.getByRole("link", { name: "GitHub (opens in your browser)" });
    expect(link.getAttribute("href")).toBe(GITHUB);

    // Not cancelled, the click would leave the app for the address.
    expect(fireEvent.click(link)).toBe(false);
    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(GITHUB);
  });
});

// The signature remembers its first open in the module as well as in storage,
// so each of these starts from a fresh copy of the page.
async function freshPage(): Promise<typeof AboutPage> {
  vi.resetModules();
  return (await import("./AboutPage")).AboutPage;
}

describe("AboutPage's signature", () => {
  it("signs on the first open, with the pen masking the mark until it has finished", async () => {
    motion(true);
    const Page = await freshPage();
    render(<Page />);
    await settle();

    expect(signing()).toBe(true);
    expect(masked()).toBe(true);
    expect(document.querySelector(".ab-ink")?.getAttribute("mask")).toBe("url(#kleio-ab-ink)");
    expect(document.querySelector("mask#kleio-ab-ink path.ab-pen")).not.toBeNull();
    expect(localStorage.getItem("kleio.about.signed")).toBe("1");

    endAnimation("kleio-ab-sign");

    // It rests on the plain mark.
    expect(signing()).toBe(false);
    expect(masked()).toBe(false);
  });

  it("is drawn with one stroke", async () => {
    render(<AboutPage />);
    await settle();

    const d = document.querySelector("path.ab-pen")?.getAttribute("d") ?? "";
    expect(d.match(/[Mm]/g)).toHaveLength(1);
  });

  it("doesn't sign on the second open", async () => {
    motion(true);
    const Page = await freshPage();
    const first = render(<Page />);
    await settle();
    expect(signing()).toBe(true);
    first.unmount();

    render(<Page />);
    await settle();

    expect(signing()).toBe(false);
    expect(masked()).toBe(false);
  });

  it("doesn't sign for someone who has opened About before", async () => {
    motion(true);
    localStorage.setItem("kleio.about.signed", "1");
    const Page = await freshPage();
    render(<Page />);
    await settle();

    expect(signing()).toBe(false);
    expect(masked()).toBe(false);
  });

  it("never signs with reduced motion, and that still counts as the first open", async () => {
    motion(false);
    const Page = await freshPage();
    const first = render(<Page />);
    await settle();
    expect(signing()).toBe(false);
    expect(masked()).toBe(false);
    expect(localStorage.getItem("kleio.about.signed")).toBe("1");
    first.unmount();

    motion(true);
    render(<Page />);
    await settle();
    expect(signing()).toBe(false);
  });

  it("signs once a visit, and no more, where nothing can be stored", async () => {
    motion(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    const Page = await freshPage();
    const first = render(<Page />);
    await settle();
    expect(signing()).toBe(true);
    first.unmount();

    render(<Page />);
    await settle();

    expect(signing()).toBe(false);
    expect(masked()).toBe(false);
  });

  it("unmasks the mark by itself if the signature's end is never reported", async () => {
    motion(true);
    const Page = await freshPage();
    vi.useFakeTimers();
    render(<Page />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(signing()).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(signing()).toBe(false);
    expect(masked()).toBe(false);
  });

  it("ignores the end of any other animation", async () => {
    motion(true);
    const Page = await freshPage();
    render(<Page />);
    await settle();

    endAnimation("something-else");

    expect(signing()).toBe(true);
  });
});
