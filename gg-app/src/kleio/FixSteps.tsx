// One step of "How to fix it" on Settings → Connection: its words, a page to
// open, or a command to run on the host with a button that copies it. Shared by
// the phone's verdict card (ConnectionPage.tsx) and the desktop's path
// (ConnectionPath.tsx).

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { openUrl } from "../agent";
import { toast } from "../toast";
import type { FixStep } from "./connectionDiagnosis";

export function FixStepText({ step }: { step: FixStep }): React.ReactElement {
  const { link, command } = step;
  return (
    <>
      {step.text}
      {link && (
        <button
          type="button"
          className="btn btn-ghost btn-sm conn-fix-link"
          onClick={() => void openUrl(link.url)}
        >
          {link.label}
        </button>
      )}
      {command && <CommandLine command={command} />}
    </>
  );
}

/** A command to run on the Mac mini, with a button that copies it. */
function CommandLine({ command }: { command: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <span className="conn-command">
      {/* Wraps only between words: a break inside `-k` or a name would misread. */}
      <code>
        {command.split(" ").map((word, i) => (
          <span key={`${i}:${word}`}>
            {i > 0 && " "}
            <span className="conn-command-word">{word}</span>
          </span>
        ))}
      </code>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          navigator.clipboard.writeText(command).then(
            () => setCopied(true),
            () => toast("Couldn't copy. Select the command and copy it instead.", "error"),
          );
        }}
      >
        {copied ? (
          <CheckIcon size={13} weight="bold" aria-hidden="true" />
        ) : (
          <CopyIcon size={13} weight="bold" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
