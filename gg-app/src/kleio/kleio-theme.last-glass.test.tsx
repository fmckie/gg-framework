// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AttachmentBar } from "../AttachmentBar";
import { MotionStarters } from "../MotionStarters";
import { ReferencedFiles } from "../ReferencedFiles";
import { SlashMenu } from "../SlashMenu";
import { TranscriptJump } from "../placeholder/TranscriptJump";
import themeCss from "./kleio-theme.css?raw";

const SESSION = "html:not(.platform-ios) .app.app-session";
const none = (): void => undefined;

/** The stylesheet's section for a session's last glass, up to the next one. */
function lastGlassCss(): string {
  const from = themeCss.indexOf("/* ── A session's last glass ──");
  return themeCss.slice(from, themeCss.indexOf("/* ── The Checklist ──", from));
}

// jsdom has no layout, so no scrollIntoView: the slash menu calls it.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("platform-ios");
});

/** The parts as App.tsx and Composer.tsx nest them under the session's root. */
function mountSession(): void {
  render(
    <div className="app app-session">
      <div className="transcript-frame">
        <div className="transcript" />
        <TranscriptJump
          away
          hasNew
          askAt="below"
          onScrollToBottom={none}
          onJumpToNew={none}
          onJumpToAsk={none}
        />
      </div>
      <div className="liveregion">
        <MotionStarters onPick={none} />
      </div>
      <div className="inputwrap">
        <SlashMenu
          commands={[{ name: "commit", aliases: [], description: "Commit staged work" }]}
          activeIndex={0}
          onSelect={none}
          onHover={none}
        />
        <AttachmentBar
          attachments={
            [{ id: 1, name: "notes.pdf", kind: "file", mimeType: "application/pdf" }] as never
          }
          onRemove={none}
          onOpenImage={none}
        />
        <ReferencedFiles paths={["src/App.tsx"]} onRemove={none} />
      </div>
    </div>,
  );
}

describe("a session's last glass", () => {
  it("is drawn in the session's palette, with no glass", () => {
    const css = lastGlassCss();
    const used = new Set(css.match(/--kleio-[a-z0-9-]+/g));
    expect(used.size).toBeGreaterThan(3);
    for (const name of used) expect(themeCss, name).toContain(`  ${name}: `);
    expect(css).not.toMatch(/liquid-rim|blur\(|var\(--glass/);
  });

  it("draws Motion's starting points and the jump buttons as bounded flat buttons", () => {
    mountSession();
    const starter = screen.getAllByRole("button", { name: /^Make / })[0];
    expect(starter?.matches(`${SESSION} > .liveregion .motion-starter`)).toBe(true);
    const jump = document.querySelector(".placeholder-jump > .btn");
    expect(jump?.matches(`${SESSION} > .transcript-frame > .placeholder-jump > .btn`)).toBe(true);
    expect(lastGlassCss()).toContain(
      `${SESSION} > .liveregion .motion-starter,\n${SESSION} > .transcript-frame > .placeholder-jump > .btn {\n  --glass-hover-scale: 1;\n  --glass-press-scale: 1;\n  min-height: 28px;\n  padding: 0 12px;\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;`,
    );
  });

  it("draws the slash menu as a flat panel and the file chips as flat wells", () => {
    mountSession();
    const menu = document.querySelector(".slash-menu");
    expect(menu?.matches(`${SESSION} > .inputwrap .slash-menu`)).toBe(true);
    // The menu sets its fill inline, and glass.css sets it with !important.
    expect(menu?.getAttribute("style")).toContain("background");
    expect(lastGlassCss()).toContain(
      `${SESSION} > .inputwrap .slash-menu {\n  --primary: var(--kleio-lapis);\n  border-color: var(--kleio-edge) !important;\n  border-radius: 6px;\n  background: var(--kleio-surface) !important;`,
    );
    const chips = `${SESSION} > .inputwrap :is(.attach-chip, .mention-chip)`;
    expect(document.querySelector(".attach-chip")?.matches(chips)).toBe(true);
    expect(document.querySelector(".mention-chip")?.matches(chips)).toBe(true);
    expect(lastGlassCss()).toContain(
      `${chips},\n${SESSION} > .transcript-frame > .transcript .user-file-chip {`,
    );
  });

  it("leaves the iPhone's session alone", () => {
    document.documentElement.classList.add("platform-ios");
    mountSession();
    expect(
      document
        .querySelector(".motion-starter")
        ?.matches(`${SESSION} > .liveregion .motion-starter`),
    ).toBe(false);
  });
});
