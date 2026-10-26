// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  HistoryImage,
  HistoryImageLoader,
  HistoryImagesProvider,
  shownSize,
} from "./historyImages";

const historyImagesMock = vi.hoisted(() => vi.fn());
vi.mock("./agent", () => ({ historyImages: historyImagesMock }));

/** An image ref: 64 characters from a short name, padded with "f" so that
 *  names of digits stay distinct ("c1" and "c10"). */
function ref(name: string): string {
  return name.padEnd(64, "f");
}

/** A preview's data URL, for a ref. */
function preview(r: string): string {
  return `data:image/webp;base64,${r.slice(0, 8)}`;
}

/** Answers each ref asked for with its preview. */
function answerAll(refs: readonly string[]): Promise<Record<string, string>> {
  return Promise.resolve(Object.fromEntries(refs.map((r) => [r, preview(r)])));
}

/** Lets the loader's gathering go out, and its answer come back. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  historyImagesMock.mockReset();
  historyImagesMock.mockImplementation(answerAll);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HistoryImageLoader", () => {
  it("asks for the refs wanted together in one request, at most 8 at a time", async () => {
    const fetch = vi.fn(answerAll);
    const loader = new HistoryImageLoader(fetch);
    const refs = Array.from({ length: 10 }, (_, i) => ref(`a${i}`));
    const loaded = Promise.all(refs.map((r) => loader.load(r)));
    await vi.advanceTimersByTimeAsync(20);
    expect(await loaded).toEqual(refs.map(preview));
    expect(fetch.mock.calls).toEqual([[refs.slice(0, 8)], [refs.slice(8)]]);
  });

  it("asks once for a ref wanted twice, and keeps it for next time", async () => {
    const fetch = vi.fn(answerAll);
    const loader = new HistoryImageLoader(fetch);
    const twice = Promise.all([loader.load(ref("b")), loader.load(ref("b"))]);
    await vi.advanceTimersByTimeAsync(20);
    expect(await twice).toEqual([preview(ref("b")), preview(ref("b"))]);
    expect(await loader.load(ref("b"))).toBe(preview(ref("b")));
    expect(fetch.mock.calls).toEqual([[[ref("b")]]]);
  });

  it("keeps the last 96 previews, the oldest going first", async () => {
    const fetch = vi.fn(answerAll);
    const loader = new HistoryImageLoader(fetch);
    const refs = Array.from({ length: 97 }, (_, i) => ref(`c${i}`));
    const loaded = Promise.all(refs.map((r) => loader.load(r)));
    await vi.advanceTimersByTimeAsync(20);
    await loaded;
    fetch.mockClear();
    const again = Promise.all([loader.load(refs[96] ?? ""), loader.load(refs[0] ?? "")]);
    await vi.advanceTimersByTimeAsync(20);
    await again;
    expect(fetch.mock.calls).toEqual([[[refs[0]]]]);
  });

  it("fails a ref the chat no longer has, and every ref of a failed request", async () => {
    const loader = new HistoryImageLoader(async (refs) =>
      refs[0] === ref("gone") ? {} : Promise.reject(new Error("offline")),
    );
    const gone = expect(loader.load(ref("gone"))).rejects.toThrow("no longer in this chat");
    await vi.advanceTimersByTimeAsync(20);
    await gone;
    const both = [loader.load(ref("d1")), loader.load(ref("d2"))].map((p) =>
      expect(p).rejects.toThrow("offline"),
    );
    await vi.advanceTimersByTimeAsync(20);
    await Promise.all(both);
  });

  it("fails what's waiting when it's closed, and sends nothing", async () => {
    const fetch = vi.fn(answerAll);
    const loader = new HistoryImageLoader(fetch);
    const waiting = expect(loader.load(ref("e"))).rejects.toThrow("closed");
    loader.dispose();
    await waiting;
    await vi.advanceTimersByTimeAsync(20);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("HistoryImage", () => {
  /** IntersectionObserver as the page has it: each observer's callback and target. */
  function watchNearness(): { near: (i: number) => void; watched: Element[] } {
    const callbacks: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
    const watched: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          callbacks.push(cb);
        }
        observe(el: Element): void {
          watched.push(el);
        }
        disconnect(): void {}
      },
    );
    return {
      near: (i) => act(() => callbacks[i]?.([{ isIntersecting: true }])),
      watched,
    };
  }

  it("shows an image it has the preview of, asking for nothing", () => {
    render(<HistoryImage image={{ src: "data:image/webp;base64,AA" }} alt="/a.png" />);
    expect(screen.getByRole("img", { name: "/a.png" }).getAttribute("src")).toBe(
      "data:image/webp;base64,AA",
    );
    expect(historyImagesMock).not.toHaveBeenCalled();
  });

  it("holds an image's place until it's near, then loads only it", async () => {
    const { near, watched } = watchNearness();
    const onLoad = vi.fn();
    render(
      <HistoryImagesProvider>
        <HistoryImage image={{ ref: ref("f1"), width: 480, height: 309 }} alt="/f1.png" />
        <HistoryImage
          image={{ ref: ref("f2"), width: 480, height: 736 }}
          alt="/f2.png"
          onLoad={onLoad}
        />
      </HistoryImagesProvider>,
    );
    const [first, second] = screen.getAllByRole("img");
    expect(first?.getAttribute("aria-busy")).toBe("true");
    // Its box is the size it will show at, within the card's 320 × 280.
    expect([first?.style.width, first?.style.aspectRatio]).toEqual(["320px", "320 / 206"]);
    expect([second?.style.width, second?.style.aspectRatio]).toEqual(["183px", "183 / 280"]);
    expect(watched).toHaveLength(2);
    await settle();
    expect(historyImagesMock).not.toHaveBeenCalled();

    near(1);
    await settle();
    expect(historyImagesMock.mock.calls).toEqual([[[ref("f2")]]]);
    const shown = screen.getByRole("img", { name: "/f2.png" });
    expect(shown.tagName).toBe("IMG");
    expect(shown.getAttribute("src")).toBe(preview(ref("f2")));
    shown.dispatchEvent(new Event("load"));
    expect(onLoad).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "/f1.png" }).getAttribute("aria-busy")).toBe("true");
  });

  it("says when a preview didn't load", async () => {
    historyImagesMock.mockRejectedValue(new Error("offline"));
    const { near } = watchNearness();
    render(
      <HistoryImagesProvider>
        <HistoryImage image={{ ref: ref("g"), width: 100, height: 100 }} alt="/g.png" />
      </HistoryImagesProvider>,
    );
    near(0);
    await settle();
    const failed = screen.getByRole("img", { name: "/g.png" });
    expect(failed.textContent).toBe("Preview didn't load");
    expect(failed.getAttribute("aria-busy")).toBeNull();
  });
});

describe("shownSize", () => {
  it("fits an image within 320 × 280, never enlarging it", () => {
    expect(shownSize(480, 309)).toEqual({ width: 320, height: 206 });
    expect(shownSize(480, 736)).toEqual({ width: 183, height: 280 });
    expect(shownSize(200, 100)).toEqual({ width: 200, height: 100 });
  });
});
