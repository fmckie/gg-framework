import { describe, expect, it } from "vitest";
import { windowShortcut, type ShortcutKeys } from "./window-shortcuts";

/** A key press as the browser reports it: Shift upper-cases a letter. */
function press(key: string, mods: Partial<ShortcutKeys> = {}): ShortcutKeys {
  const shiftKey = mods.shiftKey ?? false;
  return {
    key: shiftKey && key.length === 1 ? key.toUpperCase() : key,
    code: key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey,
    ...mods,
  };
}
const cmd = { metaKey: true };
const cmdShift = { metaKey: true, shiftKey: true };
const local = { kleioActive: false };
const remote = { kleioActive: true };

describe("windowShortcut", () => {
  it("talks to Kleio with Cmd+Shift+B, in remote mode or not, like the Home button", () => {
    expect(windowShortcut(press("b", cmdShift), local)).toEqual({ kind: "talk" });
    expect(windowShortcut(press("b", cmdShift), remote)).toEqual({ kind: "talk" });
  });

  it("opens specialists with Cmd+Shift+L only where its button shows (remote mode)", () => {
    expect(windowShortcut(press("l", cmdShift), remote)).toEqual({ kind: "specialists" });
    expect(windowShortcut(press("l", cmdShift), local)).toBeNull();
  });

  it("opens the remote host pane and arranges windows with Shift held", () => {
    expect(windowShortcut(press("k", cmdShift), local)).toEqual({ kind: "remote-host" });
    expect(windowShortcut(press("a", cmdShift), local)).toEqual({ kind: "arrange-windows" });
  });

  it("matches a letter whichever case it arrives in (Caps Lock, Shift)", () => {
    expect(windowShortcut({ ...press("b", cmdShift), key: "b" }, local)).toEqual({ kind: "talk" });
    expect(windowShortcut({ ...press("n", cmd), key: "N" }, local)).toEqual({
      kind: "new-window",
    });
  });

  it("cycles windows by the physical ` key, backwards with Shift (where it reads ~)", () => {
    const backquote = { key: "`", code: "Backquote" };
    expect(windowShortcut({ ...press("x", cmd), ...backquote }, local)).toEqual({
      kind: "cycle-windows",
      offset: 1,
    });
    expect(windowShortcut({ ...press("x", cmdShift), key: "~", code: "Backquote" }, local)).toEqual(
      { kind: "cycle-windows", offset: -1 },
    );
  });

  it("opens a new window with Cmd+N, but not with Shift", () => {
    expect(windowShortcut(press("n", cmd), local)).toEqual({ kind: "new-window" });
    expect(windowShortcut(press("n", cmdShift), local)).toBeNull();
  });

  it("works with Ctrl on Windows and Linux", () => {
    expect(windowShortcut(press("b", { ctrlKey: true, shiftKey: true }), local)).toEqual({
      kind: "talk",
    });
  });

  it("ignores keys without Cmd/Ctrl, with Option/Alt, and letters that aren't shortcuts", () => {
    expect(windowShortcut(press("b", { shiftKey: true }), local)).toBeNull();
    expect(windowShortcut(press("b", { ...cmdShift, altKey: true }), local)).toBeNull();
    expect(windowShortcut(press("b", cmd), local)).toBeNull();
    expect(windowShortcut(press("z", cmdShift), local)).toBeNull();
  });
});
