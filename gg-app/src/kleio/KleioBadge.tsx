// "on mac-mini-1" pill in the titlebar strip. Only rendered when this window
// booted against a remote host; local mode shows nothing at all. Its dot goes
// red, with the reason on hover, while the link check says the host is silent:
// the state a chat's headline comes from (hostAway).

import { hostAway } from "./connectionDiagnosis";
import { useHostReachWords } from "./hostReach";
import type { ActiveRemote } from "./useKleioRemote";

export function KleioBadge({
  active,
  onClick,
}: {
  active: ActiveRemote | null;
  onClick: () => void;
}): React.ReactElement | null {
  const away = hostAway(useHostReachWords());
  if (!active) return null;
  const short = active.host.split(".")[0] ?? active.host;
  return (
    <button
      type="button"
      className={`kleio-badge${away ? " is-away" : ""}`}
      onClick={onClick}
      title={
        away
          ? away.detail
          : `Sessions run on ${active.host} as “${active.label}”${active.admin ? " (admin)" : ""} · ⌘⇧K`
      }
      aria-label={
        away ? `Kleio host ${active.host}: ${away.label}` : `Connected to Kleio host ${active.host}`
      }
    >
      <span className="kleio-badge-dot" aria-hidden="true" />
      on {short}
    </button>
  );
}
