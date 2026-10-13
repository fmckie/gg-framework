// Settings → Setup: Kleio's voice (OpenAI GPT-Live), one of the setup steps.
// The key lives on the host; an admin device sets it and picks her voice. Talk
// to Kleio needs this; without it, "Brief me" reads aloud in the system's own
// voice.

import { useEffect, useState } from "react";
import { QuestionIcon, SpeakerHighIcon } from "@phosphor-icons/react";
import { SettingsCard } from "../settings-section";
import {
  errorText,
  getVoiceStatus,
  KleioApiError,
  removeVoiceKey,
  setVoiceKey,
  setVoiceName,
  type VoiceStatus,
} from "./kleioApi";
import { KeyField } from "./KeyForm";
import { StepBadge, type StepMark } from "./StepBadge";
import { VoiceGuide } from "./VoiceGuide";
import { setVoiceReady, talkToKleio } from "./VoiceMode";

const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";

/** GPT-Live's voices, as the picker names them; marin and cedar sound the most natural. */
const VOICE_LABELS: Record<string, string> = {
  marin: "Marin (natural, recommended)",
  cedar: "Cedar (natural)",
  vesper: "Vesper (British)",
  willow: "Willow (Irish)",
  stone: "Stone (Irish)",
  quartz: "Quartz (Australian)",
  ripple: "Ripple (Australian)",
  gleam: "Gleam (North American)",
  meridian: "Meridian (North American)",
  delta: "Delta (Southern US)",
  cinder: "Cinder (Southern US)",
  beacon: "Beacon (Filipino)",
  bossa: "Bossa (Brazilian Portuguese)",
  tempo: "Tempo (Brazilian Portuguese)",
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
    if (e.status === 404) return "Your host needs the latest Kleio first.";
  }
  return errorText(e);
}

/**
 * `canEdit` false (a device that isn't an admin): the key, the voice and
 * removing the key are left to the admin device, as the host only lets it
 * change them. Talking works from any device. `onReady` hears whether she can
 * talk (null until the host says), for Setup's progress.
 */
function ConversationCard({
  canEdit,
  onReady,
}: {
  canEdit: boolean;
  onReady?: (ready: boolean | null) => void;
}): React.ReactElement {
  const [status, setStatus] = useState<VoiceStatus | null | "unavailable">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);

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

  useEffect(() => {
    onReady?.(status === null || status === "unavailable" ? null : status.ready);
  }, [status, onReady]);

  function took(s: VoiceStatus): void {
    setStatus(s);
    setVoiceReady(s.ready);
  }

  async function act(f: () => Promise<VoiceStatus>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      took(await f());
    } catch (e) {
      setError(keyError(e));
    } finally {
      setBusy(false);
    }
  }

  const mark: StepMark =
    status === null
      ? "checking"
      : status === "unavailable"
        ? "unknown"
        : status.ready
          ? "done"
          : "needed";

  return (
    <SettingsCard
      title="Talk to Kleio"
      subtitle="OpenAI"
      badge={<StepBadge mark={mark} />}
      description="A natural, two-way conversation, run by OpenAI with your own key, kept on your host. What she reads, including your memories, chats, files and project details, goes to OpenAI under that key. A typical day costs a few cents."
    >
      {status === null ? null : status === "unavailable" ? (
        <p className="settings-desc">Your host needs the latest Kleio first.</p>
      ) : status.ready ? (
        <>
          <div className="modal-row">
            {canEdit && (
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
            )}
            <button type="button" className="btn btn-ghost" onClick={() => void talkToKleio()}>
              <SpeakerHighIcon size={16} weight="bold" aria-hidden="true" />
              Talk now
            </button>
          </div>
          <p className="settings-desc">
            She remembers what you tell her in Brain, which text chat shares. Changes apply from
            your next conversation.
          </p>
          {canEdit && (
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
          )}
        </>
      ) : canEdit ? (
        <KeyField
          label="OpenAI API key"
          placeholder="OpenAI API key (sk-…)"
          url={OPENAI_KEYS_URL}
          hint="On platform.openai.com, open API keys and create a key."
          save={async (key) => took(await setVoiceKey(key))}
          describeError={keyError}
        />
      ) : null}
      {error && (
        <p className="settings-desc is-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGuide(true)}>
          <QuestionIcon size={14} weight="bold" aria-hidden="true" />
          What Kleio Voice can do
        </button>
      </div>
      {guide && <VoiceGuide onClose={() => setGuide(false)} />}
    </SettingsCard>
  );
}

/** `canEdit`: whether this device may change the key and voice (an admin device). */
export function VoiceCard({
  canEdit = true,
  onReady,
}: {
  canEdit?: boolean;
  onReady?: (ready: boolean | null) => void;
}): React.ReactElement {
  return <ConversationCard canEdit={canEdit} onReady={onReady} />;
}
