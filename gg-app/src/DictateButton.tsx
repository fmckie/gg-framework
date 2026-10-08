// Dictation (iPhone and Mac), the visible half: the mic button that sits beside send in
// every chat box, and the status pill (timer, then "Transcribing…") above it.
// The recording and transcription live in useDictation.ts.

import { CircleNotchIcon, MicrophoneIcon, SquareIcon } from "@phosphor-icons/react";
import type React from "react";
import { formatElapsed } from "./dictation-recorder";
import type { UseDictation } from "./useDictation";

/** The draft with dictated text joined on the end, kept within `max` characters. */
export function appendDictation(draft: string, text: string, max?: number): string {
  const joined = draft.trim() ? `${draft.trimEnd()} ${text}` : text;
  return max === undefined ? joined : joined.slice(0, max);
}

export function DictateButton({
  dictation,
  disabled = false,
}: {
  dictation: UseDictation;
  /** The chat box can't take text right now (e.g. its draft is locked). */
  disabled?: boolean;
}): React.ReactElement {
  const recording = dictation.phase === "recording";
  return (
    <button
      type="button"
      className={`icon-circle dictate-btn${recording ? " is-recording" : ""}`}
      aria-label={recording ? "Stop dictating" : "Dictate"}
      aria-pressed={recording}
      // Mid-start and mid-transcribe a tap does nothing; `disabled` would dim
      // the spinner, so those states are only announced as busy.
      aria-disabled={dictation.phase === "starting" || dictation.phase === "transcribing"}
      disabled={disabled}
      onClick={dictation.toggle}
    >
      {recording ? (
        <SquareIcon size={12} weight="fill" aria-hidden="true" />
      ) : dictation.phase === "transcribing" ? (
        <CircleNotchIcon className="kleio-spin" size={16} weight="bold" aria-hidden="true" />
      ) : (
        <MicrophoneIcon size={17} aria-hidden="true" />
      )}
    </button>
  );
}

/** Always mounted, so screen readers hear each change. The ticking timer is
 * hidden from them; they hear "Recording" once. */
export function DictationStatus({ dictation }: { dictation: UseDictation }): React.ReactElement {
  const { phase } = dictation;
  return (
    <div
      className={`dictation-status${phase === "recording" || phase === "transcribing" ? " visible" : ""}`}
      role="status"
    >
      {phase === "recording" && (
        <>
          <span className="dictation-dot" aria-hidden="true" />
          <span className="sr-only">Recording</span>
          <span aria-hidden="true">{formatElapsed(dictation.elapsedMs)}</span>
        </>
      )}
      {phase === "transcribing" && "Transcribing…"}
    </div>
  );
}
