// Kleio Desktop only works through the Kleio host (the Mac mini). It never runs
// an engine on this Mac, so until it's paired, or when the host can't be
// reached, it shows one of these screens instead of the app. That keeps Kleio
// from ever falling back to GG Coder's local sessions, keys or settings.
//
// Over Kleio's link, a host it can't reach is explained in diagnoseLink's
// words (connectionDiagnosis.ts), and the gate tries again by itself: after
// 1, 2, 5 and 10 s, then every 30 s, while on screen, and at once when the
// network or the app comes back. A device the host turned away is asked to
// pair again instead.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPhone } from "../platform";
import { isKleioDown, type LinkHealth } from "./connectionDiagnosis";
import { activeLink, linkRetryMs, linkVerdict, rememberReached } from "./hostReach";
import type { LinkStatus } from "./kleioLink";
import { KleioMark } from "./KleioMark";
import { RemoteHostModal } from "./LazyRemoteHostModal";
import { useKleioRemote } from "./useKleioRemote";

type Reach = "checking" | "ok" | "down";

/** Over the link, what the gate knows of a host it can't reach. */
interface OverLink {
  link: LinkStatus;
  health: LinkHealth;
}

/** The `error` a host's JSON answer carries, if any. */
function errorOf(body: unknown): unknown {
  return typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
}

export function KleioGate({ children }: { children: ReactNode }): React.ReactElement {
  const { status, refresh } = useKleioRemote();
  const [reach, setReach] = useState<Reach>("checking");
  const [overLink, setOverLink] = useState<OverLink | null>(null);
  const [pairing, setPairing] = useState(false);
  // Failed checks in a row, for how soon the link's next one comes.
  const misses = useRef(0);
  const inFlight = useRef(false);
  const active = status?.active ?? null;
  const host = active?.host ?? null;
  const device = isPhone() ? "iPhone" : "Mac";

  // `quiet`: keep showing what's known while it checks again.
  const probe = useCallback(
    async (quiet = false) => {
      if (quiet && inFlight.current) return;
      inFlight.current = true;
      if (!quiet) setReach("checking");
      let health: LinkHealth = { state: "error", kleioDown: false };
      try {
        const r = await invoke<{ status: number; body?: unknown }>("kleio_api", {
          method: "GET",
          path: "/kleio/health",
        });
        if (r.status === 200) {
          misses.current = 0;
          if (host) rememberReached(host, Date.now());
          setOverLink(null);
          setReach("ok");
          return;
        }
        health = { state: "error", kleioDown: isKleioDown(r.status, errorOf(r.body)) };
      } catch {
        // Nothing came back.
      } finally {
        inFlight.current = false;
      }
      misses.current += 1;
      const link = await activeLink();
      setOverLink(link ? { link, health } : null);
      setReach("down");
    },
    [host],
  );

  useEffect(() => {
    if (active) void probe();
  }, [active, probe]);

  // Over the link, it tries again by itself while on screen, unless the host
  // turned this device away: then only pairing again helps.
  useEffect(() => {
    if (!active || reach !== "down" || !overLink || overLink.link.refusal) return;
    const again = (): void => {
      if (document.visibilityState !== "hidden") void probe(true);
    };
    const id = window.setTimeout(again, linkRetryMs(misses.current));
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [active, reach, overLink, probe]);

  // Once the app is up it stays up; a later drop is handled inside the app.
  if (active && reach === "ok") return <>{children}</>;

  let body: React.ReactElement;
  if (status === null || (active && reach === "checking")) {
    body = <p className="kleio-gate-text">Connecting…</p>;
  } else if (!active) {
    body = (
      <>
        <h1 className="kleio-gate-title">Connect to your host</h1>
        <p className="kleio-gate-text">
          Kleio runs on your host. Pair this {device} once and Kleio opens straight into your
          conversations, specialists and apps.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setPairing(true)}>
          {status.paired ? "Finish connecting" : "Pair with your host"}
        </button>
      </>
    );
  } else if (overLink) {
    const words = linkVerdict(overLink.link, overLink.health);
    body = (
      <>
        <h1 className="kleio-gate-title">{words.headline}</h1>
        <p className="kleio-gate-text">{words.detail}</p>
        <div className="kleio-gate-actions">
          {overLink.link.refusal ? (
            <button type="button" className="btn btn-primary" onClick={() => setPairing(true)}>
              Pair again
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => void probe()}>
                Try again
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPairing(true)}>
                Connection settings
              </button>
            </>
          )}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="kleio-gate-title">Can't reach your host</h1>
        <p className="kleio-gate-text">
          Make sure Tailscale is on, on this {device} and on the host, and that it is awake.
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
        <KleioMark small />
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
