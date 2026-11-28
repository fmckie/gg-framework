// Kleio's voice orb: the Hairline instrument (hairline/), on the desktop and
// the iPhone alike.

import { HairlineOrb } from "./hairline/HairlineOrb";

/** What she's doing: shapes the orb's motion. */
export type OrbMood =
  "idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended";

/** How loud she (out) and you (in) are, 0–1; null where it isn't measured. */
export interface OrbLevels {
  readonly out: number | null;
  readonly in: number | null;
}

export interface VoiceOrbProps {
  readonly mood: OrbMood;
  /** Read every frame a voice shows; a null level isn't measured. */
  readonly levels?: () => OrbLevels;
  /** The orb's ramp, darkest to lightest (four colours). */
  readonly palette?: Palette;
  readonly reducedMotion?: boolean;
  readonly className?: string;
}

/** Darkest to lightest: shadow, deep, mid, glow. */
export type Palette = readonly [string, string, string, string];

export function VoiceOrb(props: VoiceOrbProps): React.ReactElement {
  return (
    <HairlineOrb
      mood={props.mood}
      levels={props.levels}
      reducedMotion={props.reducedMotion}
      className={props.className}
    />
  );
}
