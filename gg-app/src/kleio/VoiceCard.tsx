// Settings → About: Kleio's voice (OpenAI, natural). The key lives on the Mac
// mini; an admin device sets it and picks her voice and pace. Talk to Kleio
// needs this; without it, "Brief me" reads aloud in the system's own voice.

import { useEffect, useState } from "react";
import { SpeakerHighIcon } from "@phosphor-icons/react";
import { SettingsCard } from "../settings-section";
import {
  errorText,
  getVoiceStatus,
  KleioApiError,
  removeVoiceKey,
  setVoiceKey,
  setVoiceName,
  setVoiceSpeed,
  type VoiceStatus,
} from "./kleioApi";
import { setVoiceReady, talkToKleio } from "./VoiceMode";

/** Her speaking pace. OpenAI speeds the audio up after it's made, up to 1.5×. */
const SPEEDS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 0.9, label: "Relaxed (0.9×)" },
  { value: 1, label: "Normal (1×)" },
  { value: 1.15, label: "Brisk (1.15×, recommended)" },
  { value: 1.3, label: "Fast (1.3×)" },
  { value: 1.5, label: "Fastest (1.5×)" },
];

/** The speed choice closest to `speed` (a saved value may sit between two). */
function nearestSpeed(speed: number): number {
  let best = SPEEDS[0]?.value ?? 1;
  for (const s of SPEEDS) if (Math.abs(s.value - speed) < Math.abs(best - speed)) best = s.value;
  return best;
}

/** OpenAI's voices, as the picker names them; marin and cedar sound the most natural. */
const VOICE_LABELS: Record<string, string> = {
  marin: "Marin (natural, recommended)",
  cedar: "Cedar (natural)",
  coral: "Coral",
  sage: "Sage",
  shimmer: "Shimmer",
  alloy: "Alloy",
  ash: "Ash",
  ballad: "Ballad",
  echo: "Echo",
  verse: "Verse",
};

function keyError(e: unknown): string {
  if (e instanceof KleioApiError) {
    if (e.message === "bad_key")
      return "OpenAI didn't accept that key. Check you copied all of it.";
    if (e.message === "no_credit")
      return "That key works, but the account has no credit. Add some on platform.openai.com.";
    if (e.message === "forbidden") return "Only an admin device can set the key.";
    if (e.status === 404) return "Your Mac mini needs the latest Kleio first.";
  }
  return errorText(e);
}

function ConversationCard(): React.ReactElement {
  const [status, setStatus] = useState<VoiceStatus | null | "unavailable">(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getVoiceStatus().then(
      (s) => live && setStatus(s),
      () => live && setStatus("unavailable"),
    );
    return () => {
      live = false;
    };
  }, []);

  async function act(f: () => Promise<VoiceStatus>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const s = await f();
      setStatus(s);
      setVoiceReady(s.ready);
      setKey("");
    } catch (e) {
      setError(keyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard
      title="Talk to Kleio"
      description="A natural, two-way conversation, using OpenAI. Your key is kept on your Mac mini. A typical day costs a few cents."
    >
      {status === null ? (
        <p className="settings-desc">Checking…</p>
      ) : status === "unavailable" ? (
        <p className="settings-desc">Your Mac mini needs the latest Kleio first.</p>
      ) : status.ready ? (
        <>
          <div className="modal-row">
            <select
              className="modal-input"
              aria-label="Kleio's conversation voice"
              value={status.voice}
              disabled={busy}
              onChange={(e) => void act(() => setVoiceName(e.target.value))}
            >
              {status.voices.map((v) => (
                <option key={v} value={v}>
                  {VOICE_LABELS[v] ?? v}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-ghost" onClick={() => void talkToKleio()}>
              <SpeakerHighIcon size={16} weight="bold" aria-hidden="true" />
              Talk now
            </button>
          </div>
          <div className="modal-row">
            <label className="settings-desc" htmlFor="kleio-voice-speed">
              Speaking speed
            </label>
            <select
              id="kleio-voice-speed"
              className="modal-input"
              value={String(nearestSpeed(status.speed))}
              disabled={busy}
              onChange={(e) => void act(() => setVoiceSpeed(Number(e.target.value)))}
            >
              {SPEEDS.map((s) => (
                <option key={s.value} value={String(s.value)}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <p className="settings-desc">
            She remembers what you tell her in Brain, which text chat shares. Changes apply from
            your next conversation.
          </p>
          <div className="modal-row">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void act(removeVoiceKey)}
            >
              Remove OpenAI key
            </button>
          </div>
        </>
      ) : (
        <form
          className="modal-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void act(() => setVoiceKey(key));
          }}
        >
          <input
            className="modal-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="OpenAI API key (sk-…)"
            aria-label="OpenAI API key"
            value={key}
            disabled={busy}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
            {busy ? "Checking…" : "Save"}
          </button>
        </form>
      )}
      {error && (
        <p className="settings-desc is-error" role="alert">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}

export function VoiceCard(): React.ReactElement {
  return <ConversationCard />;
}
