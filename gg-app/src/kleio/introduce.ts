/**
 * "Introduce yourself" (Setup's Brain card) opens a new chat with Kleio on this
 * prompt. She asks a few short questions and saves the answers with her own
 * `remember` and `set_jiwa` tools, so nothing new is wired for it.
 *
 * The transcript shows only `INTRODUCE_LABEL`, as a chip (`submitText`), and
 * `prompt-labels.ts` maps the prompt's opening back to it when the chat is
 * reopened, which also keeps it out of the ↑ history.
 */
export const INTRODUCE_LABEL = "Introduce yourself";

/** The prompt's fixed opening, which `prompt-labels.ts` recognises. */
export const INTRODUCE_PREFIX = "Introduce yourself, then get to know me.";

export const INTRODUCE_PROMPT = [
  INTRODUCE_PREFIX,
  "Ask me a few short questions, one at a time, and wait for each answer:",
  "what to call me, what I do and what I'm working on, and how I'd like you to work with me",
  "(how long and how formal your answers should be, and anything you should always or never do).",
  "As I answer, save what's worth keeping: facts about me with remember, and how I want you to",
  "act with set_jiwa. If I skip a question, move on. At the end, tell me in a sentence or two",
  "what you saved, and that I can change it in Brain.",
].join(" ");
