// Always on: whether the host stays awake, so Kleio can answer any time. The
// card is on the phone's Setup page; the desktop's Connection page has the same
// words as a section, and its Overview says them in the Host row. Advice about
// the host itself, so it never counts as a step or a fault.

import { useEffect, useRef } from "react";
import { Badge } from "../Badge";
import { theme } from "../theme";
import { SettingsCard } from "../settings-section";
import type { HostKind } from "./kleioApi";
import { StepBadge } from "./StepBadge";

/** Stops a Linux desktop host from sleeping; `unmask` with the same targets undoes it. */
const LINUX_NO_SLEEP =
  "sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target";

/** The host's sleep settings to change, by its OS: only the ones that are off. */
export function stayOnSteps(kind: HostKind, name: string): React.ReactNode[] {
  const reasons = kind.alwaysOn?.reasons ?? [];
  if (kind.os === "darwin") {
    const steps: React.ReactNode[] = [];
    if (reasons.includes("sleeps_on_ac"))
      steps.push("Turn on \u201cPrevent automatic sleeping when the display is off\u201d.");
    if (reasons.includes("no_autorestart"))
      steps.push(
        "Turn on \u201cStart up automatically after a power failure\u201d. Where it shows \u201cStart up when power is connected\u201d instead, choose \u201cAfter power failure\u201d.",
      );
    if (reasons.includes("no_wake_for_network"))
      steps.push("Turn on \u201cWake for network access\u201d.");
    if (steps.length === 0) return [];
    return [
      "Choose Apple menu \u2192 System Settings, then click Energy in the sidebar. You may need to scroll down.",
      ...steps,
    ];
  }
  if (kind.os === "win32" && reasons.includes("sleeps_on_ac"))
    return [
      "Choose Start \u2192 Settings \u2192 System \u2192 Power & battery \u2192 Screen, sleep, & hibernate timeouts.",
      "Set \u201cMake my device sleep after\u201d to Never for when it's plugged in. On Windows 10 the page is called Power & sleep.",
    ];
  if (kind.os === "linux" && reasons.includes("sleep_not_masked"))
    return [
      <>
        In a terminal on {name}, run <code className="conn-code">{LINUX_NO_SLEEP}</code>
      </>,
      "To undo it later, run the same command with unmask instead of mask.",
    ];
  return [];
}

type State = "checking" | "yes" | "may_sleep" | "laptop" | "unknown";

const DESCRIPTION = "Kleio runs on your host, so it answers only while the host is awake.";

/** The state in a word: the card's badge, and the name of the section's mark. */
const STATE_WORD: Record<State, string> = {
  checking: "Checking\u2026",
  yes: "Yes",
  may_sleep: "May sleep",
  laptop: "Laptop",
  unknown: "Can't check",
};

/** What Always on says of a host: its state, its one line, and the steps when it may sleep. */
function alwaysOnWords(
  kind: HostKind | null | undefined,
  name: string,
): { state: State; line: string; steps: React.ReactNode[] } {
  const state: State = kind === undefined ? "checking" : (kind?.alwaysOn?.state ?? "unknown");
  const steps = kind && state === "may_sleep" ? stayOnSteps(kind, name) : [];
  const line =
    state === "checking"
      ? `Checking whether ${name} stays on\u2026`
      : state === "yes"
        ? `Yes. ${name} stays on, so Kleio can answer any time.`
        : state === "may_sleep"
          ? `${name === "your host" ? "Your host" : name} may fall asleep.${steps.length > 0 ? ` To keep it on, do this on ${name} itself:` : ""}`
          : state === "laptop"
            ? `Kleio works while ${name} is open and awake.`
            : `Couldn't check whether ${name} stays on.`;
  return { state, line, steps };
}

function Steps({ steps }: { steps: React.ReactNode[] }): React.ReactElement | null {
  if (steps.length === 0) return null;
  return (
    <ol className="conn-steps">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

/**
 * Always on: whether the host stays awake, so Kleio can answer any time. A
 * laptop gets one line and no steps; a computer set to sleep gets the steps
 * for its OS, done on the host itself. `kind` undefined: still asking.
 */
export function AlwaysOnCard({
  kind,
  name,
}: {
  kind: HostKind | null | undefined;
  name: string;
}): React.ReactElement {
  const { state, line, steps } = alwaysOnWords(kind, name);
  const badge =
    state === "checking" ? (
      <StepBadge mark="checking" />
    ) : state === "yes" ? (
      <Badge color={theme.success}>{STATE_WORD.yes}</Badge>
    ) : state === "may_sleep" ? (
      <Badge color={theme.warning}>{STATE_WORD.may_sleep}</Badge>
    ) : state === "laptop" ? (
      <Badge>{STATE_WORD.laptop}</Badge>
    ) : (
      <StepBadge mark="unknown" />
    );
  return (
    <SettingsCard title="Always on" badge={badge} description={DESCRIPTION}>
      <p className="settings-desc">{line}</p>
      <Steps steps={steps} />
    </SettingsCard>
  );
}

/**
 * The same words as a section of the desktop's Connection page: no badge, but
 * a mark named for the state, beside the line. `arrive`: Overview's "Keep it
 * on" opened the page for this, so it comes into view with focus on its
 * heading.
 */
export function AlwaysOnSection({
  kind,
  name,
  arrive = false,
}: {
  kind: HostKind | null | undefined;
  name: string;
  arrive?: boolean;
}): React.ReactElement {
  const { state, line, steps } = alwaysOnWords(kind, name);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!arrive) return;
    heading.current?.scrollIntoView?.({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, [arrive]);
  return (
    <section className="settings-card" aria-label="Always on">
      <div className="settings-section-head">
        <h3 className="settings-section-title" ref={heading} tabIndex={-1}>
          Always on
        </h3>
        <p className="settings-desc">{DESCRIPTION}</p>
      </div>
      <p className="settings-desc cx-state">
        <span
          className={`cx-mark is-${state}`}
          role="img"
          aria-label={STATE_WORD[state]}
          title={STATE_WORD[state]}
        />
        {line}
      </p>
      <Steps steps={steps} />
    </section>
  );
}

/**
 * Overview's Host row while connected: its first line, what follows
 * "Connected", and whether to offer "Keep it on". Only a host that says it
 * stays on is called always on. `kind` undefined: still asking.
 */
export function hostRowWords(
  kind: HostKind | null | undefined,
  name: string,
): { benefit: string; status: string; keepOn: boolean } {
  const state = kind === undefined ? "checking" : (kind?.alwaysOn?.state ?? "unknown");
  const lives = `Lives on ${name}`;
  if (state === "yes")
    return { benefit: `${lives}, always on`, status: "Connected", keepOn: false };
  if (state === "may_sleep")
    return { benefit: lives, status: "Connected \u00b7 may fall asleep", keepOn: true };
  if (state === "laptop")
    return {
      benefit: lives,
      status: `Connected \u00b7 works while ${name} is open and awake`,
      keepOn: false,
    };
  if (state === "unknown")
    return {
      benefit: lives,
      status: "Connected \u00b7 couldn't check whether it stays on",
      keepOn: false,
    };
  return { benefit: lives, status: "Connected", keepOn: false };
}
