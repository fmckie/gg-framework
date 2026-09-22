// "on mac-mini-1" pill in the titlebar strip. Only rendered when this window
// booted against a remote host; local mode shows nothing at all.

import type { ActiveRemote } from "./useKleioRemote";

export function KleioBadge({
  active,
  onClick,
}: {
  active: ActiveRemote | null;
  onClick: () => void;
}): React.ReactElement | null {
  if (!active) return null;
  const short = active.host.split(".")[0] ?? active.host;
  return (
    <button
      type="button"
      className="kleio-badge"
      onClick={onClick}
      title={`Sessions run on ${active.host} as “${active.label}”${active.admin ? " (admin)" : ""} · ⌘⇧K`}
      aria-label={`Connected to Kleio host ${active.host}`}
    >
      <span className="kleio-badge-dot" aria-hidden="true" />
      on {short}
    </button>
  );
}
