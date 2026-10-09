// The app-wide keyboard shortcuts, as one pure lookup so they can be tested.
// App.tsx listens once, on every screen (its listener is set up before any of
// its early returns, so the pickers, Home and Settings are covered too): no
// other component may handle these keys, or one press would act twice.
//
//   Cmd/Ctrl+N          new project window
//   Cmd/Ctrl+`          next window (reading order); with Shift, the previous one
//   Cmd/Ctrl+Shift+A    arrange all windows into a grid
//   Cmd/Ctrl+Shift+K    the remote host pane
//   Cmd/Ctrl+Shift+L    specialists and group chats (remote mode only, like the button)
//   Cmd/Ctrl+Shift+B    talk to Kleio, or hear the briefing (like the Home button)
//
// On macOS the system's own "Move focus to next window" may take Cmd+` before
// the page sees it; it cycles the same windows, in the system's order.

export type WindowShortcut =
  | { readonly kind: "new-window" }
  | { readonly kind: "cycle-windows"; readonly offset: 1 | -1 }
  | { readonly kind: "arrange-windows" }
  | { readonly kind: "remote-host" }
  | { readonly kind: "specialists" }
  | { readonly kind: "talk" };

export type ShortcutKeys = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/** What a key press does, or null for a key that isn't a shortcut. */
export function windowShortcut(
  e: ShortcutKeys,
  { kleioActive }: { readonly kleioActive: boolean },
): WindowShortcut | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  // The physical key: Shift turns ` into ~ on a US keyboard.
  if (e.code === "Backquote") return { kind: "cycle-windows", offset: e.shiftKey ? -1 : 1 };
  // With Shift held the key is upper case ("B"), so compare it lowered.
  const key = e.key.toLowerCase();
  if (!e.shiftKey) return key === "n" ? { kind: "new-window" } : null;
  switch (key) {
    case "a":
      return { kind: "arrange-windows" };
    case "k":
      return { kind: "remote-host" };
    case "l":
      return kleioActive ? { kind: "specialists" } : null;
    case "b":
      return { kind: "talk" };
    default:
      return null;
  }
}
