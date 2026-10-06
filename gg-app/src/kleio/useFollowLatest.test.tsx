// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type React from "react";
import { isPhone } from "../platform";
import { TOUCH_SETTLE_MS } from "../transcript-pin";
import { useFollowLatest } from "./useFollowLatest";

vi.mock("../platform", () => ({ isPhone: vi.fn(() => false) }));

/**
 * A message list without layout (jsdom has none): the offset clamps to
 * `scrollHeight - clientHeight`, as a browser's does.
 */
function messageList(content = 2000, viewport = 400): HTMLDivElement & { writes: number } {
  const el = Object.assign(document.createElement("div"), { writes: 0 });
  let top = 0;
  let height = content;
  const max = (): number => Math.max(0, height - viewport);
  Object.defineProperties(el, {
    clientHeight: { get: () => viewport },
    scrollHeight: { get: () => height, set: (h: number) => (height = h) },
    scrollTop: {
      get: () => top,
      set: (t: number) => {
        el.writes += 1;
        top = Math.min(Math.max(t, 0), max());
      },
    },
  });
  return el;
}

function setup(content?: number): {
  el: HTMLDivElement & { writes: number };
  hook: { current: ReturnType<typeof useFollowLatest> };
  /** The reader drags the list to `top`. */
  scrollTo: (top: number) => void;
  /** More content arrives (a poll's new reply). */
  grow: (by: number) => void;
} {
  const el = messageList(content);
  const ref = { current: el } as React.RefObject<HTMLElement | null>;
  const { result } = renderHook(() => useFollowLatest(ref));
  return {
    el,
    hook: result,
    scrollTo: (top) => {
      el.scrollTop = top;
      act(() => result.current.handlers.onScroll());
    },
    grow: (by) => {
      (el as unknown as { scrollHeight: number }).scrollHeight = el.scrollHeight + by;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(isPhone).mockReturnValue(false);
});

describe("useFollowLatest", () => {
  it("catches up to the newest message while following", () => {
    const { el, hook, grow } = setup();
    act(() => hook.current.catchUp());
    expect(el.scrollTop).toBe(1600);

    grow(300);
    act(() => hook.current.catchUp());
    expect(el.scrollTop).toBe(1900);
  });

  it("leaves a reader who scrolled up where they are when new messages land", () => {
    const { el, hook, scrollTo, grow } = setup();
    act(() => hook.current.catchUp());
    scrollTo(900);

    grow(300);
    act(() => hook.current.catchUp());

    expect(el.scrollTop).toBe(900);
    expect(hook.current.following()).toBe(false);
  });

  it("follows again once the reader scrolls back to the bottom", () => {
    const { el, hook, scrollTo, grow } = setup();
    act(() => hook.current.catchUp());
    scrollTo(900);
    scrollTo(1600);

    grow(300);
    act(() => hook.current.catchUp());

    expect(el.scrollTop).toBe(1900);
  });

  it("leaves the list alone when it's already at the newest message", () => {
    const { el, hook } = setup();
    act(() => hook.current.catchUp());
    // A Mac trackpad scroll has begun but not yet reported itself: a write of
    // the same offset would land on top of it and snap the reader back.
    el.writes = 0;

    act(() => hook.current.catchUp());
    act(() => hook.current.catchUp());

    expect(el.writes).toBe(0);
    expect(el.scrollTop).toBe(1600);
  });

  it("follows again after sending, wherever the reader had scrolled", () => {
    const { el, hook, scrollTo } = setup();
    act(() => hook.current.catchUp());
    scrollTo(300);

    act(() => hook.current.follow());

    expect(el.scrollTop).toBe(1600);
    expect(hook.current.following()).toBe(true);
  });

  it("iPhone: holds the list under a finger, then catches up once the fling settles", () => {
    vi.useFakeTimers();
    vi.mocked(isPhone).mockReturnValue(true);
    const { el, hook, grow } = setup();
    act(() => hook.current.catchUp());

    act(() => hook.current.handlers.onTouchStart());
    grow(300);
    act(() => hook.current.catchUp());
    expect(el.scrollTop).toBe(1600);

    act(() => hook.current.handlers.onTouchEnd());
    act(() => {
      vi.advanceTimersByTime(TOUCH_SETTLE_MS);
    });
    expect(el.scrollTop).toBe(1900);
  });
});
