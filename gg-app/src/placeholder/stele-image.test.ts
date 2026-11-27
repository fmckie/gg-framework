// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openImageDataUrl } from "../agent";
import { GODS } from "../olympus/gods";
import { LAUREL_LEAVES, type Stele } from "./goal-stele";
import { STELE_SCALE, copyStele, drawStele, steleBlob, steleSize } from "./stele-image";

vi.mock("../agent", () => ({ openImageDataUrl: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const STELE: Stele = {
  id: 8000,
  outcome: "done",
  title: "Job done",
  laurel: "12:a",
  lines: [
    {
      key: "12:a",
      god: GODS.athena,
      name: "survey",
      ending: "Done",
      status: "done",
      time: "1m 5s",
      tools: "4",
      tokens: "↑ 900 · ↓ 1.2k",
      laurel: true,
    },
    {
      key: "12:b",
      god: GODS.hermes,
      name: "a".repeat(80),
      ending: "Stopped",
      status: "error",
      time: "–",
      tools: "9",
      tokens: "–",
      laurel: false,
    },
  ],
  totals: [
    { label: "Time", value: "7s" },
    { label: "Workers", value: "2 (1 failed)" },
  ],
};

/** A 2D context that only writes down what it is asked to draw. */
function brush(): {
  ctx: CanvasRenderingContext2D;
  texts: string[];
  images: unknown[][];
  /** How strongly each picture was drawn. */
  alphas: number[];
  leaves: number;
  scales: number[][];
} {
  const texts: string[] = [];
  const images: unknown[][] = [];
  const alphas: number[] = [];
  const scales: number[][] = [];
  const seen = { leaves: 0 };
  const ctx = {
    globalAlpha: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    ellipse: () => seen.leaves++,
    scale: (x: number, y: number) => scales.push([x, y]),
    fillText: (text: string) => texts.push(text),
    drawImage: (...args: unknown[]) => {
      images.push(args);
      alphas.push(ctx.globalAlpha);
    },
    // Seven wide a letter.
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    texts,
    images,
    alphas,
    scales,
    get leaves() {
      return seen.leaves;
    },
  };
}

describe("the stele's picture", () => {
  it("is as tall as its lines", () => {
    const one = steleSize({ ...STELE, lines: STELE.lines.slice(0, 1) });
    const two = steleSize(STELE);
    expect(two.width).toBe(one.width);
    expect(two.height).toBeGreaterThan(one.height);
    // With nobody brought in, room for saying so.
    expect(steleSize({ ...STELE, lines: [] }).height).toBe(one.height);
  });

  it("draws the outcome, a line for each worker and the totals", () => {
    const b = brush();
    const athena = {} as CanvasImageSource;
    drawStele(b.ctx, STELE, new Map([[GODS.athena.cameo, athena]]));
    expect(b.texts).toEqual([
      "JOB DONE",
      "WORKER",
      "ENDED",
      "TIME",
      "TOOLS USED",
      "TOKENS",
      "survey",
      "Laurels: most tools used",
      "Done",
      "1m 5s",
      "4",
      "↑ 900 · ↓ 1.2k",
      // A long name is cut to its column.
      expect.stringMatching(/^a{20,40}…$/),
      "Stopped",
      "–",
      "9",
      "–",
      "TIME",
      "7s",
      "WORKERS",
      "2 (1 failed)",
    ]);
    // One wreath, on the crowned line; a cameo only where one loaded.
    expect(b.leaves).toBe(LAUREL_LEAVES.length);
    expect(b.images).toEqual([[athena, 16, expect.any(Number), 24, 32]]);
  });

  it("dims the cameo of a worker that was stopped, by its row's status, and no other", () => {
    const b = brush();
    const cameo = {} as CanvasImageSource;
    drawStele(
      b.ctx,
      STELE,
      new Map([
        [GODS.athena.cameo, cameo],
        [GODS.hermes.cameo, cameo],
      ]),
    );
    expect(b.alphas).toEqual([1, 0.5]);
    // Whatever its line's words are, only the status dims it.
    const c = brush();
    const lines = STELE.lines.map((line) => ({
      ...line,
      ending: "Stopped",
      status: "done" as const,
    }));
    drawStele(c.ctx, { ...STELE, lines }, new Map([[GODS.hermes.cameo, cameo]]));
    expect(c.alphas).toEqual([1]);
  });

  it("says so when nobody was brought in, and draws no laurel", () => {
    const b = brush();
    drawStele(b.ctx, { ...STELE, lines: [], laurel: null }, new Map());
    expect(b.texts).toEqual([
      "JOB DONE",
      "No workers were brought in.",
      "TIME",
      "7s",
      "WORKERS",
      "2 (1 failed)",
    ]);
    expect(b.leaves).toBe(0);
  });

  it("is made at twice the size, as a PNG, once the carved face and the cameos are in", async () => {
    const b = brush();
    const sized: number[][] = [];
    const png = new Blob(["png"], { type: "image/png" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      sized.push([this.width, this.height]);
      return b.ctx;
    } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((done, type) => done(type === "image/png" ? png : null));
    const loaded: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(url: string) {
          loaded.push(url);
          // Hermes's cameo won't load: its line goes without.
          queueMicrotask(() => (url === GODS.hermes.cameo ? this.onerror?.() : this.onload?.()));
        }
      },
    );
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, "fonts", { configurable: true, value: { load } });
    try {
      expect(await steleBlob(STELE)).toBe(png);
    } finally {
      Reflect.deleteProperty(document, "fonts");
    }
    const { width, height } = steleSize(STELE);
    expect(STELE_SCALE).toBe(2);
    expect(sized).toEqual([[width * 2, height * 2]]);
    expect(b.scales).toEqual([[2, 2]]);
    expect(load).toHaveBeenCalledWith(expect.stringContaining('"Bungee"'));
    expect(loaded).toEqual([GODS.athena.cameo, GODS.hermes.cameo]);
    expect(b.images).toHaveLength(1);
    expect(toBlob).toHaveBeenCalledTimes(1);
  });

  it("is made without its cameos where the canvas won't be read back with them", async () => {
    const b = brush();
    const png = new Blob(["png"], { type: "image/png" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(b.ctx as never);
    let tries = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((done) => {
      if (tries++ === 0) throw new DOMException("tainted", "SecurityError");
      done(png);
    });
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        set src(_url: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    expect(await steleBlob(STELE)).toBe(png);
    // Both cameos the first time, none the second.
    expect(b.images).toHaveLength(2);
  });
});

describe("copying the stele", () => {
  const png = new Blob(["png"], { type: "image/png" });
  class Item {
    constructor(readonly parts: Record<string, Promise<Blob>>) {}
  }

  it("puts the picture on the clipboard as a PNG", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", { clipboard: { write } });
    const blobOf = vi.fn().mockResolvedValue(png);
    expect(await copyStele(STELE, blobOf)).toBe("copied");
    expect(blobOf).toHaveBeenCalledExactlyOnceWith(STELE);
    const [[items]] = write.mock.calls as [[Item[]]];
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!.parts)).toEqual(["image/png"]);
    expect(await items[0]!.parts["image/png"]).toBe(png);
    expect(openImageDataUrl).not.toHaveBeenCalled();
  });

  it("asks the clipboard within the click, before the picture is made", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", { clipboard: { write } });
    void copyStele(STELE, () => new Promise(() => undefined));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("opens the picture in the image viewer when the clipboard refuses", async () => {
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", {
      clipboard: { write: vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError")) },
    });
    expect(await copyStele(STELE, async () => png)).toBe("opened");
    expect(openImageDataUrl).toHaveBeenCalledExactlyOnceWith(
      `data:image/png;base64,${btoa("png")}`,
    );
  });

  it("opens it in the viewer where there is no clipboard for pictures at all", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", {});
    expect(await copyStele(STELE, async () => png)).toBe("opened");
    expect(openImageDataUrl).toHaveBeenCalledTimes(1);
  });

  it("fails plainly when no picture could be made", async () => {
    vi.stubGlobal("ClipboardItem", Item);
    vi.stubGlobal("navigator", {
      clipboard: { write: (items: Item[]) => items[0]!.parts["image/png"] },
    });
    expect(await copyStele(STELE, () => Promise.reject(new Error("no canvas")))).toBe("failed");
    expect(openImageDataUrl).not.toHaveBeenCalled();
  });
});
