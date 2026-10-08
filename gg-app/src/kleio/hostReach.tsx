// Whether the Mac mini answers right now, for the home screen's status pill.
// KleioGate checks once at launch; this keeps checking while the app is open,
// so a dropped Tailscale (or a Mac mini that went to sleep) reads as
// Disconnected instead of a "Connected" left over from launch. One missed
// check can be a blip (a slow reply, the network changing), so it takes two in
// a row; this device going offline is certain, so that shows at once.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { hostHealth } from "./kleioApi";

/** How long one check waits: a Mac mini that dropped off Tailscale never answers. */
export const REACH_TIMEOUT_MS = 6_000;
/** How often it checks while the app is on screen. */
export const REACH_INTERVAL_MS = 10_000;
/** Missed checks in a row before it says Disconnected; one answer resets the count. */
const MISSES_TO_DISCONNECT = 2;

export type HostReach = "checking" | "connected" | "disconnected";

/** Outside the provider nothing has been checked, so nothing is claimed. */
const ReachContext = createContext<HostReach>("checking");

/**
 * Keeps checking the Mac mini: every few seconds while the app is on screen,
 * and straight away when it comes back to the front or the network returns.
 * Mounted inside KleioGate, which only opens the app once it has reached the
 * Mac mini, so it starts out connected.
 */
export function HostReachProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [reach, setReach] = useState<HostReach>("connected");

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    // Missed checks since the Mac mini last answered.
    let misses = 0;
    const check = async (): Promise<void> => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      // Any failure is a miss, a 502 included: that's Tailscale's proxy on the
      // Mac mini saying Kleio itself didn't answer.
      try {
        await hostHealth(REACH_TIMEOUT_MS);
        misses = 0;
        if (alive) setReach("connected");
      } catch {
        misses += 1;
        // Short of the threshold a miss changes nothing: it doesn't say
        // Disconnected yet, nor undo the Disconnected that going offline set.
        if (alive && misses >= MISSES_TO_DISCONNECT) setReach("disconnected");
      } finally {
        inFlight = false;
      }
    };
    const recheck = (): void => void check();
    // This device went offline: nothing can reach the Mac mini, so no waiting
    // for a second miss.
    const offline = (): void => setReach("disconnected");
    const id = window.setInterval(recheck, REACH_INTERVAL_MS);
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  return <ReachContext.Provider value={reach}>{children}</ReachContext.Provider>;
}

/**
 * Connected once the Mac mini answers; Disconnected after two missed checks in
 * a row, or as soon as this device goes offline.
 */
export function useHostReach(): HostReach {
  return useContext(ReachContext);
}
