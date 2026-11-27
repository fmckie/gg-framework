// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheExpiryStatus } from "../agent";
import { CacheExpiryNotice, resetCacheExpiryNoticeDismissals } from "./CacheExpiryNotice";
import themeCss from "../kleio/kleio-theme.css?raw";

function status(extra: Partial<CacheExpiryStatus> = {}): CacheExpiryStatus {
  return {
    sessionId: "s1",
    provider: "anthropic",
    ttlMs: 300_000,
    confidence: "expired",
    ttlSource: "test",
    lastRequestAt: 1_000,
    expiresAt: 301_000,
    expired: true,
    reason: "idle",
    prefixTokens: 120_000,
    minTokens: 40_000,
    notable: true,
    estimatedExtraCostUsd: null,
    ...extra,
  };
}

const TEXT = /re-reads ~120k tokens at full price/;

beforeEach(() => resetCacheExpiryNoticeDismissals());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.classList.remove("platform-ios");
});

describe("CacheExpiryNotice", () => {
  it("shows the cost when the cache is expired and the context is large", () => {
    render(<CacheExpiryNotice expiry={status()} running={false} onCompact={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Prompt cache expired" })).toBeTruthy();
    expect(screen.getByText(TEXT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compact first" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send anyway" })).toBeTruthy();
  });

  it("stays hidden while running, when warm, below threshold, or without status", () => {
    const onCompact = vi.fn();
    const { rerender } = render(
      <CacheExpiryNotice expiry={status()} running onCompact={onCompact} />,
    );
    expect(screen.queryByText(TEXT)).toBeNull();
    rerender(
      <CacheExpiryNotice
        expiry={status({
          expired: false,
          notable: false,
          reason: null,
          expiresAt: Date.now() + 60_000,
        })}
        running={false}
        onCompact={onCompact}
      />,
    );
    expect(screen.queryByText(TEXT)).toBeNull();
    rerender(
      <CacheExpiryNotice
        expiry={status({ prefixTokens: 39_999, notable: false })}
        running={false}
        onCompact={onCompact}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<CacheExpiryNotice expiry={null} running={false} onCompact={onCompact} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("flips to expired on its own once the TTL passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    render(
      <CacheExpiryNotice
        expiry={status({ expired: false, notable: false, reason: null, expiresAt: 5_000 })}
        running={false}
        onCompact={vi.fn()}
      />,
    );
    expect(screen.queryByText(TEXT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText(TEXT)).toBeTruthy();
  });

  it("'Send anyway' dismisses once per expiry per chat", () => {
    const { rerender, unmount } = render(
      <CacheExpiryNotice expiry={status()} running={false} onCompact={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    expect(screen.queryByText(TEXT)).toBeNull();
    // Same expiry: a new /state snapshot or a remount keeps it dismissed.
    rerender(<CacheExpiryNotice expiry={status()} running={false} onCompact={vi.fn()} />);
    expect(screen.queryByText(TEXT)).toBeNull();
    unmount();
    render(<CacheExpiryNotice expiry={status()} running={false} onCompact={vi.fn()} />);
    expect(screen.queryByText(TEXT)).toBeNull();
    cleanup();
    // A later lapse (new last request) or another chat shows it again.
    render(
      <CacheExpiryNotice
        expiry={status({ lastRequestAt: 900_000 })}
        running={false}
        onCompact={vi.fn()}
      />,
    );
    expect(screen.getByText(TEXT)).toBeTruthy();
    cleanup();
    render(
      <CacheExpiryNotice
        expiry={status({ sessionId: "s2" })}
        running={false}
        onCompact={vi.fn()}
      />,
    );
    expect(screen.getByText(TEXT)).toBeTruthy();
  });

  it("'Compact first' calls onCompact once and hides the notice", () => {
    const onCompact = vi.fn();
    render(<CacheExpiryNotice expiry={status()} running={false} onCompact={onCompact} />);
    fireEvent.click(screen.getByRole("button", { name: "Compact first" }));
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXT)).toBeNull();
  });

  it("hedges the copy when the TTL is only a guaranteed minimum", () => {
    render(
      <CacheExpiryNotice
        expiry={status({ confidence: "may_be_cold" })}
        running={false}
        onCompact={vi.fn()}
      />,
    );
    expect(screen.getByText(/cache may have expired/)).toBeTruthy();
  });

  it("keeps its two choices together beside the words in a desktop session, never one alone on a line", () => {
    const notice = "html:not(.platform-ios) .app.app-session > .inputwrap > .placeholder-cache";
    const draw = (): void => {
      render(
        <div className="app app-session">
          <div className="inputwrap">
            <CacheExpiryNotice expiry={status()} running={false} onCompact={vi.fn()} />
          </div>
        </div>,
      );
    };
    draw();
    const box = screen.getByRole("status", { name: "Prompt cache expired" });
    expect(box.matches(notice)).toBe(true);
    expect(screen.getByText(TEXT).matches(`${notice} > .placeholder-cache-text`)).toBe(true);
    const pair = screen.getByRole("button", { name: "Compact first" }).parentElement;
    expect(pair?.matches(`${notice} > .placeholder-cache-actions`)).toBe(true);
    expect(screen.getByRole("button", { name: "Send anyway" }).parentElement).toBe(pair);

    // The row wraps; the pair is one item that doesn't, and neither label breaks.
    expect(themeCss).toContain(
      `${notice} {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;`,
    );
    expect(themeCss).toContain(
      "  > .placeholder-cache\n  > .placeholder-cache-actions {\n  display: flex;\n  flex: none;\n  gap: 6px;\n}",
    );
    expect(themeCss).toContain(
      `${notice} button {\n  height: 26px;\n  padding: 0 10px;\n  border: 1px solid var(--kleio-edge);\n  border-radius: 3px;\n  background: transparent;\n  font: 500 12.5px/1 var(--sans);\n  color: var(--kleio-text);\n  white-space: nowrap;`,
    );

    // The iPhone keeps the plain line.
    cleanup();
    document.documentElement.classList.add("platform-ios");
    draw();
    expect(screen.getByRole("status", { name: "Prompt cache expired" }).matches(notice)).toBe(
      false,
    );
  });
});
