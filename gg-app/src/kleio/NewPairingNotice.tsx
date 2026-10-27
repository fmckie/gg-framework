// "New device paired": an admin device's notice, over whatever screen is up
// (home, Kleio's pages, the pickers, the chats), of each device paired with its
// host since this device last looked, until someone dismisses it. Every pairing
// over the link needs an admin's Allow (docs/adr/0003); this is how the other
// admins hear of it, and how an admin hears of a pairing it didn't mean. As
// with Signal's and Delta Chat's notices after pairing, it is hard to miss: it
// stays until Got it. The host's push alert says the same where push is set up.
//
// What it has announced is kept per host in localStorage, so a device is
// announced once on this device, and Got it in one window clears the others.
// The first time it looks at a host, the devices already paired count as seen:
// only pairings from then on are news. It looks on mount and when the window
// comes back (focus, or the iPhone app back in front), at most once a minute,
// and again when Review devices closes, as a device revoked there drops off.
//
// App.tsx mounts it in each of its views under one key, so React keeps a single
// instance across them: going from a chat to home neither looks again nor
// announces it again.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ShieldWarningIcon } from "@phosphor-icons/react";
import { shortHost } from "./host-name";
import { RemoteHostModal } from "./LazyRemoteHostModal";
import { relTime } from "./relTime";
import { kleio, type ActiveRemote, type RecentPairing } from "./useKleioRemote";

/** localStorage: host name → the ids of the devices announced for it. */
export const SEEN_PAIRINGS_KEY = "kleio.seenPairings";
/** The soonest it looks again when the window comes back. */
export const PAIRINGS_RECHECK_MS = 60_000;
/** The most devices it names; any more are counted. */
const NAMED_MAX = 3;

function readStore(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(SEEN_PAIRINGS_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const store: Record<string, string[]> = {};
    for (const [host, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        store[host] = (ids as unknown[]).filter((id): id is string => typeof id === "string");
      }
    }
    return store;
  } catch {
    return {};
  }
}

/** The ids of the devices announced for `host`; null before its first look. */
function seenFor(host: string): Set<string> | null {
  const ids = readStore()[host];
  return ids === undefined ? null : new Set(ids);
}

function storeSeen(host: string, ids: Set<string>): void {
  const store = { ...readStore(), [host]: [...ids].sort() };
  const sorted = Object.fromEntries(
    Object.entries(store).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  try {
    localStorage.setItem(SEEN_PAIRINGS_KEY, JSON.stringify(sorted));
  } catch {
    // Storage full or unavailable: it can't remember, so it may say it again.
  }
}

/** What has been announced for `host`, now that `list` is its recent
 *  pairings. On the first look they all count as seen. A device that has left
 *  the list (revoked, or paired over a week ago) is forgotten: it can't come
 *  back, as pairing a device again gives it a new id. */
function settle(host: string, list: RecentPairing[]): Set<string> {
  const listed = new Set(list.map((p) => p.deviceId));
  const seen = seenFor(host);
  if (seen === null) {
    storeSeen(host, listed);
    return listed;
  }
  const kept = new Set([...seen].filter((id) => listed.has(id)));
  if (kept.size !== seen.size) storeSeen(host, kept);
  return kept;
}

/** "iPhone was paired with mac-mini-1 3 min ago." */
function pairedLine(p: RecentPairing, host: string, at: number): string {
  const when = at - Date.parse(p.created) < 60_000 ? "just now" : relTime(p.created, at);
  return `${p.label} was paired with ${host}${p.admin ? " as an admin" : ""} ${when}.`;
}

interface Looked {
  host: string;
  /** The host's recent pairings, newest first. */
  list: RecentPairing[];
  seen: Set<string>;
  /** When it looked: what "3 min ago" is measured from. */
  at: number;
}

export function NewPairingNotice({
  active,
  now = Date.now,
}: {
  /** This window's host (App's `kleioRemote`). Only an admin device looks. */
  active: ActiveRemote | null;
  /** The clock, for tests. */
  now?: () => number;
}): React.ReactElement {
  const host = active?.admin ? active.host : null;
  const [looked, setLooked] = useState<Looked | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const lookedAt = useRef<number | null>(null);
  const looks = useRef(0);
  const titleId = useId();

  const look = useCallback(
    async (force: boolean): Promise<void> => {
      if (host === null) return;
      const at = now();
      if (!force && lookedAt.current !== null && at - lookedAt.current < PAIRINGS_RECHECK_MS) {
        return;
      }
      lookedAt.current = at;
      const mine = ++looks.current;
      let list: RecentPairing[];
      try {
        list = await kleio.recentPairings();
      } catch {
        // Offline, or no longer an admin: nothing to say until the next look.
        return;
      }
      // A later look (for another host, say) has the last word.
      if (mine !== looks.current) return;
      setLooked({ host, list, seen: settle(host, list), at });
    },
    [host, now],
  );

  useEffect(() => {
    if (host === null) return;
    void look(true);
    const again = (): void => {
      if (document.visibilityState !== "hidden") void look(false);
    };
    // Got it in another window changed what has been seen.
    const synced = (e: StorageEvent): void => {
      if (e.key !== null && e.key !== SEEN_PAIRINGS_KEY) return;
      setLooked((cur) => (cur ? { ...cur, seen: seenFor(cur.host) ?? cur.seen } : cur));
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    window.addEventListener("storage", synced);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("storage", synced);
    };
  }, [host, look]);

  const shown = looked !== null && looked.host === host ? looked : null;
  const unseen = shown ? shown.list.filter((p) => !shown.seen.has(p.deviceId)) : [];
  const named = unseen.slice(0, NAMED_MAX);
  const more = unseen.length - named.length;
  const hostName = shown ? shortHost(shown.host) : "";
  const title = unseen.length === 1 ? "New device paired" : "New devices paired";

  const gotIt = (): void => {
    if (!shown) return;
    const seen = seenFor(shown.host) ?? new Set<string>();
    for (const p of unseen) seen.add(p.deviceId);
    storeSeen(shown.host, seen);
    setLooked({ ...shown, seen });
  };

  return (
    <>
      {/* Mounted for the notice's whole life, as a live region speaks only
          what changes in it after it exists. No times in it, so a later look
          that only moves "3 min ago" doesn't say it all again. */}
      <div className="sr-only" role="status">
        {unseen.length > 0
          ? `${title} with ${hostName}: ${unseen.map((p) => p.label).join(", ")}.`
          : ""}
      </div>
      {shown && unseen.length > 0 && (
        <section className="toast pairing-notice" aria-labelledby={titleId}>
          <ShieldWarningIcon
            className="pairing-notice-icon"
            size={20}
            weight="duotone"
            aria-hidden="true"
          />
          <div className="pairing-notice-main">
            <h2 id={titleId} className="pairing-notice-title">
              {title}
            </h2>
            {named.map((p) => (
              <p key={p.deviceId} className="pairing-notice-text">
                {pairedLine(p, hostName, shown.at)}
              </p>
            ))}
            {more > 0 && <p className="pairing-notice-text">{`And ${more} more.`}</p>}
            <div className="pairing-notice-actions">
              <span className="pairing-notice-ask">Not one of yours?</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setReviewing(true)}
              >
                Review devices
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm pairing-notice-done"
                onClick={gotIt}
              >
                Got it
              </button>
            </div>
          </div>
        </section>
      )}
      {reviewing && (
        <RemoteHostModal
          initialTab="devices"
          onClose={() => {
            setReviewing(false);
            void look(true);
          }}
        />
      )}
    </>
  );
}
