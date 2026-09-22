import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRingStore } from "../src/sse-ring.js";

let dir: string;
const open: { flush: () => Promise<void> }[] = [];
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "kleio-ring-"))));
afterEach(async () => {
  // Rings append asynchronously; settle every write before the dir goes away.
  for (const r of open.splice(0)) await r.flush();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});
async function openRing(store: ReturnType<typeof createRingStore>, id: string) {
  const r = await store.session(id);
  open.push(r);
  return r;
}

const frameOf = (n: number) => `data: {"type":"text_delta","n":${n}}`;

describe("session ring", () => {
  it("assigns contiguous ids and serves since(after)", async () => {
    const store = createRingStore({ directory: dir, maxFrames: 10 });
    const ring = await openRing(store, "s1");
    for (let i = 1; i <= 5; i += 1) expect(ring.push(frameOf(i)).id).toBe(i);
    expect(ring.seq()).toBe(5);
    expect(ring.since(3).map((f) => f.id)).toEqual([4, 5]);
    expect(ring.since(0)[0]!.frame).toBe(`id: 1\n${frameOf(1)}\n\n`);
    expect(ring.since(99)).toEqual([]);
  });

  it("bounds memory and reports the oldest id still held", async () => {
    const store = createRingStore({ directory: dir, maxFrames: 3 });
    const ring = await openRing(store, "s1");
    for (let i = 1; i <= 7; i += 1) ring.push(frameOf(i));
    expect(ring.oldest()).toBe(5);
    expect(ring.since(0).map((f) => f.id)).toEqual([5, 6, 7]);
  });

  it("survives a process restart: seq continues and Last-Event-ID replay still works", async () => {
    const a = createRingStore({ directory: dir, maxFrames: 100 });
    const r1 = await openRing(a, "s1");
    for (let i = 1; i <= 4; i += 1) r1.push(frameOf(i));
    await r1.flush();

    const b = createRingStore({ directory: dir, maxFrames: 100 });
    const r2 = await openRing(b, "s1");
    expect(r2.seq()).toBe(4);
    expect(r2.since(2).map((f) => f.frame)).toEqual([
      `id: 3\n${frameOf(3)}\n\n`,
      `id: 4\n${frameOf(4)}\n\n`,
    ]);
    expect(r2.push(frameOf(5)).id).toBe(5);
    await r2.flush();
    expect(readFileSync(join(dir, "s1.ring"), "utf8").split("\n").filter(Boolean)).toHaveLength(5);
  });

  it("compacts the file once it grows past twice the ring", async () => {
    const store = createRingStore({ directory: dir, maxFrames: 4 });
    const ring = await openRing(store, "s1");
    for (let i = 1; i <= 20; i += 1) ring.push(frameOf(i));
    await ring.flush();
    const lines = readFileSync(join(dir, "s1.ring"), "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(8);
    const reloaded = await openRing(createRingStore({ directory: dir, maxFrames: 4 }), "s1");
    expect(reloaded.since(0).map((f) => f.id)).toEqual([17, 18, 19, 20]);
  });

  it("ignores corrupt or out-of-order lines on reload rather than failing", async () => {
    const store = createRingStore({ directory: dir });
    const ring = await openRing(store, "s1");
    ring.push(frameOf(1));
    ring.push(frameOf(2));
    await ring.flush();
    const path = join(dir, "s1.ring");
    const text = readFileSync(path, "utf8") + 'garbage\n1\t"stale"\nx\t"notnum"\n';
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, text);
    const reloaded = await openRing(createRingStore({ directory: dir }), "s1");
    expect(reloaded.since(0).map((f) => f.id)).toEqual([1, 2]);
  });

  it("findLast returns the newest matching frame", async () => {
    const r = await openRing(createRingStore({ directory: dir }), "s1");
    r.push('data: {"type":"ready","v":1}');
    r.push(frameOf(1));
    r.push('data: {"type":"ready","v":2}');
    r.push(frameOf(2));
    expect(r.findLast((f) => f.includes('"type":"ready"'))?.frame).toContain('"v":2');
  });

  it("refuses an unsafe session id before touching the filesystem", async () => {
    const store = createRingStore({ directory: dir });
    await expect(store.session("../etc")).rejects.toThrow(/unsafe session id/);
    await expect(store.session("a b")).rejects.toThrow(/unsafe session id/);
  });

  it("loaded() lists only settled rings", async () => {
    const store = createRingStore({ directory: dir });
    expect(store.loaded()).toEqual([]);
    await openRing(store, "s1");
    expect(store.loaded().map((r) => r.sessionId)).toEqual(["s1"]);
  });
});
