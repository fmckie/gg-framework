// A Settings → Setup step's status, as the badge in its card's header shows it.
// Colour is never the only cue: every mark is a word.

import { Badge } from "../Badge";
import { theme } from "../theme";

export type StepMark =
  | "done"
  | "env"
  | "needed"
  | "unreachable"
  | "optional"
  | "checking"
  | "unknown"
  | "working"
  | "unavailable";

const MARKS: Record<StepMark, { text: string; color?: string }> = {
  done: { text: "Done", color: theme.success },
  // A key set on the host itself: done, just not changeable from here.
  env: { text: "Set on host", color: theme.success },
  needed: { text: "Needed", color: theme.warning },
  unreachable: { text: "Can't reach", color: theme.error },
  // An optional step not taken: it sits under Setup's "Optional" label.
  optional: { text: "Not set up" },
  checking: { text: "Checking…" },
  // The host couldn't say (an older host, or it didn't answer).
  unknown: { text: "Can't check" },
  // The host is doing the step now (dictation's download). Neutral: Kleio's
  // accent is nearly its error red, and the card's own bar shows the motion.
  working: { text: "In progress" },
  // The host can't do this step at all (no speech engine for its chip).
  unavailable: { text: "Not available" },
};

export function StepBadge({ mark }: { mark: StepMark }): React.ReactElement {
  const { text, color } = MARKS[mark];
  return <Badge color={color}>{text}</Badge>;
}
