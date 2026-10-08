// Tag the document with the host OS so CSS can gate macOS-only window chrome
// (the Overlay title bar's traffic-light insets) without leaking that padding
// onto Windows/Linux, which keep native decorations. kleio: the iPhone build
// gets its own class — it has no window chrome at all, and its phone layout
// lives in kleio/kleio-phone.css under `html.platform-ios`.

export type PlatformClass =
  "platform-macos" | "platform-windows" | "platform-linux" | "platform-ios";

/**
 * Map an OS identifier to its document class. Accepts either a Tauri os name
 * (`macos`/`windows`/`linux`) or a raw `navigator.userAgent`/`platform` string.
 * Anything unrecognized falls back to `platform-linux` (native chrome), which
 * is the safe default for non-mac hosts.
 */
export function platformClass(os: string): PlatformClass {
  const s = os.toLowerCase();
  // Before the Mac check: an iPhone's user agent says "like Mac OS X".
  if (s === "ios" || s.includes("iphone") || s.includes("ipad")) {
    return "platform-ios";
  }
  if (s.includes("mac") || s.includes("darwin")) {
    return "platform-macos";
  }
  if (s.includes("win")) {
    return "platform-windows";
  }
  return "platform-linux";
}

/** Add the resolved `platform-*` class to <html> at boot. */
export function tagPlatform(doc: Document = document, nav: Navigator = navigator): PlatformClass {
  const source = nav.userAgent || nav.platform || "";
  const cls = platformClass(source);
  doc.documentElement.classList.add(cls);
  return cls;
}

/**
 * Native popup selects are reliable in WKWebView on macOS and iOS (on the
 * iPhone they open the system picker wheel). WebView2 and WebKitGTK have
 * shipped popup regressions where the list opens but cannot be selected, so
 * Windows/Linux use the in-webview accessible menu fallback.
 */
export function supportsNativeSelectPopup(doc: Document = document): boolean {
  const html = doc.documentElement.classList;
  return html.contains("platform-macos") || html.contains("platform-ios");
}

/**
 * Dictation (the composer mic button): the iPhone and the Mac, where the
 * webview's getUserMedia is wired to the system microphone permission. Hidden
 * on Windows/Linux, where it is untested.
 */
export function supportsDictation(doc: Document = document): boolean {
  const html = doc.documentElement.classList;
  return html.contains("platform-ios") || html.contains("platform-macos");
}

/** kleio: the iPhone build — one full-screen webview, touch only, no windows. */
export function isPhone(doc: Document = document): boolean {
  return doc.documentElement.classList.contains("platform-ios");
}
