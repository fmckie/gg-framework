// "Forget host…" and its confirm, in Settings → Connection's Host card and
// the ⌘⇧K pane (RemoteHostModal.tsx), so both ask the same way. Forgetting
// asks the host to remove this device first (`kleio_forget`), then forgets
// the pairing here whatever the host said, and a toast says what that was.
// Here, it takes effect on the next launch.

import { useCallback, useState } from "react";
import { isPhone } from "../platform";
import { toast, type ToastTone } from "../toast";
import { explainError, kleio, type Forgot } from "./useKleioRemote";

/** This device, in the words shown. */
function device(): string {
  return isPhone() ? "iPhone" : "Mac";
}

/** What forgetting does, said on the confirm step. */
export function forgetHint(): string {
  const d = device();
  const asks = `Kleio asks the host to remove this ${d}, then forgets the host here.`;
  const unreached = `If the host can't be reached, it's forgotten here only, and the host lists this ${d} until an admin revokes it.`;
  return isPhone()
    ? `${asks} ${unreached}`
    : `${asks} Sessions go back to running on this Mac after a restart. ${unreached}`;
}

/** What Forget host says once it's done, from what the host said. `sticky`:
 *  it stays until dismissed, as the host still lists this device. */
export function forgotWords(
  forgot: Forgot,
): { message: string; tone: ToastTone; sticky: boolean } | null {
  const d = device();
  switch (forgot.onHost) {
    case "removed":
      return { message: `The host removed this ${d}.`, tone: "success", sticky: false };
    case "refused":
      return {
        message: `Forgot the host here. The host turned this ${d}'s token away (HTTP 401), so it may have been revoked already. If the host still lists this ${d}, an admin can revoke it.`,
        tone: "warning",
        sticky: true,
      };
    case "notRemoved":
      return {
        message: `Forgot the host here only: ${forgot.reason}. The host lists this ${d} until an admin revokes it.`,
        tone: "warning",
        sticky: true,
      };
    case "notPaired":
      return null;
  }
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
      const words = forgotWords(await kleio.forget());
      if (words?.sticky) toast(words.message, words.tone, 0);
      else if (words) toast(words.message, words.tone);
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
            <button
              type="button"
              className={quiet}
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep
            </button>
            <button type="button" className={strong} disabled={busy} onClick={() => void forget()}>
              {busy ? "Forgetting…" : "Forget host"}
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
