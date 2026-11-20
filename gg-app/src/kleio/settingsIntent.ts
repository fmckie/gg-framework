// A one-shot note from one Settings page to the page it opens: Overview's Fix on
// the Host row asks Connection to open its steps, and "Keep it on" asks it to
// bring Always on into view; its Fix on Apps and on Tools asks each for what
// needs fixing. Held in memory only and read once. A note nothing read soon is
// dropped, so opening the tab any other way finds none.

export type SettingsIntent = "connection-fix" | "connection-always-on" | "apps-fix" | "tools-fix";

/** A note nobody read this soon is stale: the page it was for never opened. */
export const INTENT_KEPT_MS = 10_000;

let left: { intent: SettingsIntent; at: number } | null = null;

export function leaveSettingsIntent(intent: SettingsIntent, now: number = Date.now()): void {
  left = { intent, at: now };
}

/** The note, if one was just left. Reading it takes it away. */
export function takeSettingsIntent(now: number = Date.now()): SettingsIntent | null {
  const note = left;
  left = null;
  return note !== null && now - note.at <= INTENT_KEPT_MS ? note.intent : null;
}
