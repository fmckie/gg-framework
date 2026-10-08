// The composer's golden check, in code sessions on the Mac and the iPhone: one
// tap sends `@muse check`, exactly as if it were typed and sent, and leaves
// whatever is in the draft alone.

import { CheckIcon } from "@phosphor-icons/react";
import { HELPER_CHECK } from "./helper-mention";

export function HelperCheckButton({
  busy,
  onCheck,
}: {
  /** Muse is already answering: the sidecar refuses a second question until it's done. */
  busy: boolean;
  onCheck: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="icon-circle helper-check"
      aria-label="Ask Muse to check the work"
      title={busy ? "Muse is answering…" : `Send “${HELPER_CHECK}”`}
      disabled={busy}
      // Keep the keyboard up and the caret in the draft: the check doesn't touch it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onCheck}
    >
      <CheckIcon size={15} weight="bold" aria-hidden="true" />
    </button>
  );
}
