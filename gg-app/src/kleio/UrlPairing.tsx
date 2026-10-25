// Pairing by the host's address: its https URL and a pair code from
// `kleio-host pair` (Rust: `kleio_pair`). The pairing pane shows these fields
// to a device that isn't paired; Settings → Connection keeps them under
// "Advanced: connect over your own network", for a host this device reaches
// over Tailscale, another VPN or its own network. A pairing takes effect on
// the next launch (RestartNotice), except an iPhone's first, which switches
// on in place.

import { useId, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { isPhone } from "../platform";

/** The host's URL, the pair code and this device's name, each with its label. */
export function UrlPairFields({
  baseUrl,
  code,
  label,
  onBaseUrl,
  onCode,
  onLabel,
  busy,
  initialFocus = false,
}: {
  baseUrl: string;
  code: string;
  label: string;
  onBaseUrl: (value: string) => void;
  /** Gets the code in capitals, as the host shows it. */
  onCode: (value: string) => void;
  onLabel: (value: string) => void;
  busy: boolean;
  /** The URL field takes the focus when its dialog opens. */
  initialFocus?: boolean;
}): React.ReactElement {
  const id = useId();
  return (
    <>
      <div>
        <label className="modal-label" htmlFor={`${id}-url`}>
          Host URL
        </label>
        <input
          id={`${id}-url`}
          className="modal-input"
          data-modal-initial-focus={initialFocus ? "" : undefined}
          placeholder="https://mac-mini-1.your-tailnet.ts.net:8443"
          value={baseUrl}
          onChange={(e) => onBaseUrl(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          required
        />
      </div>
      <div className="modal-row">
        <div>
          <label className="modal-label" htmlFor={`${id}-code`}>
            Pair code
          </label>
          <input
            id={`${id}-code`}
            className="modal-input kleio-code"
            placeholder="ABC-DEF"
            value={code}
            onChange={(e) => onCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={7}
            disabled={busy}
            required
          />
        </div>
        <div>
          <label className="modal-label" htmlFor={`${id}-label`}>
            This device&apos;s name
          </label>
          <input
            id={`${id}-label`}
            className="modal-input"
            placeholder={isPhone() ? "iPhone" : "Laptop"}
            value={label}
            onChange={(e) => onLabel(e.target.value)}
            maxLength={64}
            disabled={busy}
          />
        </div>
      </div>
    </>
  );
}

/** A pairing or a forget that applies on the next launch, with a way to get there. */
export function RestartNotice({ what }: { what: string }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  // A phone app cannot relaunch itself; the person closes and reopens it.
  if (isPhone()) {
    return (
      <div className="kleio-restart" role="status">
        <span>{what} Close Kleio and open it again to apply.</span>
      </div>
    );
  }
  return (
    <div className="kleio-restart" role="status">
      <span>{what} Restart Kleio to apply — every window comes back where it was.</span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void relaunch();
        }}
      >
        {busy ? "Restarting…" : "Restart now"}
      </button>
    </div>
  );
}
