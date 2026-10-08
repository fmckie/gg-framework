import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { error as logError, attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import { BriefPanel } from "./kleio/BriefPanel";
import { VoiceMode } from "./kleio/VoiceMode";
import { KleioGate } from "./kleio/KleioGate";
import { HostReachProvider } from "./kleio/hostReach";
// After App (App.css, glass.css): Kleio's crimson and white override Ken's tokens.
import "./kleio/kleio-theme.css";
// Kleio's own pages (Blobs, Groups, Apps, Connection), on Ken's glass system.
import "./kleio/kleio-pages.css";
// Last: the iPhone layout, scoped to html.platform-ios (inert on the desktop).
import "./kleio/kleio-phone.css";
import { ZoomController } from "./ZoomController";
import { TooltipLayer } from "./TooltipLayer";
import { WhatsNewModal } from "./WhatsNewModal";
// Experimental: webcam gaze → window focus. Disabled for now; re-enable by
// uncommenting this import + the <GazeController /> mount below (and the
// <GazeButton /> in App.tsx). The full implementation lives in src/gaze/.
// import { GazeController } from "./GazeController";
import { isPhone, tagPlatform } from "./platform";
import { trackVisualViewport } from "./phone-viewport";

// Release history belongs to the notes window, not every workspace's startup.
const WhatsNewWindow = lazy(() =>
  import("./WhatsNewWindow").then((module) => ({ default: module.WhatsNewWindow })),
);
// Mirror Rust-side logs into the devtools console, and forward uncaught
// webview errors into the shared log file so failures aren't invisible.
void attachConsole();
window.addEventListener("error", (e) => {
  void logError(`window.error: ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  void logError(`unhandledrejection: ${String(e.reason)}`);
});

// Tag <html> with the host OS class (platform-macos|windows|linux|ios) before
// the first render so CSS can gate the macOS-only traffic-light insets and the
// iPhone layout (kleio/kleio-phone.css).
tagPlatform();
// iPhone: size the app to the area above the keyboard (phone-viewport.ts).
if (isPhone()) trackVisualViewport();

// React render/effect failures land in the shared log file like window errors do.
function captureReactError(culprit: string, error: unknown, componentStack?: string): void {
  void logError(`${culprit}: ${String(error)}${componentStack ? `\n${componentStack}` : ""}`);
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
  onUncaughtError: (error, info) => captureReactError("react.uncaught", error, info.componentStack),
  onCaughtError: (error, info) => captureReactError("react.caught", error, info.componentStack),
  onRecoverableError: (error, info) =>
    captureReactError("react.recoverable", error, info.componentStack),
});

// The dedicated, screen-centered "What's new" window reuses this same entry with
// a `?whatsnew=1` flag (see Rust `open_whatsnew_window`). Render ONLY the notes
// for that window — no agent, no sidecar, no app shell.
if (new URLSearchParams(window.location.search).get("whatsnew") === "1") {
  // Mark the root so the stylesheet can make html/body transparent — the native
  // window is transparent (see Rust `open_whatsnew_window`) so the rounded card's
  // corners show through instead of sitting on a hard rectangular window edge.
  document.documentElement.classList.add("whatsnew-root");
  root.render(
    <Suspense fallback={null}>
      <WhatsNewWindow />
    </Suspense>,
  );
} else {
  // No StrictMode: its intentional double-invocation of effects and state
  // updaters double-registers the single Tauri `agent-event` listener and was
  // amplifying state-updater impurity. A desktop webview gains nothing from it.
  root.render(
    <>
      <KleioGate>
        {/* Keeps checking the Mac mini after the gate's launch check, so the
            home screen says Disconnected when Tailscale drops. */}
        <HostReachProvider>
          <App />
          {/* "Brief me" and "Talk to Kleio": over any screen, once connected to the Mac mini. */}
          <BriefPanel />
          <VoiceMode />
        </HostReachProvider>
      </KleioGate>
      <ZoomController />
      <TooltipLayer />
      <WhatsNewModal />
      {/* <GazeController /> */}
    </>,
  );
}
