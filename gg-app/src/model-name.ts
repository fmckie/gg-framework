import type { ModelOption } from "./agent";

/**
 * Resolve a model id to its friendly registry name for display (footer +
 * menus). The wire id (e.g. "gemini-3-flash") is an implementation detail —
 * users see the name (e.g. "Gemini 3.5 Flash"). Falls back to the id when the
 * model isn't in the list yet, and to an ellipsis when there's no id at all.
 */
export function modelDisplayName(
  models: readonly ModelOption[],
  id: string | undefined | null,
): string {
  if (!id) return "\u2026";
  return models.find((m) => m.id === id)?.name ?? id;
}

/**
 * A model name short enough for the iPhone's one-line footer. Claude names lead
 * with the brand ("Claude Opus 4.5"), and the family after it identifies the
 * model on its own, so the brand goes: "Opus 4.5". The raw id fallback gets the
 * same treatment ("claude-opus-4-5" to "opus-4-5"). Names whose first word is
 * the model itself ("Gemini 3 Pro", "GPT-5 Codex") and Claude names that lead
 * with a version ("Claude 3.5 Sonnet") stay whole.
 */
export function compactModelName(name: string): string {
  return name.replace(/^claude[\s-]+(?=[a-z])/i, "");
}
