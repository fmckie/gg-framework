// A question an agent is waiting on you to answer, in a specialist's chat or a
// group chat: the same option buttons as Chat and Code (AskBand). Picking
// options sends the answer once every question has one. As in Chat and Code,
// writing your own answer happens in the conversation's message box: while a
// question is open, what you send there answers it (see `typedAnswer`).

import { useState } from "react";
import { AskBand } from "../AskBand";
import { allowsText, mergeAskAnswers, type AskAnswers, type AskUserPrompt } from "../ask-user";
import { errorText } from "./kleioApi";

/**
 * What a message typed while a question is open answers: the first question
 * still without an answer that takes free text. Null when none does (the
 * message goes to the conversation as usual).
 */
export function typedAnswer(prompt: AskUserPrompt, text: string): AskAnswers | null {
  const q = prompt.questions.find(allowsText);
  return q && text.trim() ? { [q.id]: text.trim() } : null;
}

export function ChatAsk({
  prompt,
  who,
  onSend,
  onTypeInstead,
}: {
  prompt: AskUserPrompt;
  /** Who's asking, in a group chat ("Chef asks"); omitted in a 1:1 chat. */
  who?: string;
  /** Sends the complete answer; rejects when it didn't arrive. */
  onSend: (answers: AskAnswers) => Promise<void>;
  /** They started typing their own answer: focus the message box, seeded. */
  onTypeInstead: (seed?: string) => void;
}): React.ReactElement {
  const [answers, setAnswers] = useState<AskAnswers>({});
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(delta: AskAnswers): Promise<void> {
    const merged = mergeAskAnswers(answers, delta, prompt.questions);
    setAnswers(merged.answers);
    if (!merged.complete) return;
    setSent(true);
    setError(null);
    try {
      await onSend(merged.answers);
    } catch (e) {
      // Not delivered: let them pick again.
      setSent(false);
      setError(errorText(e));
    }
  }

  return (
    <div className="kleio-ask">
      {who && <p className="kleio-ask-who">{who} asks</p>}
      <AskBand
        prompt={prompt}
        answers={answers}
        sent={sent}
        onAnswer={(delta) => void answer(delta)}
        onTypeInstead={(_id, seed) => onTypeInstead(seed)}
      />
      {!sent && prompt.questions.some(allowsText) && (
        <p className="kleio-ask-hint">Or type your own answer below.</p>
      )}
      {error && (
        <p className="kleio-error" role="alert">
          Couldn't send your answer: {error}
        </p>
      )}
    </div>
  );
}
