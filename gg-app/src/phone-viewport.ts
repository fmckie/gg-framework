// kleio: the iPhone's keyboard.
//
// The keyboard covers the bottom of the web view instead of shrinking it, and
// iOS then scrolls the whole page up to bring the focused field into view —
// which pushed the app's header under the status bar. Instead, the app is
// sized to the visible area above the keyboard (`--app-height`, read by
// kleio-phone.css) and the page is held at the top, so the composer simply
// rides up with the keyboard like Messages.
//
// Two classes on <html> describe what covers the bottom of the screen:
//   - `bottom-covered`: anything does (even the slim bar shown above a
//     hardware keyboard), so the home-indicator gap is not needed;
//   - `keyboard-open`: the on-screen keyboard is up, where Return adds a line.

/** Taller than rounding noise, shorter than the bar above a hardware keyboard. */
const COVERED_MIN_PX = 30;
/** Taller than any accessory bar, shorter than any on-screen keyboard. */
const KEYBOARD_MIN_PX = 120;

/** Whether anything covers the bottom of the screen. */
export function bottomCovered(layoutHeight: number, visibleHeight: number): boolean {
  return layoutHeight - visibleHeight > COVERED_MIN_PX;
}

/** Whether the visible area is short enough that the on-screen keyboard is up. */
export function keyboardOpen(layoutHeight: number, visibleHeight: number): boolean {
  return layoutHeight - visibleHeight > KEYBOARD_MIN_PX;
}

/** Whether the iPhone's on-screen keyboard is up right now. */
export function onScreenKeyboardUp(doc: Document = document): boolean {
  return doc.documentElement.classList.contains("keyboard-open");
}

/** Start tracking the visible area. Returns a function that stops it. */
export function trackVisualViewport(win: Window = window): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  const root = win.document.documentElement;
  const apply = (): void => {
    root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
    root.classList.toggle("bottom-covered", bottomCovered(win.innerHeight, vv.height));
    root.classList.toggle("keyboard-open", keyboardOpen(win.innerHeight, vv.height));
    // Undo iOS scrolling the page to reveal the focused field: the app is
    // already sized so the field is above the keyboard.
    if (win.scrollY !== 0 || win.scrollX !== 0) win.scrollTo(0, 0);
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  win.addEventListener("scroll", apply);
  apply();
  return () => {
    vv.removeEventListener("resize", apply);
    vv.removeEventListener("scroll", apply);
    win.removeEventListener("scroll", apply);
  };
}
