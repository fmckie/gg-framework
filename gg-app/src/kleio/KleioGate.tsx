// Kleio Desktop only works through the Kleio host (the Mac mini). It never runs
// an engine on this Mac, so until it's paired, or when the host can't be
// reached, it shows one of these screens instead of the app. That keeps Kleio
// from ever falling back to GG Coder's local sessions, keys or settings.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AsciiLogo } from "../AsciiLogo";
import { RemoteHostModal } from "./LazyRemoteHostModal";
import { useKleioRemote } from "./useKleioRemote";

type Reach = "checking" | "ok" | "down";

export function KleioGate({ children }: { children: ReactNode }): React.ReactElement {
  const { status, refresh } = useKleioRemote();
  const [reach, setReach] = useState<Reach>("checking");
  const [pairing, setPairing] = useState(false);
  const active = status?.active ?? null;

  const probe = useCallback(async () => {
    setReach("checking");
    try {
      const r = await invoke<{ status: number }>("kleio_api", {
        method: "GET",
        path: "/kleio/health",
      });
      setReach(r.status === 200 ? "ok" : "down");
    } catch {
      setReach("down");
    }
  }, []);

  useEffect(() => {
    if (active) void probe();
  }, [active, probe]);

  // Once the app is up it stays up; a later drop is handled inside the app.
  if (active && reach === "ok") return <>{children}</>;

  let body: React.ReactElement;
  if (status === null || (active && reach === "checking")) {
    body = <p className="kleio-gate-text">Connecting…</p>;
  } else if (!active) {
    body = (
      <>
        <h1 className="kleio-gate-title">Connect to your Mac mini</h1>
        <p className="kleio-gate-text">
          Kleio runs on your Mac mini and talks to it over Tailscale. Pair this Mac once and Kleio
          opens straight into your conversations, Blobs and apps.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setPairing(true)}>
          {status.paired ? "Finish connecting" : "Pair with your Mac mini"}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="kleio-gate-title">Can't reach your Mac mini</h1>
        <p className="kleio-gate-text">
          Make sure Tailscale is on, on this Mac and on the Mac mini, and that the mini is awake.
        </p>
        <div className="kleio-gate-actions">
          <button type="button" className="btn btn-primary" onClick={() => void probe()}>
            Try again
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setPairing(true)}>
            Connection settings
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="kleio-gate">
      <div className="kleio-gate-drag" data-tauri-drag-region />
      <div className="kleio-gate-card" role="main">
        <AsciiLogo />
        {body}
      </div>
      {pairing && (
        <RemoteHostModal
          onClose={() => {
            setPairing(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
