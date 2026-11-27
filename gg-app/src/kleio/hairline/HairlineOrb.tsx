// The desktop's voice orb: the Hairline instrument in WebGL2, or the same
// instrument drawn flat when WebGL2 can't run.

import { useEffect, useRef, useState } from "react";
import type { OrbLevels, OrbMood } from "../VoiceOrb";
import { createHairline, type Hairline } from "./engine";
import { HairlineFallback } from "./HairlineFallback";

export interface HairlineOrbProps {
  readonly mood: OrbMood;
  /** Read once a frame while a voice shows; the flat instrument never reads it. */
  readonly levels?: () => OrbLevels;
  readonly reducedMotion?: boolean;
  readonly className?: string;
}

export function HairlineOrb({
  mood,
  levels,
  reducedMotion = false,
  className,
}: HairlineOrbProps): React.ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Hairline | null>(null);
  const read = useRef(levels);
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    read.current = levels;
  }, [levels]);

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    // Told to the log, not the person: the flat instrument still shows every mood.
    const fail = (reason: unknown): void => {
      console.warn("[voice] the orb can't use WebGL2; drawing it flat:", reason);
      engine.current = null;
      setFlat(true);
    };
    try {
      engine.current = createHairline(box, fail, () => read.current?.());
    } catch (e) {
      fail(e);
    }
    return () => {
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setState(mood, reducedMotion);
  }, [mood, reducedMotion]);

  return (
    <div ref={host} className={className} aria-hidden="true">
      {flat ? <HairlineFallback mood={mood} /> : null}
    </div>
  );
}
