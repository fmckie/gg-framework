// kleio: keeping a chat whole across the iPhone's app lifecycle.
//
// iOS freezes a backgrounded app and its sockets. Coming back, Rust reconnects
// each event stream from its Last-Event-ID (`WindowEvent::Resumed`) and the
// host replays what was missed. Two cases still need the transcript re-read
// from the host:
//   - the host no longer had every missed event (`kleio_replay_gap`), and
//   - the chat was opened while a reply was already running (on the iPhone,
//     reopening a chat whose reply kept going in the background): the
//     finished messages load, the rest streams in live, and the start of the
//     reply in progress only arrives with a reload once it finishes.

/** What a window remembers between signals. */
export interface RehydrateMemory {
  hydratedWhileRunning: boolean;
}

export type RehydrateSignal =
  | { kind: "event"; type: string }
  | { kind: "hydrated"; running: boolean }
  | { kind: "running"; running: boolean };

/** Whether this signal means the transcript must be re-read from the host. */
export function needsRehydrate(memory: RehydrateMemory, signal: RehydrateSignal): boolean {
  switch (signal.kind) {
    case "event":
      return signal.type === "kleio_replay_gap";
    case "hydrated":
      memory.hydratedWhileRunning = signal.running;
      return false;
    case "running":
      if (signal.running || !memory.hydratedWhileRunning) return false;
      memory.hydratedWhileRunning = false;
      return true;
  }
}
