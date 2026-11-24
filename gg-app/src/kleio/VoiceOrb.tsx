// Kleio's voice orb. On the desktop it is the Hairline instrument (hairline/);
// the iPhone keeps the sphere (VoiceOrbClassic.tsx) until it has its own design.

import { lazy } from "react";
import { isPhone } from "../platform";
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
  /** Read every frame; a null level is imitated from the mood. */
  readonly levels?: () => OrbLevels;
  /** The orb's ramp, darkest to lightest (four colours). */
  readonly palette?: Palette;
  readonly reducedMotion?: boolean;
  readonly className?: string;
}

/** Darkest to lightest: shadow, deep, mid, glow. */
export type Palette = readonly [string, string, string, string];

// Its own chunk: the desktop's orb never needs @react-three/fiber.
const VoiceOrbClassic = lazy(() =>
  import("./VoiceOrbClassic").then((m) => ({ default: m.VoiceOrbClassic })),
);

export function VoiceOrb(props: VoiceOrbProps): React.ReactElement {
  if (isPhone()) return <VoiceOrbClassic {...props} />;
  // The instrument plays fixed phrases for now; it doesn't read `levels` yet.
  return (
    <HairlineOrb
      mood={props.mood}
      reducedMotion={props.reducedMotion}
      className={props.className}
    />
  );
}
