// kleio: "kleio" is Kleio's own screen (Blobs, Groups, Apps).
export type EntryView = "home" | "projects" | "chats" | "motion" | "settings" | "kleio";

/** New windows always start at Home; workspace restore may replace this after boot. */
export function initialEntryView(_isSecondaryWindow: boolean): EntryView {
  return "home";
}
