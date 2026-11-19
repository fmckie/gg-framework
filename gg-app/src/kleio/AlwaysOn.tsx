// Always on: whether the host stays awake, so Kleio can answer any time. The
// card is on the phone's Setup page and the desktop's Connection page; the
// desktop's Overview says the same in its Host row. Advice about the host
// itself, so it never counts as a step or a fault.

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
  const state = kind === undefined ? "checking" : (kind?.alwaysOn?.state ?? "unknown");
  const steps = kind && state === "may_sleep" ? stayOnSteps(kind, name) : [];
  const badge =
    state === "checking" ? (
      <StepBadge mark="checking" />
    ) : state === "yes" ? (
      <Badge color={theme.success}>Yes</Badge>
    ) : state === "may_sleep" ? (
      <Badge color={theme.warning}>May sleep</Badge>
    ) : state === "laptop" ? (
      <Badge>Laptop</Badge>
    ) : (
      <StepBadge mark="unknown" />
    );
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
  return (
    <SettingsCard
      title="Always on"
      badge={badge}
      description="Kleio runs on your host, so it answers only while the host is awake."
    >
      <p className="settings-desc">{line}</p>
      {steps.length > 0 && (
        <ol className="conn-steps">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </SettingsCard>
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
