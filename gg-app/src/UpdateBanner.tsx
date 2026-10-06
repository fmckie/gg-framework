import { Badge } from "./Badge";
import type { UpdateInfo } from "./update";

/**
 * The full-width row at the bottom of the window while an update waits, as in
 * Ken's GG Coder: clicking it downloads and installs the update, then restarts
 * the app. Meanwhile the row is the download's progress bar. App.tsx shows it
 * under the home screen, Kleio's pages and the chats alike.
 */
export function UpdateBanner({ update }: { update: UpdateInfo }): React.ReactElement | null {
  if (update.phase === "available")
    return (
      <button
        type="button"
        className="update-banner"
        title={`Update to ${update.version ?? "the new version"} — installs and restarts Kleio`}
        onClick={() => void update.install()}
      >
        <span className="update-banner-dot" />
        Kleio just got an update!
        <Badge>Install</Badge>
      </button>
    );
  if (update.phase === "installing") {
    const pct = update.progress ?? 0;
    // Same .update-banner box (padding/font) as the available state, so
    // banner → progress bar swaps content with zero layout shift. The fill
    // is absolutely positioned; only the centered percentage is in flow.
    return (
      <div
        className="update-banner update-banner-busy update-banner-progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Downloading update"
      >
        <span className="update-banner-fill" style={{ width: `${pct}%` }} />
        <span className="update-banner-pct">{`${pct}%`}</span>
      </div>
    );
  }
  return null;
}
