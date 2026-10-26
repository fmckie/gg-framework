// A resumed chat's tool images, loaded as the transcript scrolls to them.
// The chat's history lists each image by ref (`listHistory(true)`), and
// `HistoryImage` fetches its preview once it comes within a screen of the
// transcript's visible part, a few at a time (`historyImages`). So a chat
// opens with only the images near the bottom: through a shared relay at
// about 1 MB/s, a chat's 54 previews took 3.7 MB, a screen's worth a few
// hundred KB.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { historyImages } from "./agent";

/** The most refs one request asks for (the sidecar's limit). */
const BATCH_MAX = 8;
/** How long requests are gathered into one. */
const BATCH_WAIT_MS = 16;
/** Previews kept for scrolling back or reopening a chat: about 70 KB each. */
const KEEP_MAX = 96;
/** A preview's box in the transcript, at most: `.img-card` and `.img-thumb`. */
const SHOWN_MAX_WIDTH = 320;
const SHOWN_MAX_HEIGHT = 280;

type Fetch = (refs: readonly string[]) => Promise<Record<string, string>>;

interface Waiter {
  resolve: (src: string) => void;
  reject: (error: unknown) => void;
}

/**
 * Gathers the refs asked for in a moment into requests of at most
 * BATCH_MAX, and keeps the last KEEP_MAX previews.
 */
export class HistoryImageLoader {
  private readonly kept = new Map<string, string>();
  private readonly waiting = new Map<string, Waiter[]>();
  private queued: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly fetchRefs: Fetch = historyImages) {}

  /** A ref's preview as a data URL. Rejects when it can't be had. */
  load(ref: string): Promise<string> {
    const kept = this.kept.get(ref);
    if (kept !== undefined) {
      // The most recently used goes last, so the oldest goes first.
      this.kept.delete(ref);
      this.kept.set(ref, kept);
      return Promise.resolve(kept);
    }
    return new Promise((resolve, reject) => {
      const waiters = this.waiting.get(ref);
      if (waiters) {
        waiters.push({ resolve, reject });
        return;
      }
      this.waiting.set(ref, [{ resolve, reject }]);
      this.queued.push(ref);
      this.timer ??= setTimeout(() => this.send(), BATCH_WAIT_MS);
    });
  }

  /** Fails what's waiting, and sends nothing more for it. */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queued = [];
    for (const ref of [...this.waiting.keys()]) this.fail(ref, new Error("closed"));
  }

  private send(): void {
    this.timer = null;
    while (this.queued.length > 0) {
      const batch = this.queued.splice(0, BATCH_MAX);
      void this.fetchRefs(batch).then(
        (images) => {
          for (const ref of batch) this.settle(ref, images[ref]);
        },
        (error: unknown) => {
          for (const ref of batch) this.fail(ref, error);
        },
      );
    }
  }

  private settle(ref: string, src: string | undefined): void {
    if (src === undefined) {
      this.fail(ref, new Error("That image is no longer in this chat."));
      return;
    }
    this.kept.set(ref, src);
    for (const oldest of this.kept.keys()) {
      if (this.kept.size <= KEEP_MAX) break;
      this.kept.delete(oldest);
    }
    for (const waiter of this.waiting.get(ref) ?? []) waiter.resolve(src);
    this.waiting.delete(ref);
  }

  private fail(ref: string, error: unknown): void {
    for (const waiter of this.waiting.get(ref) ?? []) waiter.reject(error);
    this.waiting.delete(ref);
  }
}

const LoaderContext = createContext<HistoryImageLoader | null>(null);

/** One loader for the transcript's images, for as long as it's shown. */
export function HistoryImagesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [loader] = useState(() => new HistoryImageLoader());
  useEffect(() => () => loader.dispose(), [loader]);
  return <LoaderContext.Provider value={loader}>{children}</LoaderContext.Provider>;
}

/** An image in the transcript: its preview, or a ref to load it by. */
export interface HistoryImageSource {
  src?: string;
  ref?: string;
  width?: number;
  height?: number;
}

/** The size the transcript shows an image at: within the card's 320 × 280. */
export function shownSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, SHOWN_MAX_WIDTH / width, SHOWN_MAX_HEIGHT / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** The nearest ancestor that scrolls up and down, or null for the page. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return null;
}

/** True once `ref` comes within a screen of its scroller's visible part. */
function useNear(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: scrollerOf(el), rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

type Loaded = { state: "waiting" } | { state: "ready"; src: string } | { state: "failed" };

/** An image by ref: a box of its size until its preview comes. */
function LazyImage({
  imageRef,
  size,
  alt,
  onLoad,
}: {
  imageRef: string;
  size: { width: number; height: number } | null;
  alt: string;
  onLoad?: () => void;
}): React.ReactElement {
  const loader = useContext(LoaderContext);
  const box = useRef<HTMLDivElement>(null);
  const near = useNear(box);
  const [loaded, setLoaded] = useState<Loaded>({ state: "waiting" });
  useEffect(() => {
    if (!near) return;
    if (!loader) {
      setLoaded({ state: "failed" });
      return;
    }
    let alive = true;
    void loader.load(imageRef).then(
      (src) => {
        if (alive) setLoaded({ state: "ready", src });
      },
      () => {
        if (alive) setLoaded({ state: "failed" });
      },
    );
    return () => {
      alive = false;
    };
  }, [near, loader, imageRef]);

  if (loaded.state === "ready") {
    return <img className="img-thumb" src={loaded.src} alt={alt} onLoad={onLoad} />;
  }
  const shown = size ? shownSize(size.width, size.height) : null;
  const style = shown
    ? { width: `${shown.width}px`, aspectRatio: `${shown.width} / ${shown.height}` }
    : undefined;
  if (loaded.state === "failed") {
    return (
      <div className="img-thumb img-thumb-failed" style={style} role="img" aria-label={alt}>
        Preview didn&apos;t load
      </div>
    );
  }
  return (
    <div
      ref={box}
      className="img-thumb img-thumb-waiting skeleton"
      style={style}
      role="img"
      aria-label={alt}
      aria-busy="true"
    />
  );
}

/** A transcript image: its preview now, or once it's scrolled to. */
export function HistoryImage({
  image,
  alt,
  onLoad,
}: {
  image: HistoryImageSource;
  alt: string;
  onLoad?: () => void;
}): React.ReactElement {
  if (image.src !== undefined || image.ref === undefined) {
    return <img className="img-thumb" src={image.src} alt={alt} onLoad={onLoad} />;
  }
  const size = image.width && image.height ? { width: image.width, height: image.height } : null;
  return <LazyImage imageRef={image.ref} size={size} alt={alt} onLoad={onLoad} />;
}
