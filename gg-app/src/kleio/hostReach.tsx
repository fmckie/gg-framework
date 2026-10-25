// Whether the host answers right now, for the home screen's status pill and
// Setup. KleioGate checks once at launch; this keeps checking while the app is
// open, so a dropped Tailscale (or a host that went to sleep) reads as
// Disconnected instead of a "Connected" left over from launch. One missed
// check can be a blip (a slow reply, the network changing), so it takes two in
// a row; this device going offline is certain, so that shows at once.
//
// Over Kleio's link it also says why, in diagnoseLink's words
// (useHostReachWords). What the link knows for certain shows at once: the host
// turned this device away, a relay answered and the host didn't, no relay
// answered, a relay turned this version away, or the host's link answered for
// a stopped Kleio. While the link redials after one miss, it says
// Reconnecting. After a miss it checks again sooner: after 1, 2, 5 and 10 s,
// then every 30 s, while on screen; at once when the network or the app comes
// back; never in the background.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { localStorageOrNull } from "../app-entry-view";
import { isPhone } from "../platform";
import { diagnoseLink, isKleioDown, type Diagnosis, type LinkHealth } from "./connectionDiagnosis";
import { shortHost } from "./host-name";
import { getHostKind, hostHealth, KleioApiError, type HostKind } from "./kleioApi";
import { kleioLink, type LinkStatus } from "./kleioLink";

/** How long one check waits: a host that dropped off Tailscale never answers. */
export const REACH_TIMEOUT_MS = 6_000;
/** How often it checks while the app is on screen. */
export const REACH_INTERVAL_MS = 10_000;
/** Over the link, how soon it checks again after each miss in a row; then the last, every time. */
export const LINK_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** Missed checks in a row before it says Disconnected; one answer resets the count. */
const MISSES_TO_DISCONNECT = 2;

export type HostReach = "checking" | "connected" | "disconnected";

interface Reach {
  reach: HostReach;
  /** Over the link, why it isn't connected: diagnoseLink's verdict. */
  words: Diagnosis | null;
}

/** Outside the provider nothing has been checked, so nothing is claimed. */
const ReachContext = createContext<Reach>({ reach: "checking", words: null });

/** The host's OS and kind, kept between launches. */
const HOST_KIND_KEY = "kleio.hostKind";
/** When the host last answered, kept between launches. */
const LAST_REACHED_KEY = "kleio.lastReached";

/**
 * The host's OS and whether it's a laptop, as GET /kleio/host last said:
 * kept across launches, so the words are right while it can't be reached.
 */
export function rememberedHostKind(
  storage: Storage | null = localStorageOrNull(),
): HostKind | null {
  try {
    const raw = storage?.getItem(HOST_KIND_KEY);
    if (!raw) return null;
    const kept: unknown = JSON.parse(raw);
    if (
      typeof kept === "object" &&
      kept !== null &&
      "os" in kept &&
      "laptop" in kept &&
      typeof kept.os === "string" &&
      typeof kept.laptop === "boolean"
    )
      return { os: kept.os, laptop: kept.laptop };
  } catch {
    // Unreadable: as good as none.
  }
  return null;
}

/** Asks the host its OS and kind, and keeps the answer. An older host has no GET /kleio/host. */
async function askHostKind(storage: Storage | null = localStorageOrNull()): Promise<void> {
  try {
    storage?.setItem(HOST_KIND_KEY, JSON.stringify(await getHostKind()));
  } catch {
    // The words do without.
  }
}

/** Notes that `host` answered at `atMs`, so "Last reached" outlives this launch. */
export function rememberReached(
  host: string,
  atMs: number,
  storage: Storage | null = localStorageOrNull(),
): void {
  try {
    storage?.setItem(LAST_REACHED_KEY, JSON.stringify({ host, atMs }));
  } catch {
    // The words do without.
  }
}

/** When `host` last answered, as kept across launches; null if that isn't known. */
export function rememberedReached(
  host: string,
  storage: Storage | null = localStorageOrNull(),
): number | null {
  try {
    const raw = storage?.getItem(LAST_REACHED_KEY);
    if (!raw) return null;
    const kept: unknown = JSON.parse(raw);
    if (
      typeof kept === "object" &&
      kept !== null &&
      "host" in kept &&
      "atMs" in kept &&
      kept.host === host &&
      typeof kept.atMs === "number" &&
      Number.isFinite(kept.atMs)
    )
      return kept.atMs;
  } catch {
    // Unreadable: as good as none.
  }
  return null;
}

/** The link's status when this launch reaches the host over it; else null, as in a build without it. */
export async function activeLink(): Promise<LinkStatus | null> {
  try {
    const link = await kleioLink.status();
    return link.active ? link : null;
  } catch {
    return null;
  }
}

/** How soon to check again over the link after `misses` misses in a row. */
export function linkRetryMs(misses: number): number {
  const at = Math.min(Math.max(misses, 1), LINK_RETRY_MS.length) - 1;
  return LINK_RETRY_MS[at] ?? REACH_INTERVAL_MS;
}

/**
 * diagnoseLink's verdict on a failed check over the link, as this device sees
 * it now, with what's kept across launches: the host's OS and kind, and when
 * it last answered.
 */
export function linkVerdict(link: LinkStatus, health: LinkHealth): Diagnosis {
  const host = link.host ?? "";
  const kept = host ? rememberedReached(host) : null;
  const lastReachedMs = Math.max(link.lastReachedMs ?? 0, kept ?? 0) || null;
  return diagnoseLink({
    link: { ...link, lastReachedMs },
    health,
    host: rememberedHostKind(),
    hostLabel: host ? shortHost(host) : "your host",
    device: isPhone() ? "iPhone" : "Mac",
    online: navigator.onLine,
  });
}

/** Whether a failed check over the link is certain, not a blip: the link knows why. */
function certain(link: LinkStatus, health: LinkHealth): boolean {
  return (
    link.refusal !== null ||
    link.unreached !== null ||
    !link.running ||
    !navigator.onLine ||
    (health.state === "error" && health.kleioDown)
  );
}

/**
 * Keeps checking the host: every few seconds while the app is on screen, and
 * straight away when it comes back to the front or the network returns.
 * Mounted inside KleioGate, which only opens the app once it has reached the
 * host, so it starts out connected.
 */
export function HostReachProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, setState] = useState<Reach>({ reach: "connected", words: null });

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    // Missed checks since the host last answered.
    let misses = 0;
    let reach: HostReach = "connected";
    let timer: number | undefined;
    // Whether this launch reaches the host over the link, and the host's
    // name there: read at once, and again at each miss.
    let overLink = false;
    let linkHost: string | null = null;
    let askedHostKind = false;
    const set = (next: Reach): void => {
      reach = next.reach;
      if (alive) setState(next);
    };
    const noteLink = (link: LinkStatus | null): void => {
      overLink = link !== null;
      linkHost = link?.host ?? null;
    };
    const schedule = (ms: number): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(recheck, ms);
    };
    void activeLink().then((link) => {
      if (link && !overLink) noteLink(link);
    });

    const check = async (): Promise<void> => {
      // Hidden: nothing is scheduled until it's back on screen.
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      window.clearTimeout(timer);
      try {
        await hostHealth(REACH_TIMEOUT_MS);
        misses = 0;
        set({ reach: "connected", words: null });
        if (overLink && linkHost) {
          rememberReached(linkHost, Date.now());
          if (!askedHostKind) {
            askedHostKind = true;
            void askHostKind();
          }
        }
        schedule(REACH_INTERVAL_MS);
      } catch (e) {
        // Any failure is a miss, a 502 included: that's Tailscale's proxy on
        // the host, or the host's link, saying Kleio itself didn't answer.
        misses += 1;
        const link = await activeLink();
        if (!alive) return;
        noteLink(link);
        if (link) {
          const health: LinkHealth = {
            state: "error",
            kleioDown: e instanceof KleioApiError && isKleioDown(e.status, e.message),
          };
          const words = linkVerdict(link, health);
          // Once disconnected, the words keep up with what the link says.
          if (certain(link, health) || misses >= MISSES_TO_DISCONNECT || reach === "disconnected")
            set({ reach: "disconnected", words });
          else if (link.dialling) set({ reach: "checking", words });
          schedule(linkRetryMs(misses));
        } else {
          // Short of the threshold a miss changes nothing: it doesn't say
          // Disconnected yet, nor undo the Disconnected that going offline set.
          if (misses >= MISSES_TO_DISCONNECT) set({ reach: "disconnected", words: null });
          schedule(REACH_INTERVAL_MS);
        }
      } finally {
        inFlight = false;
      }
    };
    const recheck = (): void => void check();
    // This device went offline: nothing can reach the host, so no waiting
    // for a second miss. Over the link, its words say so.
    const offline = (): void => {
      set({ reach: "disconnected", words: null });
      if (!overLink) return;
      void activeLink().then((link) => {
        if (alive && link && reach === "disconnected" && !navigator.onLine)
          set({ reach, words: linkVerdict(link, { state: "error", kleioDown: false }) });
      });
    };
    schedule(REACH_INTERVAL_MS);
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  return <ReachContext.Provider value={state}>{children}</ReachContext.Provider>;
}

/**
 * Connected once the host answers; Disconnected after two missed checks in a
 * row, as soon as this device goes offline, or, over the link, as soon as the
 * link knows why. Checking while the link redials after a miss.
 */
export function useHostReach(): HostReach {
  return useContext(ReachContext).reach;
}

/** Over Kleio's link, why the host isn't connected (diagnoseLink's verdict); null otherwise. */
export function useHostReachWords(): Diagnosis | null {
  return useContext(ReachContext).words;
}
