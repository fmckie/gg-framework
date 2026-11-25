import { useEffect, useRef, useState } from "react";
import type { SubAgentLine } from "../SubAgentFeed";
import { CAST, CROWN_URLS, FRAME_URLS, POSE_URLS, START_URLS } from "./cast";
import { createFloor, rng, type Floor, type FloorOptions, type LaneAgent } from "./floor";
import { agentTypeOf, godOf } from "./gods";
import { SCENES, type SceneId } from "./mosaic";
import { clock, Rich, rowId, rowState, rowWords, useNow } from "./OlympusRows";
import { createSim, windowHost, type SimHost } from "./sim";
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

/** The record a god's card is filled from: the first with its key, as the lane takes it. */
export function cardAgent(
  groups: readonly LaneGroup[],
  key: string | null,
): { agent: SubAgentLine; aborted: boolean } | null {
  if (key === null) return null;
  for (const group of groups)
    for (const agent of group.agents)
      if (agent.startedAt !== undefined && agent.toolCallId === key)
        return { agent, aborted: group.aborted === true };
  return null;
}

/** A count of tokens, as the mockup's card has it: 22.1k. */
function tokens(usage: SubAgentLine["tokenUsage"]): string {
  // What it has read anew and written; what it re-read from the cache would swamp both.
  const n = usage ? usage.input + (usage.cacheWrite ?? 0) + usage.output : 0;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * What a card says: its agent's row over again (the god, its state, the task,
 * what it is doing now or how it ended), then its tokens, its tools and its time.
 */
function CardWords({
  agent,
  aborted,
}: {
  agent: SubAgentLine;
  aborted: boolean;
}): React.ReactElement {
  const now = useNow(agent.startedAt !== undefined && rowState(agent, aborted).live);
  const { look, word, god, task, activity, result, ms } = rowWords(agent, aborted, now);
  return (
    <>
      <p className="oly-card-head">
        <span className="oly-card-god">{god.name}</span>
        <span className={`oly-card-state is-${look}`}>
          {look === "done" && (
            <svg className="oly-card-tick" viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
          {word}
        </span>
      </p>
      {task && (
        <p className="oly-card-task">
          <Rich text={task} />
        </p>
      )}
      {activity?.lead && (
        <p className="oly-card-now">
          {activity.lead}
          {activity.subject && (
            <>
              {" "}
              <code>{activity.subject}</code>
            </>
          )}
        </p>
      )}
      {result && (
        <p className="oly-card-now">
          <Rich text={result} />
        </p>
      )}
      <dl className="oly-card-stats">
        <div>
          <dt>Tokens</dt>
          <dd>{tokens(agent.tokenUsage)}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{agent.toolUseCount}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{ms === undefined ? "\u2013" : clock(ms)}</dd>
        </div>
      </dl>
    </>
  );
}

// The floor's scenes take their turn across the whole window, from the temple:
// a lane is built anew for each chat, and no scene comes twice running.
let turn = 0;
const nextScene = (): SceneId => SCENES[turn++ % SCENES.length]!;

/** For tests and previews: a clock, dice, measures and scenes of their own. */
export interface LaneStage extends Pick<
  FloorOptions,
  "width" | "measure" | "reduced" | "scene" | "fidget" | "react" | "startle"
> {
  readonly host?: SimHost;
  readonly seed?: number;
  readonly onFloor?: (floor: Floor | null) => void;
}

interface Props {
  groups: readonly LaneGroup[];
  stage?: LaneStage;
}

/**
 * The lane over the composer on the desktop: the frame, the floor's canvas and
 * the tesserae's, the stylobate and the antae, and the engine that raises it,
 * lays its floor, sets the gods on it and walks them; and, before it, the card
 * the engine stands over one god at a time. The gods are a toolbar, each
 * described by its row in the transcript; a click on one at its work, or Enter
 * or Space on it, startles it. Everything else, the card included,
 * only repeats those rows, and is hidden from assistive technology.
 */
export function OlympusLane({ groups, stage }: Props): React.ReactElement {
  const laneRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardKey, setCardKey] = useState<string | null>(null);
  const floorRef = useRef<Floor | null>(null);
  // The stage is read once, as the lane is built.
  const stageRef = useRef(stage);

  useEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const {
      host = windowHost(),
      seed,
      onFloor,
      width,
      measure,
      reduced,
      scene = nextScene,
      fidget,
      react,
      startle,
    } = stageRef.current ?? {};
    const sim = createSim(host);
    const floor = createFloor(lane, {
      sim,
      cast: CAST,
      poses: POSE_URLS,
      frames: FRAME_URLS,
      fidget,
      crowns: CROWN_URLS,
      react,
      starts: START_URLS,
      startle,
      random: rng(seed ?? (Math.random() * 2 ** 32) >>> 0),
      width,
      measure,
      reduced,
      card: cardRef.current,
      onCard: setCardKey,
      describe: rowId,
      // The composer's text box, as the app marks it.
      away: () => document.querySelector<HTMLElement>("textarea[data-composer-input]"),
      timer: host,
      scene,
    });
    floorRef.current = floor;
    onFloor?.(floor);
    // Only its width is the floor's to hear of: its height is the floor's own doing.
    let seen = -1;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const width = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0);
            if (width === seen) return;
            seen = width;
            floor.resize();
          });
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

  const card = cardAgent(groups, cardKey);

  return (
    <>
      {/* Before the lane, so the lane still meets the activity line or the text box. */}
      <div className="oly-card-anchor" aria-hidden="true">
        <div className={`oly-card${card ? " is-shown" : ""}`} ref={cardRef}>
          {card && <CardWords agent={card.agent} aborted={card.aborted} />}
        </div>
      </div>
      <div className="oly-lane is-shut" ref={laneRef}>
        {/* The floor's mosaic, set as the lane opens and prised up as it shuts: the engine draws it. */}
        <canvas className="oly-mosaic" aria-hidden="true" />
        {/* The tesserae a god is set from and goes back to: the engine draws them, behind the gods. */}
        <canvas className="oly-fx" aria-hidden="true" />
        {/* The tesserae a waiting god's medallion is set from and scatters to, over the piers. */}
        <canvas className="oly-mfx" aria-hidden="true" />
        <div
          className="oly-gods"
          role="toolbar"
          aria-label="Subagents on the lane"
          aria-hidden="true"
        />
        <div className="oly-stylobate" aria-hidden="true">
          <svg className="oly-marble" preserveAspectRatio="none">
            <filter
              id="oly-marble-grain"
              x="0"
              y="0"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.004 0.11"
                numOctaves="4"
                seed="9"
              />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0.42  0 0 0 0 0.38  0 0 0 0 0.36  -2.6 0 0 0 1.45"
              />
            </filter>
            <rect width="100%" height="100%" filter="url(#oly-marble-grain)" opacity="0.3" />
          </svg>
          <div className="oly-names" />
        </div>
        <span className="oly-anta is-l" aria-hidden="true" />
        <span className="oly-anta is-r" aria-hidden="true" />
      </div>
    </>
  );
}
