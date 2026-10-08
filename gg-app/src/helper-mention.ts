// The composer's helper trigger. A draft that opens with `@muse` goes to the
// read-only helper (the sidecar's mentor run, see `sendKenPrompt`) instead of
// the coder, and that helper runs alongside a build. `@ken`, the old trigger,
// still works but is no longer advertised.

/** The trigger the composer advertises and the iPhone chip inserts. */
export const HELPER_MENTION = "@muse";

/** What the golden check button asks the helper, as typing `@muse check` would. */
export const HELPER_CHECK_QUESTION = "check";
/** The golden check button's message, as it shows in the transcript. */
export const HELPER_CHECK = `${HELPER_MENTION} ${HELPER_CHECK_QUESTION}`;

// The token at the start of a draft, after any leading whitespace. The word
// boundary keeps `@museum.ts` and `@kennedy.ts` file mentions.
const LEADING_TOKEN = /^(\s*)(@(?:muse|ken))\b/i;
// The token as an address: an optional colon, then the spaces after it.
const ADDRESS = /^@(?:muse|ken)\b:?\s*/i;

/** Whether the draft is addressed to the helper. */
export function addressesHelper(draft: string): boolean {
  return LEADING_TOKEN.test(draft);
}

/** A helper-addressed draft split around its token, for the input highlight. */
export interface HelperTokenParts {
  lead: string;
  /** As typed, so the highlight keeps the person's casing. */
  token: string;
  rest: string;
}

export function helperTokenParts(draft: string): HelperTokenParts | null {
  const match = LEADING_TOKEN.exec(draft);
  if (!match) return null;
  const lead = match[1] ?? "";
  const token = match[2] ?? "";
  return { lead, token, rest: draft.slice(lead.length + token.length) };
}

/**
 * The question in a helper-addressed draft, trimmed: `null` when the draft is
 * for the coder, "" when it names the helper but asks nothing yet.
 */
export function helperQuestion(draft: string): string | null {
  const trimmed = draft.trim();
  const match = ADDRESS.exec(trimmed);
  return match ? trimmed.slice(match[0].length).trim() : null;
}

/** Address a draft to the helper, keeping whatever is already typed. */
export function withHelperMention(draft: string): string {
  return addressesHelper(draft) ? draft : `${HELPER_MENTION} ${draft.trimStart()}`;
}

/** What the composer's round button does right now. */
export type ComposerButtonAction = "send" | "stop";

/**
 * Mid-run the round button stops the build, except for a question to the
 * helper: the helper runs alongside the build, so that draft can go now. On
 * the iPhone this is the only way to send mid-run, because Return adds a line.
 */
export function composerButtonAction(
  running: boolean,
  question: string | null,
): ComposerButtonAction {
  return running && !question ? "stop" : "send";
}
