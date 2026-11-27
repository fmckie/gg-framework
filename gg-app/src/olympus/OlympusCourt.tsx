import { useEffect, useRef } from "react";
import { CAST, CROWN_URLS, FRAME_URLS, POSE_URLS } from "./cast";
import {
  createCourtyard,
  type CourtAgent,
  type CourtOptions,
  type Courtyard,
  type HearthState,
} from "./courtyard";
import { createSim, windowHost, type SimHost } from "./sim";
import "./olympus-lane.css";
import "./olympus-court.css";

// For tests and previews: a clock and measures of their own.
export interface CourtStage extends Pick<CourtOptions, "width" | "reduced" | "fidget"> {
  readonly host?: SimHost;
  readonly onCourt?: (court: Courtyard | null) => void;
}

export interface CourtProps {
  agents: readonly CourtAgent[];
  hearth: HearthState;
  // The worker that did most of a finished stretch: its god is given the laurel.
  laurel?: string | null;
  // The worker whose row the pointer is on: its god's name is marked.
  marked?: string | null;
  // The worker whose god the pointer is on, or nobody.
  onHover?: (key: string | null) => void;
  stage?: CourtStage;
}

// The courtyard over a goal's Workers rows on the desktop: the frame, and the
// engine that builds the stage in it and keeps a god for each worker. It only
// repeats the rows under it, so all of it is hidden from assistive technology.
export function OlympusCourt({
  agents,
  hearth,
  laurel = null,
  marked = null,
  onHover,
  stage,
}: CourtProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const courtRef = useRef<Courtyard | null>(null);
  // The stage is read once, as the courtyard is built.
  const stageRef = useRef(stage);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const { host = windowHost(), onCourt, width, reduced, fidget } = stageRef.current ?? {};
    const sim = createSim(host);
    const court = createCourtyard(root, {
      sim,
      cast: CAST,
      poses: POSE_URLS,
      frames: FRAME_URLS,
      crowns: CROWN_URLS,
      width,
      reduced,
      fidget,
      onHover: (key) => hoverRef.current?.(key),
    });
    courtRef.current = court;
    onCourt?.(court);
    // Only its width is the stage's to hear of: its height never changes.
    let seen = -1;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const now = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0);
            if (now === seen) return;
            seen = now;
            court.resize();
          });
    observer?.observe(root);
    return () => {
      observer?.disconnect();
      court.dispose();
      sim.stop();
      courtRef.current = null;
      onCourt?.(null);
    };
  }, []);

  useEffect(() => {
    courtRef.current?.sync(agents, hearth, laurel);
  }, [agents, hearth, laurel]);

  useEffect(() => {
    courtRef.current?.mark(marked);
  }, [marked]);

  return <div className="oly-court" ref={rootRef} aria-hidden="true" />;
}
