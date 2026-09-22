// Per-session SSE frame ring with disk persistence.
//
// Why persist: the proxy is deployable independently of the sidecar (Step 2
// finding #2). A proxy restart must not lose the frames a disconnected client
// still needs. Each session gets an append-only file of `id\tframe-json` lines;
// on startup the tail is reloaded so `Last-Event-ID` keeps working across
// restarts. The sidecar's session `.jsonl` holds only completed messages, not
// the live deltas, so it cannot substitute for this.
//
// Bounded: `maxFrames` in memory and on disk (the file is rewritten from memory
// when it grows past 2× the ring). Frames are opaque strings; the ring never
// parses them beyond what the proxy already extracted.

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface RingFrame {
  readonly id: number;
  /** Complete SSE frame text including the trailing blank line. */
  readonly frame: string;
}

export interface SessionRing {
  readonly sessionId: string;
  /** Highest id assigned so far (0 = none). */
  seq(): number;
  /** Append raw SSE frame text (without an id line); returns the assigned frame. */
  push(raw: string): RingFrame;
  /** Frames with id > `after`, oldest first. */
  since(after: number): RingFrame[];
  /** Oldest id still held, or null when empty. */
  oldest(): number | null;
  /** Most recent frame whose data matches `predicate`. */
  findLast(predicate: (frame: string) => boolean): RingFrame | null;
  /** Wait for any pending disk writes. */
  flush(): Promise<void>;
}

export interface RingStore {
  /** Get or create the ring for a session, loading its tail from disk once. */
  session(sessionId: string): Promise<SessionRing>;
  /** Rings currently loaded. */
  loaded(): SessionRing[];
}

export interface RingStoreOptions {
  /** Directory for per-session ring files. */
  readonly directory: string;
  readonly maxFrames?: number;
  readonly log?: (msg: string) => void;
}

const SAFE_SESSION = /^[A-Za-z0-9_-]{1,80}$/;

function ringPath(directory: string, sessionId: string): string {
  if (!SAFE_SESSION.test(sessionId))
    throw new Error(`unsafe session id: ${JSON.stringify(sessionId)}`);
  return join(directory, `${sessionId}.ring`);
}

function encodeFrame(raw: string): string {
  return `id: ${"%ID%"}\n${raw}\n\n`;
}

export function createRingStore(options: RingStoreOptions): RingStore {
  const maxFrames = options.maxFrames ?? 2000;
  const log = options.log ?? ((): void => {});
  const rings = new Map<string, Promise<SessionRing>>();
  const settled = new Map<string, SessionRing>();

  async function load(sessionId: string): Promise<SessionRing> {
    const path = ringPath(options.directory, sessionId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    let frames: RingFrame[] = [];
    let seq = 0;
    try {
      const text = await readFile(path, "utf8");
      for (const line of text.split("\n")) {
        if (!line) continue;
        const tab = line.indexOf("\t");
        if (tab < 0) continue;
        const id = Number(line.slice(0, tab));
        if (!Number.isInteger(id) || id <= seq) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line.slice(tab + 1));
        } catch {
          continue;
        }
        if (typeof raw !== "string") continue;
        seq = id;
        frames.push({ id, frame: encodeFrame(raw).replace("%ID%", String(id)) });
      }
      if (frames.length > maxFrames) frames = frames.slice(-maxFrames);
      if (frames.length) log(`[ring] ${sessionId}: reloaded ${frames.length} frames, seq=${seq}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    let onDiskLines = frames.length;
    let pending: Promise<void> = Promise.resolve();

    function queue(work: () => Promise<void>): void {
      pending = pending
        .then(work)
        .catch((e) => log(`[ring] ${sessionId}: write failed: ${String(e)}`));
    }

    function rewrite(): void {
      const snapshot = frames.map((f) => `${f.id}\t${JSON.stringify(stripId(f.frame))}\n`).join("");
      const count = frames.length;
      queue(async () => {
        const tmp = `${path}.tmp`;
        await writeFile(tmp, snapshot, { mode: 0o600 });
        await rename(tmp, path);
        onDiskLines = count;
      });
    }

    const ring: SessionRing = {
      sessionId,
      seq: () => seq,
      push(raw) {
        const id = ++seq;
        const frame: RingFrame = { id, frame: encodeFrame(raw).replace("%ID%", String(id)) };
        frames.push(frame);
        if (frames.length > maxFrames) frames.shift();
        onDiskLines += 1;
        if (onDiskLines > maxFrames * 2) rewrite();
        else queue(() => appendFile(path, `${id}\t${JSON.stringify(raw)}\n`, { mode: 0o600 }));
        return frame;
      },
      since(after) {
        return frames.filter((f) => f.id > after);
      },
      oldest() {
        return frames[0]?.id ?? null;
      },
      findLast(predicate) {
        for (let i = frames.length - 1; i >= 0; i -= 1) {
          const f = frames[i]!;
          if (predicate(f.frame)) return f;
        }
        return null;
      },
      flush: () => pending,
    };
    return ring;
  }

  return {
    session(sessionId) {
      let p = rings.get(sessionId);
      if (!p) {
        p = load(sessionId);
        rings.set(sessionId, p);
        p.then(
          (r) => settled.set(sessionId, r),
          () => rings.delete(sessionId),
        );
      }
      return p;
    },
    loaded() {
      return [...settled.values()];
    },
  };
}

/** Remove the leading `id: N\n` from a stored frame to get the raw text back. */
function stripId(frame: string): string {
  const nl = frame.indexOf("\n");
  return frame.slice(nl + 1, -2);
}
