// "Forget host…" and its confirm, in Settings → Connection's Host card and
// the ⌘⇧K pane (RemoteHostModal.tsx), so both ask the same way. Forgetting
// takes effect on the next launch: the host still lists this device until an
// admin revokes it.

import { useCallback, useState } from "react";
import { isPhone } from "../platform";
import { explainError, kleio } from "./useKleioRemote";

/** What forgetting does, said on the confirm step. */
export function forgetHint(): string {
  return isPhone()
    ? "Kleio disconnects the next time you open it. The host still lists this device until an admin revokes it."
    : "Sessions go back to running on this Mac after a restart. The host still lists this device until an admin revokes it.";
}

/**
 * Forget host…, then Keep or Forget host. `compact`: a settings card's small
 * buttons, else a modal's.
 */
export function ForgetHost({
  compact = false,
  onForgot,
}: {
  compact?: boolean;
  onForgot: () => Promise<void>;
}): React.ReactElement {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forget = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await kleio.forget();
      await onForgot();
    } catch (e) {
      setError(explainError(e));
    } finally {
      setBusy(false);
    }
  }, [onForgot]);

  const quiet = compact ? "btn btn-ghost btn-sm" : "btn";
  const strong = compact ? "btn btn-primary btn-sm" : "btn btn-primary";
  return (
    <>
      {error && (
        <p className={compact ? "conn-bad" : "modal-error"} role="alert">
          {error}
        </p>
      )}
      <div className={compact ? "conn-row conn-forget" : "modal-actions"}>
        {confirm ? (
          <>
            <span className={compact ? "conn-forget-hint" : "modal-hint kleio-inline-hint"}>
              {forgetHint()}
            </span>
            <button type="button" className={quiet} onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button type="button" className={strong} disabled={busy} onClick={() => void forget()}>
              Forget host
            </button>
          </>
        ) : (
          <button type="button" className={quiet} onClick={() => setConfirm(true)}>
            Forget host…
          </button>
        )}
      </div>
    </>
  );
}
