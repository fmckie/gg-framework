import { useEffect, useRef } from "react";
import type { SubAgentLine } from "../SubAgentFeed";
import { CAST, POSE_URLS } from "./cast";
import { createFloor, rng, type Floor, type FloorOptions, type LaneAgent } from "./floor";
import { agentTypeOf, godOf } from "./gods";
import { rowState } from "./OlympusRows";
import { createSim, type SimHost } from "./sim";
import { toolFamilyOf } from "./tool-family";
import "./olympus-lane.css";

/** A turn's subagents, as the transcript holds them. */
export interface LaneGroup {
  readonly agents: readonly SubAgentLine[];
  readonly aborted?: boolean;
}

/**
 * The records the lane is given: every agent this window saw at work, as its
 * god, reading as its row does. A resumed chat's rows kept no start time, so
 * they summon nobody.
 */
export function laneAgents(groups: readonly LaneGroup[]): LaneAgent[] {
  const agents: LaneAgent[] = [];
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent.startedAt === undefined) continue;
      agents.push({
        key: agent.toolCallId,
        god: godOf(agentTypeOf(agent)).id,
        look: rowState(agent, group.aborted === true).look,
        family: toolFamilyOf(agent.activities[agent.activities.length - 1]),
        tools: agent.toolUseCount,
      });
    }
  }
  return agents;
}

/** For tests and previews: a clock, dice and measures of their own. */
export interface LaneStage extends Pick<FloorOptions, "width" | "measure" | "reduced"> {
  readonly host?: SimHost;
  readonly seed?: number;
  readonly onFloor?: (floor: Floor | null) => void;
}

interface Props {
  groups: readonly LaneGroup[];
  stage?: LaneStage;
}

/**
 * The lane over the composer on the desktop: the frame, the stylobate and the
 * antae, and the engine that stands the gods on it. Everything on it is also in
 * the transcript's rows, so all of it is hidden from assistive technology.
 */
export function OlympusLane({ groups, stage }: Props): React.ReactElement {
  const laneRef = useRef<HTMLDivElement>(null);
  const floorRef = useRef<Floor | null>(null);
  // The stage is read once, as the lane is built.
  const stageRef = useRef(stage);

  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const { host, seed, onFloor, width, measure, reduced } = stageRef.current ?? {};
    const sim = createSim(host);
    const floor = createFloor(lane, {
      sim,
      cast: CAST,
      poses: POSE_URLS,
      random: rng(seed ?? (Math.random() * 2 ** 32) >>> 0),
      width,
      measure,
      reduced,
    });
    floorRef.current = floor;
    onFloor?.(floor);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => floor.resize());
    observer?.observe(lane);
    // The names are measured as they land; once the carved face is in, measure them again.
    document.fonts
      ?.load('10.5px "Bungee"')
      .then(() => floor.remeasure())
      .catch(() => {});
    return () => {
      observer?.disconnect();
      floor.dispose();
      sim.stop();
      floorRef.current = null;
      onFloor?.(null);
    };
  }, []);

  useEffect(() => {
    floorRef.current?.sync(laneAgents(groups));
  }, [groups]);

  return (
    <div className="oly-lane is-shut" ref={laneRef} aria-hidden="true">
      <div className="oly-gods" />
      <div className="oly-stylobate">
        <svg className="oly-marble" preserveAspectRatio="none">
          <filter
            id="oly-marble-grain"
            x="0"
            y="0"
            width="100%"
            height="100%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence type="fractalNoise" baseFrequency="0.004 0.11" numOctaves="4" seed="9" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.42  0 0 0 0 0.38  0 0 0 0 0.36  -2.6 0 0 0 1.45"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#oly-marble-grain)" opacity="0.3" />
        </svg>
        <div className="oly-names" />
      </div>
      <span className="oly-anta is-l" />
      <span className="oly-anta is-r" />
    </div>
  );
}
