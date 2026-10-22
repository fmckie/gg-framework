// Settings → Setup: Brain, one of the optional steps. What Kleio remembers
// about you (memories) and how you like her to work (Jiwa): one store on the
// host that every device shares. "Introduce yourself" starts a chat in which
// Kleio asks a few short questions and saves the answers with her own tools;
// Open Brain shows the entries, to add, edit or delete. Any paired device can
// do both, as chatting already does.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  authStatusWithError,
  getLocalModels,
  isJiwaChangeEvent,
  isMemoryChangeEvent,
  listJiwa,
  listMemories,
  subscribe,
} from "../agent";
import { MemoryModal } from "../LazyMemoryModal";
import { SettingsCard } from "../settings-section";
import type { SettingsTabId } from "../SettingsScreen";
import { toast } from "../toast";
import { errorText } from "./kleioApi";
import { hasUsableLocalModel } from "./privateModels";
import { StepBadge, type StepMark } from "./StepBadge";

type Counts =
  | { kind: "checking" }
  | { kind: "error"; text: string }
  | { kind: "ready"; memories: number; jiwa: number };

/** "12 memories and 3 Jiwa instructions.", in the singular where there's one. */
export function brainCountText(memories: number, jiwa: number): string {
  const memoryWords = `${memories} ${memories === 1 ? "memory" : "memories"}`;
  const jiwaWords = `${jiwa} Jiwa ${jiwa === 1 ? "instruction" : "instructions"}`;
  return `${memoryWords} and ${jiwaWords}.`;
}

/**
 * Whether Kleio has a model to think with, decided as Home's Kleio button does
 * (KleioHome.tsx): a signed-in provider, or a private model that's running.
 * Unknown (the host didn't answer) doesn't block; the chat explains.
 */
async function modelReady(): Promise<boolean> {
  const [auth, local] = await Promise.all([
    authStatusWithError().catch(() => null),
    getLocalModels().catch(() => null),
  ]);
  const signedIn = auth && !auth.error ? auth.providers.some((p) => p.connected) : null;
  const localReady = local ? hasUsableLocalModel(local) : null;
  return signedIn !== false || localReady === true;
}

interface Props {
  /** Opens a new chat with Kleio on the Introduce-yourself prompt (App). */
  onIntroduce: () => Promise<void>;
  onOpenTab: (tab: SettingsTabId) => void;
}

export function BrainCard({ onIntroduce, onOpenTab }: Props): React.ReactElement {
  const [counts, setCounts] = useState<Counts>({ kind: "checking" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [brainOpen, setBrainOpen] = useState(false);
  const latest = useRef(0);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const brainWasOpen = useRef(false);

  /** The newest count wins, so a slow answer can't undo a newer one. */
  const refresh = useCallback(async (): Promise<void> => {
    const id = ++latest.current;
    try {
      const [memories, jiwa] = await Promise.all([listMemories(), listJiwa()]);
      if (id !== latest.current) return;
      setCounts({ kind: "ready", memories: memories.memories.length, jiwa: jiwa.jiwa.length });
    } catch (e) {
      if (id === latest.current) setCounts({ kind: "error", text: errorText(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribe((event) => {
      if (isMemoryChangeEvent(event) || isJiwaChangeEvent(event)) void refresh();
    });
  }, [refresh]);

  // Once the Brain window has gone, focus goes back to Open Brain. Done here,
  // after the window's own focus return, because a click doesn't focus a
  // button in WebKit, so the window can't count on having seen it.
  useEffect(() => {
    if (brainWasOpen.current && !brainOpen) openButtonRef.current?.focus();
    brainWasOpen.current = brainOpen;
  }, [brainOpen]);

  const closeBrain = (): void => {
    setBrainOpen(false);
    void refresh();
  };

  async function introduce(): Promise<void> {
    setStarting(true);
    setStartError(null);
    try {
      if (!(await modelReady())) {
        toast("Connect an AI model first.", "warning");
        onOpenTab("providers");
        return;
      }
      await onIntroduce();
    } catch (e) {
      setStartError(`Couldn't start the chat: ${errorText(e)}`);
    } finally {
      setStarting(false);
    }
  }

  const empty = counts.kind === "ready" && counts.memories === 0 && counts.jiwa === 0;
  const mark: StepMark =
    counts.kind === "checking"
      ? "checking"
      : counts.kind === "error"
        ? "unknown"
        : empty
          ? "optional"
          : "done";

  return (
    <SettingsCard
      title="Brain"
      badge={<StepBadge mark={mark} />}
      description="What Kleio remembers about you and how you like her to work. Every device shares it."
    >
      {counts.kind === "error" ? (
        <div className="setup-status">
          <p className="settings-desc">{`Couldn't check Brain: ${counts.text}`}</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setCounts({ kind: "checking" });
              void refresh();
            }}
          >
            Try again
          </button>
        </div>
      ) : counts.kind === "ready" ? (
        <>
          <p className="settings-desc">
            {empty
              ? "Nothing yet. Introduce yourself: Kleio asks a few short questions and saves your answers."
              : brainCountText(counts.memories, counts.jiwa)}
          </p>
          {/* The same two buttons in both states, so focus on one survives a
              count that changes under it. */}
          <div className="setup-actions">
            <button
              type="button"
              className={empty ? "btn btn-primary" : "btn btn-ghost"}
              disabled={starting}
              onClick={() => void introduce()}
            >
              {starting ? "Starting…" : "Introduce yourself"}
            </button>
            <button
              ref={openButtonRef}
              type="button"
              className="btn btn-ghost"
              onClick={() => setBrainOpen(true)}
            >
              Open Brain
            </button>
          </div>
        </>
      ) : null}
      {startError && (
        <p className="settings-desc is-error" role="alert">
          {startError}
        </p>
      )}
      {brainOpen && <MemoryModal onClose={closeBrain} />}
    </SettingsCard>
  );
}
