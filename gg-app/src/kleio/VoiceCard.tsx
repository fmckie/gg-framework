// Settings → About: Kleio's voice for "Brief me" on this device. The voices
// are the system's own, so they cost nothing and stay on the device.

import { useEffect, useState } from "react";
import { SpeakerHighIcon } from "@phosphor-icons/react";
import { SettingsCard } from "../settings-section";
import {
  canSpeak,
  englishVoices,
  loadVoices,
  pickVoice,
  primeSpeech,
  savedVoice,
  setSavedVoice,
  speak,
  type VoiceChoice,
} from "./kleioVoice";

const SAMPLE = "Hi, I'm Kleio. Here's what's happening on your Mac mini.";

export function VoiceCard(): React.ReactElement | null {
  const [voices, setVoices] = useState<VoiceChoice[] | null>(null);
  const [chosen, setChosen] = useState<string>("");

  useEffect(() => {
    if (!canSpeak()) return;
    let live = true;
    void loadVoices().then((all) => {
      if (!live) return;
      setVoices(englishVoices(all));
      setChosen(pickVoice(all, savedVoice())?.voiceURI ?? "");
    });
    return () => {
      live = false;
    };
  }, []);

  if (!canSpeak()) return null;

  function choose(id: string): void {
    setChosen(id);
    setSavedVoice(id || null);
    primeSpeech();
    void speak(SAMPLE);
  }

  return (
    <SettingsCard
      title="Kleio's voice"
      description="The voice that reads your briefings on this device."
    >
      {voices === null ? (
        <p className="settings-desc">Loading voices…</p>
      ) : voices.length === 0 ? (
        <p className="settings-desc">This device has no English voices installed.</p>
      ) : (
        <div className="modal-row">
          <select
            className="modal-input"
            aria-label="Kleio's voice"
            value={chosen}
            onChange={(e) => choose(e.target.value)}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              primeSpeech();
              void speak(SAMPLE);
            }}
          >
            <SpeakerHighIcon size={16} weight="bold" aria-hidden="true" />
            Hear it
          </button>
        </div>
      )}
    </SettingsCard>
  );
}
