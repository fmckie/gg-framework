// The lane's one clock (the mockup's sim.js). The floor's steps go into one
// queue and are handled in time order, each seeing the clock at its own
// moment; then every view is drawn. So a run plays the same way however the
// frames fall. The loop sleeps when there is nothing to do: until its next
// step while every view is still, and frame by frame while one is moving. A
// view that is still, but will move by itself at a moment it knows, says when:
// the loop sleeps until then too, with no step put on the queue for it.

/** What the clock runs on: the window's, or a test's. */
export interface SimHost {
  /** Ms on a clock that only goes forward. */
  now(): number;
  /** Call back at the next frame (`ms` 0), or once `ms` have passed. */
  defer(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/** A step put on the clock; `cancel` takes it off. */
export interface SimEvent {
  readonly t: number;
  dead: boolean;
}

/**
 * A view draws the frame at `now`, and says whether it is still moving; or,
 * still, the moment it will next move of its own accord.
 */
export type SimView = (now: number) => boolean | number;

export interface Sim {
  /** The moment being handled or drawn. */
  now(): number;
  at(t: number, fn: () => void): SimEvent;
  after(ms: number, fn: () => void): SimEvent;
  /** Something from outside, handled in turn at the clock's present moment. */
  soon(fn: () => void): SimEvent;
  cancel(event: SimEvent | null | undefined): void;
  view(fn: SimView): void;
  wake(): void;
  /** Stop for good: nothing more is handled or drawn. */
  stop(): void;
}

interface Queued extends SimEvent {
  readonly n: number;
  readonly fn: () => void;
}

/** The window's clock: frames from requestAnimationFrame, waits from setTimeout. */
export function windowHost(): SimHost {
  return {
    now: () => performance.now(),
    defer: (fn, ms) =>
      ms <= 0 ? { frame: window.requestAnimationFrame(fn) } : { timer: window.setTimeout(fn, ms) },
    cancel(handle) {
      const h = handle as { frame?: number; timer?: number };
      if (h.frame !== undefined) window.cancelAnimationFrame(h.frame);
      if (h.timer !== undefined) window.clearTimeout(h.timer);
    },
  };
}

export function createSim(host: SimHost = windowHost()): Sim {
  const born = host.now();
  const queue: Queued[] = []; // by time, then by when it was asked for
  const views: SimView[] = [];
  let n = 0;
  let at = 0;
  let pending: { handle: unknown; framed: boolean } | null = null;
  let running = false; // while a frame runs, what it schedules waits for the frame's own decision
  let stopped = false;

  const clock = (): number => host.now() - born;

  function schedule(t: number, fn: () => void): SimEvent {
    const e: Queued = { t: Math.max(t, at), n: n++, fn, dead: false };
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const q = queue[mid]!;
      if (q.t < e.t || (q.t === e.t && q.n < e.n)) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, e);
    wake();
    return e;
  }

  function sleep(ms: number): void {
    pending = { handle: host.defer(frame, ms), framed: ms <= 0 };
  }

  function frame(): void {
    pending = null;
    if (stopped) return;
    running = true;
    const target = clock();
    while (queue.length && queue[0]!.t <= target) {
      const e = queue.shift()!;
      if (e.dead) continue;
      at = e.t;
      e.fn();
    }
    at = target;
    let busy = false;
    let due = Infinity; // the earliest moment a still view will move by itself
    for (const view of views) {
      const moving = view(at);
      if (moving === true || (moving !== false && moving <= at)) busy = true;
      else if (moving !== false) due = Math.min(due, moving);
    }
    running = false;
    if (stopped) return;
    if (busy) return sleep(0);
    const next = queue.find((e) => !e.dead);
    if (next) due = Math.min(due, next.t);
    if (due < Infinity) sleep(Math.max(1, due - clock()));
  }

  function wake(): void {
    if (running || stopped || pending?.framed) return;
    if (pending) host.cancel(pending.handle);
    sleep(0);
  }

  return {
    now: () => at,
    at: schedule,
    after: (ms, fn) => schedule(at + ms, fn),
    soon: (fn) => schedule(clock(), fn),
    cancel(event) {
      if (event) event.dead = true;
    },
    view(fn) {
      views.push(fn);
      wake();
    },
    wake,
    stop() {
      stopped = true;
      if (pending) host.cancel(pending.handle);
      pending = null;
      queue.length = 0;
      views.length = 0;
    },
  };
}
