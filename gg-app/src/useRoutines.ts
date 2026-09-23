// `/schedule` runtime, daemon-side. The sidecar owns the ticker and the list
// (`~/.gg/routines.json`); this hook mirrors it. A routine fires whether or
// not this window — or any window — is open, which on a Kleio host is the
// whole point. The rules (skip missed, queue rather than drop, no duplicate in
// the queue, one fire per tick, first run one interval out) live in the
// engine's `routines.ts` (@kleio/coder).

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { subscribe } from "./agent";
import type { ActiveSchedule } from "./RunningSchedulesButton";
import type { ParsedSchedule } from "./scheduleCommand";

export interface Routine extends ActiveSchedule {
  createdAt: number;
  cwd: string;
  mode: "code" | "chat";
  chatAgent?: string;
  lastRun?: { at: number; outcome: "sent" | "queued" | "skipped" | "error"; error?: string };
}

export interface UseRoutinesOptions {
  /** Where a new routine runs: this window's project. */
  cwd: string | undefined;
  mode: "code" | "chat";
  chatAgent?: string;
}

export interface UseRoutines {
  routines: readonly Routine[];
  /** Register a parsed `/schedule`. Rejects with the daemon's reason. */
  addSchedule: (parsed: ParsedSchedule) => Promise<Routine>;
  stopSchedule: (id: string) => void;
}

export function useRoutines({ cwd, mode, chatAgent }: UseRoutinesOptions): UseRoutines {
  const [routines, setRoutines] = useState<readonly Routine[]>([]);

  useEffect(() => {
    let alive = true;
    // Paint from the daemon's list, then follow its `routines` broadcasts.
    // Every window (and every routine's own session) receives the same frame.
    void invoke<{ routines: Routine[] }>("routines_list")
      .then((r) => {
        if (alive) setRoutines(r.routines);
      })
      .catch(() => {
        /* daemon not up yet; the first broadcast fills it in */
      });
    const unsub = subscribe((e) => {
      if (e.type !== "routines") return;
      const d = e.data as { routines?: Routine[] } | undefined;
      if (Array.isArray(d?.routines)) setRoutines(d.routines);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const addSchedule = useCallback(
    async (parsed: ParsedSchedule): Promise<Routine> => {
      if (!cwd) throw new Error("No project open — a routine needs a folder to run in.");
      const res = await invoke<{ routine: Routine }>("routines_add", {
        routine: {
          prompt: parsed.prompt,
          intervalMs: parsed.intervalMs,
          runCount: parsed.runCount,
          cwd,
          mode,
          ...(chatAgent ? { chatAgent } : {}),
        },
      });
      return res.routine;
    },
    [cwd, mode, chatAgent],
  );

  const stopSchedule = useCallback((id: string) => {
    // Drop it locally at once; the broadcast confirms (or restores) shortly.
    setRoutines((prev) => prev.filter((r) => r.id !== id));
    void invoke("routines_remove", { id }).catch(() => {
      void invoke<{ routines: Routine[] }>("routines_list").then((r) => setRoutines(r.routines));
    });
  }, []);

  return { routines, addSchedule, stopSchedule };
}
