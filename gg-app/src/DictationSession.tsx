// Dictation for the Chat and Code composer (App.tsx), loaded on the iPhone
// only. It runs useDictation and reports its state up, so App can keep the mic
// button and the status pill in their own places in the composer while the
// recorder, the button and their icons stay out of the initial chunk.
// Specialist and group chats are already lazy and use useDictation directly.

import type React from "react";
import { useEffect } from "react";
import { appendDictation } from "./DictateButton";
import { toast } from "./toast";
import { useDictation, type UseDictation } from "./useDictation";

export function DictationSession({
  setDraft,
  onDictated,
  onChange,
}: {
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  /** After the text joins the draft (App clears its enhance/history state). */
  onDictated: () => void;
  /** The current state, or null once this unmounts. */
  onChange: (dictation: UseDictation | null) => void;
}): null {
  const { phase, elapsedMs, toggle } = useDictation({
    onText: (text) => {
      setDraft((prev) => appendDictation(prev, text));
      onDictated();
    },
    onError: (message) => toast(message, "error"),
  });
  // Primitive deps and a stable `toggle`, so App re-rendering doesn't loop.
  useEffect(() => onChange({ phase, elapsedMs, toggle }), [onChange, phase, elapsedMs, toggle]);
  useEffect(() => () => onChange(null), [onChange]);
  return null;
}
