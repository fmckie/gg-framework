// Settings → Steroids, on the desktop: one section that says its state in
// words. A local corpus of real repos the agent reads before it writes; the
// page shows the corpus and installs the `steroids` binary when it is missing.
// The phone keeps SteroidsModal as its page (settingsLayout.tsx); the re-probe,
// following installs, Install, the count's format and the README's address are
// repeated here until the iPhone slice.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import {
  getSteroidsStatus,
  installSteroids,
  onSteroidsChange,
  openUrl,
  type SteroidsStatus,
} from "../agent";
import { toast } from "../toast";

interface Props {
  /** Held by the screen, which draws the tab's dot from it. */
  status: SteroidsStatus | null;
  onStatus: (status: SteroidsStatus) => void;
}

const README_URL = "https://github.com/KenKaiii/agent-steroids#readme";

function count(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

type Kind = "good" | "next" | "bad" | "none";

// Not installed is optional and an empty corpus is a next step: only a fault is red.
function stateOf(status: SteroidsStatus): { kind: Kind; label: string; icon: React.ReactNode } {
  if (status.connected)
    return {
      kind: "good",
      label: "Connected",
      icon: <CheckCircleIcon size={16} weight="fill" aria-hidden="true" />,
    };
  if (status.installed && !status.error)
    return {
      kind: "next",
      label: "Empty corpus",
      icon: <CircleIcon size={16} weight="bold" aria-hidden="true" />,
    };
  if (status.installed)
    return {
      kind: "bad",
      label: "Broken",
      icon: <XCircleIcon size={16} weight="fill" aria-hidden="true" />,
    };
  return {
    kind: "none",
    label: "Not installed",
    icon: <CircleDashedIcon size={16} aria-hidden="true" />,
  };
}

function corpusOf(status: SteroidsStatus): string {
  return [
    status.version ? `v${status.version}` : "",
    status.repos === undefined ? "" : `${status.repos} repos`,
    status.documents === undefined ? "" : `${count(status.documents)} files`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function SteroidsPage({ status, onStatus }: Props): React.ReactElement {
  const id = useId();
  const [installing, setInstalling] = useState(false);
  const installRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef<HTMLParagraphElement>(null);
  // Install had keyboard focus when a new state replaced it: the state line takes it.
  const installHadFocus = useRef(false);

  const take = useCallback(
    (next: SteroidsStatus): void => {
      const install = installRef.current;
      if (next.installed && install && document.activeElement === install)
        installHadFocus.current = true;
      onStatus(next);
    },
    [onStatus],
  );

  // Probed again on opening, so an install done in a terminal shows without a
  // restart; and installs finished in any other window are followed.
  useEffect(() => {
    let live = true;
    void getSteroidsStatus().then((next) => {
      if (live) take(next);
    });
    const stop = onSteroidsChange(take);
    return () => {
      live = false;
      stop();
    };
  }, [take]);

  useEffect(() => {
    if (!status?.installed || !installHadFocus.current) return;
    installHadFocus.current = false;
    stateRef.current?.focus();
  }, [status]);

  async function install(): Promise<void> {
    if (installing) return;
    setInstalling(true);
    try {
      const next = await installSteroids();
      take(next);
      toast(`Steroids ${next.version ?? ""} installed.`, "success");
    } catch (e) {
      toast(`Install failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setInstalling(false);
    }
  }

  const state = status ? stateOf(status) : null;
  const corpus = status ? corpusOf(status) : "";

  return (
    <div className="sr-page">
      <section className="sr-lead" aria-labelledby={`${id}-status`}>
        <h2 className="st-label" id={`${id}-status`}>
          Status
        </h2>
        <p className="kl-voice-line">Lets your agent read current code from real repos first.</p>
        {/* One line for every state, so a change of state is read out. */}
        <p
          className={`settings-status is-${state?.kind ?? "checking"}`}
          role="status"
          tabIndex={-1}
          ref={stateRef}
        >
          {state ? (
            <>
              {state.icon}
              <span className="sr-state">{state.label}</span>
              {corpus && <span className="sr-corpus">{corpus}</span>}
            </>
          ) : (
            "Checking…"
          )}
        </p>
        {status?.installed &&
          !status.connected &&
          (status.error ? (
            <p className="kl-error sr-detail">{status.error}</p>
          ) : (
            <p className="kl-quiet-note sr-detail">
              No repos yet. Ask the agent: “curate a Steroids corpus for this project”.
            </p>
          ))}
        {status && !status.installed && (
          <button
            ref={installRef}
            type="button"
            className={`modal-btn sr-install${installing ? "" : " primary"}`}
            // While it installs it keeps focus and ignores presses.
            aria-disabled={installing || undefined}
            onClick={() => void install()}
          >
            {installing ? "Installing…" : "Install Steroids"}
          </button>
        )}
        <p className="kl-caption">It&apos;s free and works offline.</p>
        <p className="sr-readme">
          <a
            className="ab-link"
            href={README_URL}
            onClick={(e) => {
              e.preventDefault();
              void openUrl(README_URL);
            }}
          >
            Read the README
            <ArrowUpRightIcon
              className="ab-link-arrow"
              size={13}
              weight="bold"
              aria-hidden="true"
            />{" "}
            <span className="sr-only">(opens in your browser)</span>
          </a>
        </p>
      </section>
    </div>
  );
}
