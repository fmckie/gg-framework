// Settings → Kleio, on the desktop: her voice, what she kept about you,
// Dictation and Group chats, then Remove. The voice picker sits beside a small
// still copy of the instrument she shows when you talk; Talk now is the page's
// one filled button. Removing the OpenAI or Typesafe key waits in the Remove
// group at the end, and asks first. Status lives on Overview. The phone keeps
// these as Setup's cards (settingsLayout.tsx).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  QuestionIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";
import {
  isJiwaChangeEvent,
  isMemoryChangeEvent,
  listJiwa,
  listMemories,
  subscribe,
  type Memory,
} from "../agent";
import { MemoryModal } from "../LazyMemoryModal";
import type { SettingsTabId } from "../SettingsScreen";
import { toast } from "../toast";
import {
  errorText,
  getSetupStatus,
  getVoiceStatus,
  KleioApiError,
  removeSetupKey,
  removeVoiceKey,
  setVoiceKey,
  setVoiceName,
  type SetupStatus,
  type VoiceStatus,
} from "./kleioApi";
import { brainCountText, modelReady } from "./BrainCard";
import { DictationCard } from "./DictationCard";
import { KeyField, KeyForm, setupKeyError } from "./KeyForm";
import { quotableMemories } from "./quotableMemories";
import { RemoveGroup, RemoveItem } from "./RemoveGroup";
import { keyError, OPENAI_KEYS_URL, VOICE_LABELS } from "./VoiceCard";
import { VoiceGuide } from "./VoiceGuide";
import { setVoiceReady, talkToKleio } from "./VoiceMode";

/** What the host said, or why it didn't: status 0 is no reply at all. */
type Load<T> =
  | { kind: "loading" }
  | { kind: "old" }
  | { kind: "away" }
  | { kind: "error"; text: string }
  | { kind: "ready"; value: T };

function loadFromError<T>(e: unknown): Load<T> {
  if (e instanceof KleioApiError && e.status === 404) return { kind: "old" };
  if (e instanceof KleioApiError && e.status === 0) return { kind: "away" };
  return { kind: "error", text: errorText(e) };
}

/** Memories shown as quotes; the rest are in Brain. */
const QUOTES_SHOWN = 3;

function TryAgain({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <button type="button" className="st-text-btn" onClick={onClick}>
      <ArrowClockwiseIcon size={12} weight="bold" aria-hidden="true" />
      Try again
    </button>
  );
}

export function KleioPage({
  onOpenTab,
  onIntroduce,
}: {
  onOpenTab: (tab: SettingsTabId) => void;
  /** Starts the Introduce-yourself chat. */
  onIntroduce: () => Promise<void>;
}): React.ReactElement {
  const [voice, setVoice] = useState<Load<VoiceStatus>>({ kind: "loading" });
  const [setup, setSetup] = useState<Load<SetupStatus>>({ kind: "loading" });

  const fetchVoice = useCallback(async (): Promise<void> => {
    try {
      setVoice({ kind: "ready", value: await getVoiceStatus() });
    } catch (e) {
      setVoice(loadFromError(e));
    }
  }, []);
  const fetchSetup = useCallback(async (): Promise<void> => {
    try {
      setSetup({ kind: "ready", value: await getSetupStatus() });
    } catch (e) {
      setSetup(loadFromError(e));
    }
  }, []);
  useEffect(() => {
    void fetchVoice();
    void fetchSetup();
  }, [fetchVoice, fetchSetup]);

  /** Try again, on either section: ask the host for everything it didn't say. */
  const retry = (): void => {
    if (voice.kind !== "ready") {
      setVoice({ kind: "loading" });
      void fetchVoice();
    }
    if (setup.kind !== "ready") {
      setSetup({ kind: "loading" });
      void fetchSetup();
    }
  };

  const tookVoice = (s: VoiceStatus): void => {
    setVoice({ kind: "ready", value: s });
    setVoiceReady(s.ready);
  };
  // Until the host says otherwise (an older host can't), assume an admin: the
  // host still refuses a change from any other device.
  const canEdit = setup.kind !== "ready" || setup.value.admin;
  const voiceKey = voice.kind === "ready" && voice.value.ready && canEdit;
  const typesafeKey =
    setup.kind === "ready" && setup.value.admin && setup.value.keys.typesafe === "saved";

  return (
    <div className="kl-page">
      <VoiceSection voice={voice} canEdit={canEdit} onVoice={tookVoice} onRetry={retry} />
      <Memories onIntroduce={onIntroduce} onOpenTab={onOpenTab} />
      <div className="kl-quiet-row">
        {/* Any paired device: dictating starts the same download, and no key is involved. */}
        <DictationCard section />
        <GroupChats
          load={setup}
          onStatus={(s) => setSetup({ kind: "ready", value: s })}
          onRetry={retry}
        />
      </div>
      {(voiceKey || typesafeKey) && (
        <RemoveGroup>
          {voiceKey && (
            <RemoveItem
              what="OpenAI key, saved on your host"
              ask="Remove OpenAI key"
              confirm="Remove OpenAI key"
              busyText="Removing…"
              hint="Talk now stops until a key is added again, and Brief me reads in the system's own voice."
              onRemove={async () => tookVoice(await removeVoiceKey())}
              describeError={keyError}
            />
          )}
          {typesafeKey && (
            <RemoveItem
              what="Typesafe key, saved on your host"
              ask="Remove Typesafe key"
              confirm="Remove Typesafe key"
              busyText="Removing…"
              hint="Group chats keep working, with simpler rules for who answers."
              onRemove={async () =>
                setSetup({ kind: "ready", value: await removeSetupKey("typesafe") })
              }
              describeError={(e) => setupKeyError("typesafe", e)}
            />
          )}
        </RemoveGroup>
      )}
    </div>
  );
}

// ─── the voice ──────────────────────────────────────────────────────────────

function VoiceSection({
  voice,
  canEdit,
  onVoice,
  onRetry,
}: {
  voice: Load<VoiceStatus>;
  canEdit: boolean;
  onVoice: (s: VoiceStatus) => void;
  onRetry: () => void;
}): React.ReactElement {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const status = voice.kind === "ready" ? voice.value : null;
  const live = status?.ready === true;

  async function pick(name: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      onVoice(await setVoiceName(name));
    } catch (e) {
      setError(keyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`kl-voice${live ? " is-live" : ""}`} aria-labelledby={titleId}>
      <VoiceMark live={live} />
      <div className="kl-voice-body">
        <h2 className="st-label" id={titleId}>
          Voice
        </h2>
        <p className="kl-voice-line">
          {live
            ? "Talk to Kleio out loud."
            : status
              ? "Give Kleio a voice."
              : voice.kind === "loading"
                ? "Checking her voice…"
                : "Her voice lives on your host."}
        </p>

        {status?.ready ? (
          <>
            <div className="kl-voice-controls">
              {canEdit && (
                <span className="kl-select-wrap">
                  <select
                    className="kl-select"
                    aria-label="Kleio's conversation voice"
                    value={status.voice}
                    disabled={busy}
                    onChange={(e) => void pick(e.target.value)}
                  >
                    {status.voices.map((v) => (
                      <option key={v} value={v}>
                        {VOICE_LABELS[v] ?? v}
                      </option>
                    ))}
                  </select>
                  <CaretDownIcon size={13} weight="bold" aria-hidden="true" />
                </span>
              )}
              {/* Any paired device can talk; only the key and the voice are the admin's. */}
              <button
                type="button"
                className="btn btn-primary kl-talk"
                onClick={() => void talkToKleio()}
              >
                <SpeakerHighIcon size={16} weight="bold" aria-hidden="true" />
                Talk now
              </button>
            </div>
            <p className="kl-voice-note">
              {canEdit
                ? "Changes apply from your next conversation."
                : "Only your admin device can change her voice or its key."}
            </p>
          </>
        ) : status && canEdit ? (
          <div className="kl-voice-key">
            <KeyField
              label="OpenAI API key"
              placeholder="OpenAI API key (sk-…)"
              url={OPENAI_KEYS_URL}
              hint="On platform.openai.com, open API keys and create a key."
              save={async (key) => onVoice(await setVoiceKey(key))}
              describeError={keyError}
            />
          </div>
        ) : status ? (
          <p className="kl-voice-note">Only your admin device can add the key.</p>
        ) : voice.kind === "old" ? (
          <p className="kl-voice-note">Your host needs the latest Kleio first.</p>
        ) : voice.kind === "away" || voice.kind === "error" ? (
          <div className="kl-voice-note">
            <span role="alert">
              {voice.kind === "away"
                ? "Your host isn't answering right now."
                : `Couldn't check her voice: ${voice.text}`}
            </span>
            <TryAgain onClick={onRetry} />
          </div>
        ) : null}
        {error && (
          <p className="kl-error" role="alert">
            {error}
          </p>
        )}

        <p className="kl-caption">
          A natural, two-way conversation, run by OpenAI with your own key, kept on your host. What
          she reads, including your memories, chats, files and project details, goes to OpenAI under
          that key. A typical day costs a few cents.
        </p>
        <button type="button" className="st-text-btn kl-guide" onClick={() => setGuide(true)}>
          <QuestionIcon size={13} weight="bold" aria-hidden="true" />
          What Kleio Voice can do
        </button>
      </div>
      {guide && <VoiceGuide onClose={() => setGuide(false)} />}
    </section>
  );
}

/** Polar point on the mark, centred on (100, 100). */
const at = (r: number, deg: number): string => {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${(100 + r * Math.cos(a)).toFixed(2)} ${(100 + r * Math.sin(a)).toFixed(2)}`;
};
const ticks = (from: number, to: number, every: number, skip = 0): string =>
  Array.from({ length: 360 / every }, (_, i) => i * every)
    .filter((d) => !skip || d % skip !== 0)
    .map((d) => `M${at(from, d)}L${at(to, d)}`)
    .join("");
const BEZEL_MINOR = ticks(90, 93.5, 5, 30);
const BEZEL_MAJOR = ticks(87, 94.5, 30);
const INDICES = ticks(65.5, 70, 90);
const RETICLE = ticks(29, 34, 90);

/**
 * The voice orb's instrument, drawn flat in ink hairlines: bezel ticks,
 * segmented arcs, a dotted track and the primary ring with its indices. While
 * her voice is ready only the primary ring breathes; otherwise it is a still,
 * dim ghost. No glow and no red, which Settings keeps for faults.
 */
function VoiceMark({ live }: { live: boolean }): React.ReactElement {
  return (
    <svg className={`kl-orb${live ? " is-live" : ""}`} viewBox="0 0 200 200" aria-hidden="true">
      <circle className="kl-i kl-i-faint" cx="100" cy="100" r="97" />
      <path className="kl-i kl-i-bezel" d={BEZEL_MINOR} />
      <path className="kl-i kl-i-major" d={BEZEL_MAJOR} />
      <circle
        className="kl-i kl-i-arcs"
        cx="100"
        cy="100"
        r="82"
        pathLength={360}
        transform="rotate(-24 100 100)"
      />
      <circle
        className="kl-i kl-i-arcs-fine"
        cx="100"
        cy="100"
        r="82"
        pathLength={360}
        transform="rotate(31 100 100)"
      />
      <circle className="kl-i kl-i-dots" cx="100" cy="100" r="75" pathLength={360} />
      <circle className="kl-i kl-i-dots-major" cx="100" cy="100" r="75" pathLength={360} />
      <circle className="kl-i kl-i-ring kl-breath" cx="100" cy="100" r="64" />
      <path className="kl-i kl-i-index" d={INDICES} />
      <circle className="kl-i kl-i-faint" cx="100" cy="100" r="57" />
      <circle className="kl-i kl-i-rim" cx="100" cy="100" r="41" />
      <circle className="kl-i kl-i-faint" cx="100" cy="100" r="34" />
      <path className="kl-i kl-i-reticle" d={RETICLE} />
    </svg>
  );
}

// ─── what she kept ──────────────────────────────────────────────────────────

type Kept =
  | { kind: "checking" }
  | { kind: "error"; text: string }
  | { kind: "ready"; memories: Memory[]; jiwa: number };

/** "today" / "yesterday" / "3 days ago" / "5 weeks ago". */
export function keptWhen(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

function Memories({
  onIntroduce,
  onOpenTab,
}: {
  onIntroduce: () => Promise<void>;
  onOpenTab: (tab: SettingsTabId) => void;
}): React.ReactElement {
  const titleId = useId();
  const [kept, setKept] = useState<Kept>({ kind: "checking" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [brainOpen, setBrainOpen] = useState(false);
  const latest = useRef(0);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const brainWasOpen = useRef(false);

  /** The newest answer wins, so a slow one can't undo a newer one. */
  const refresh = useCallback(async (): Promise<void> => {
    const id = ++latest.current;
    try {
      const [m, j] = await Promise.all([listMemories(), listJiwa()]);
      if (id !== latest.current) return;
      setKept({ kind: "ready", memories: m.memories, jiwa: j.jiwa.length });
    } catch (e) {
      if (id === latest.current) setKept({ kind: "error", text: errorText(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribe((event) => {
      if (isMemoryChangeEvent(event) || isJiwaChangeEvent(event)) void refresh();
    });
  }, [refresh]);

  // Once the Brain window has gone, focus goes back to Open Brain (as on
  // BrainCard: a click doesn't focus a button in WebKit).
  useEffect(() => {
    if (brainWasOpen.current && !brainOpen) openButtonRef.current?.focus();
    brainWasOpen.current = brainOpen;
  }, [brainOpen]);

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

  const total = kept.kind === "ready" ? kept.memories.length : 0;
  const shown = kept.kind === "ready" ? quotableMemories(kept.memories).slice(0, QUOTES_SHOWN) : [];
  const rest = total - shown.length;

  return (
    <section className="kl-kept" aria-labelledby={titleId}>
      <div className="kl-kept-head">
        <h2 className="st-label" id={titleId}>
          What Kleio kept
        </h2>
        {kept.kind === "ready" && total + kept.jiwa > 0 && (
          <span className="kl-kept-count">{brainCountText(total, kept.jiwa)}</span>
        )}
      </div>

      {kept.kind === "error" ? (
        <div className="kl-voice-note">
          <span role="alert">{`Couldn't check Brain: ${kept.text}`}</span>
          <TryAgain
            onClick={() => {
              setKept({ kind: "checking" });
              void refresh();
            }}
          />
        </div>
      ) : kept.kind === "ready" && shown.length > 0 ? (
        <ul className="kl-quotes">
          {shown.map((m) => (
            <li key={m.id} className="kl-quote">
              <span className="kl-quote-text">{`“${m.text}”`}</span>
              <span className="kl-quote-when">{keptWhen(m.updatedAt)}</span>
            </li>
          ))}
          {rest > 0 && <li className="kl-quote-rest">{`And ${rest} more in Brain.`}</li>}
        </ul>
      ) : kept.kind === "ready" ? (
        <p className="kl-kept-empty">
          {total > 0
            ? "What she kept is in Brain."
            : "Nothing yet. Introduce yourself: Kleio asks a few short questions and saves your answers."}
        </p>
      ) : null}

      {kept.kind !== "error" && (
        <div className="kl-kept-foot">
          {/* The same two buttons in every state, so focus on one survives a
              count that changes under it. */}
          <div className="kl-kept-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={starting}
              onClick={() => void introduce()}
            >
              {starting ? "Starting…" : "Introduce yourself"}
            </button>
            <button
              ref={openButtonRef}
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setBrainOpen(true)}
            >
              Open Brain
            </button>
          </div>
          <p className="kl-kept-note">
            Every device shares these, along with how you like her to work.
          </p>
        </div>
      )}
      {startError && (
        <p className="kl-error" role="alert">
          {startError}
        </p>
      )}
      {brainOpen && (
        <MemoryModal
          onClose={() => {
            setBrainOpen(false);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

// ─── group chats ────────────────────────────────────────────────────────────

function GroupChats({
  load,
  onStatus,
  onRetry,
}: {
  load: Load<SetupStatus>;
  onStatus: (s: SetupStatus) => void;
  onRetry: () => void;
}): React.ReactElement {
  const titleId = useId();
  const state = load.kind === "ready" ? load.value.keys.typesafe : null;
  const admin = load.kind === "ready" && load.value.admin;
  return (
    <section className="kl-quiet" aria-labelledby={titleId}>
      <h2 className="st-label" id={titleId}>
        Group chats
      </h2>
      <p className="kl-quiet-line">Typesafe decides who answers in a group chat.</p>
      <p className="kl-quiet-note">
        Optional. Without it, group chats still work, with simpler rules.
      </p>
      <div className="kl-quiet-body">
        {load.kind === "old" ? (
          <p className="kl-quiet-status">Your host needs the latest Kleio to change this.</p>
        ) : load.kind === "away" || load.kind === "error" ? (
          <div className="kl-quiet-status">
            <span role="alert">
              {load.kind === "away" ? "Your host isn't answering right now." : load.text}
            </span>
            <TryAgain onClick={onRetry} />
          </div>
        ) : state === "env" ? (
          <p className="kl-quiet-status">Set on the host itself, so it can't be changed here.</p>
        ) : state === "saved" ? (
          <p className="kl-quiet-status">
            {admin
              ? "Typesafe key saved on your host."
              : "Typesafe key saved on your host. Only your admin device can change it."}
          </p>
        ) : state === "missing" && admin ? (
          <details className="kl-disclose">
            <summary>Add a Typesafe key</summary>
            <KeyForm name="typesafe" onSaved={onStatus} />
          </details>
        ) : state === "missing" ? (
          <p className="kl-quiet-status">Only your admin device can add the key.</p>
        ) : null}
      </div>
    </section>
  );
}
