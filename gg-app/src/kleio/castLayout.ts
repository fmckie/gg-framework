// The Cast shelf's rules: how many shelves a number of specialists stands on,
// where each one stands, and what each is doing; then the form's week and a
// group's room. Pure, so the layout is the same on every roster and testable
// without a page.

import { agentRowState } from "./AgentRow";
import { describeSchedule, formatClock, formatWhen, formatWhenShort, nextRun } from "./blobFormat";
import { lookOf, type BlobFaceKind, type BlobShape } from "./blobLook";
import { OUTCOME_LABEL, outcomeTone } from "./groupOutcome";
import type { Blob, GroupMessage, GroupTurnOutcome, Schedule } from "./kleioApi";

/** One character large, one shelf, two shelves, or three and more. */
export type CastTier = "solo" | "one" | "two" | "crowd";

export interface CastLayout {
  tier: CastTier;
  /** How many stand on each shelf, back to front. */
  rows: number[];
  /** Places across the widest shelf. */
  cols: number;
  /** Specialists below the shelves that show without scrolling. */
  hidden: number;
}

/** Shelves that show at once; more than these and the shelves scroll. */
export const SHELVES_SHOWN = 3;

/** One shelf up to 9, two from 10 to 24, three from 25; past 36 they scroll. */
export function castLayout(count: number): CastLayout {
  if (count <= 0) return { tier: "one", rows: [], cols: 1, hidden: 0 };
  // Solo keeps a second place: where the next specialist will stand.
  if (count === 1) return { tier: "solo", rows: [1], cols: 2, hidden: 0 };
  if (count <= 9) return { tier: "one", rows: [count], cols: count, hidden: 0 };
  const shelves = count <= 24 ? 2 : Math.max(3, Math.ceil(count / 12));
  const per = Math.ceil(count / shelves);
  const rows: number[] = Array.from({ length: Math.floor(count / per) }, () => per);
  if (count % per) rows.push(count % per);
  return {
    tier: shelves === 2 ? "two" : "crowd",
    rows,
    cols: per,
    hidden: rows.slice(SHELVES_SHOWN).reduce((a, b) => a + b, 0),
  };
}

/** What a specialist is doing, as the shelf draws it. */
export type CastKind = "working" | "failed" | "paused" | "oncall" | "scheduled";

/** The same reading as its row's state (AgentRow.tsx), as a kind. */
export function castKind(blob: Blob): CastKind {
  if (blob.running) return "working";
  if (blob.lastRun?.endedAt && blob.lastRun.outcome === "error") return "failed";
  if (nextRun(blob.schedules)) return "scheduled";
  return blob.schedules.length > 0 ? "paused" : "oncall";
}

/** How far each body sits above the foot of its box, so feet meet the shelf (%). */
const FOOT: Record<BlobShape, number> = {
  orb: 8,
  mochi: 11,
  drop: 6,
  puff: 9,
  pill: 20,
  cube: 9,
  ghost: 8,
  star: 9,
};

export const castFoot = (shape: BlobShape): number => FOOT[shape];

/** The faces BlobAvatar draws with open eyes; the others have nothing to blink. */
const BLINKING: readonly BlobFaceKind[] = ["calm", "curious", "focused", "surprised", "cheeky"];

/** Blink clocks in each set (kleio-cast.css): lively on one shelf, calm on more. */
export const BLINK_CLOCKS = 8;
/** Seconds between one working character's bounce and the next one's. */
export const BOUNCE_STEP = 0.38;
/** More than this many and a next run is "Tue 07:30", not "Next tomorrow 07:30". */
export const FULL_LABELS_UP_TO = 7;

export interface CastActor {
  blob: Blob;
  kind: CastKind;
  /** Its state in full, as its row words it. */
  state: string;
  /** Under its name on the shelf: `state`, or a shorter next run on a full shelf. */
  label: string;
  foot: number;
  /** Idle with open eyes: its blink clock, "b1"–"b8" or "c1"–"c8". */
  clock?: string;
  /** Working: where its bounce starts, in seconds, so no two bounce together. */
  beat?: number;
  /** Its shelf, counted from the back. */
  row: number;
  /** Its place along the widest shelf; halves where a short shelf is centred. */
  col: number;
  /** On the front shelf, the one the profile's pointer can reach. */
  front: boolean;
}

export interface Cast {
  layout: CastLayout;
  actors: CastActor[];
}

/** Everyone on the shelves, in order, with where they stand and how they move. */
export function castOf(blobs: readonly Blob[], now: Date = new Date()): Cast {
  const layout = castLayout(blobs.length);
  const compact = blobs.length > FULL_LABELS_UP_TO;
  const clocks = layout.tier === "solo" || layout.tier === "one" ? "b" : "c";
  const actors: CastActor[] = [];
  // Working and blinking characters are counted apart, so beats and clocks go
  // round in order and neighbours never share one.
  let working = 0;
  let blinking = 0;
  let index = 0;
  layout.rows.forEach((size, row) => {
    const offset = layout.tier === "solo" ? 0 : (layout.cols - size) / 2;
    for (let place = 0; place < size; place++) {
      const blob = blobs[index++];
      if (!blob) continue;
      const kind = castKind(blob);
      const look = lookOf(blob);
      const state = agentRowState(blob, now).text;
      const next = kind === "scheduled" ? nextRun(blob.schedules) : null;
      const blinks = (kind === "scheduled" || kind === "oncall") && BLINKING.includes(look.face);
      actors.push({
        blob,
        kind,
        state,
        label: compact && next ? formatWhenShort(next, now) : state,
        foot: FOOT[look.shape],
        ...(blinks ? { clock: `${clocks}${(blinking++ % BLINK_CLOCKS) + 1}` } : {}),
        ...(kind === "working" ? { beat: -BOUNCE_STEP * working++ } : {}),
        row,
        col: place + offset,
        front: row === layout.rows.length - 1,
      });
    }
  });
  return { layout, actors };
}

// ─── the form's week: where each schedule falls, Monday to Sunday ───────────

/** One schedule on one day, or under the week when it has no day. */
export interface WeekMark {
  schedule: Schedule;
  /** Its time on that day ("18:30"); with no day, when it runs in words. */
  text: string;
}

export interface CastWeek {
  /** Monday first; `day` counts from Sunday = 0, as schedules do. */
  days: { day: number; marks: WeekMark[] }[];
  /** No day this week: a repeat, or a one-off in another week. */
  loose: WeekMark[];
}

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const DAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** A schedule's name on a mark under its own day, where the day goes without
 *  saying: "Thursday top-up" under Thursday reads "Top-up". */
export function markName(label: string, day: number): string {
  const name = DAY_FULL[day]?.toLowerCase();
  if (!name || !label.toLowerCase().startsWith(`${name} `)) return label;
  const rest = label.slice(name.length).trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : label;
}

/** The schedules laid out over this week: daily on all seven days, weekly on
 *  its days, a one-off on its day if that is this week (the viewer's zone). */
export function castWeek(schedules: readonly Schedule[], now: Date = new Date()): CastWeek {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const days = WEEK_ORDER.map((day) => ({ day, marks: [] as WeekMark[] }));
  const loose: WeekMark[] = [];
  const put = (day: number, schedule: Schedule, text: string): void => {
    days.find((d) => d.day === day)?.marks.push({ schedule, text });
  };
  for (const s of schedules) {
    const time = s.time ?? "--:--";
    const at = s.kind === "once" && s.at ? new Date(s.at) : null;
    if (s.kind === "daily") WEEK_ORDER.forEach((day) => put(day, s, time));
    else if (s.kind === "weekly" && s.days?.length) s.days.forEach((day) => put(day, s, time));
    else if (at && at >= monday && at < nextMonday) put(at.getDay(), s, formatClock(s.at ?? ""));
    else if (at) loose.push({ schedule: s, text: formatWhen(s.at ?? "", now) });
    else loose.push({ schedule: s, text: describeSchedule(s) });
  }
  for (const d of days) d.marks.sort((a, b) => a.text.localeCompare(b.text));
  return { days, loose };
}

/** The schedule the form opens on: the next one to run, else the first. */
export function soonest(schedules: readonly Schedule[]): Schedule | null {
  const next = nextRun(schedules);
  return schedules.find((s) => s.enabled && s.nextRunAt === next) ?? schedules[0] ?? null;
}

/** What the profile offers beyond the chat and the form: run a schedule now
 *  (first, when that schedule's last run failed) or turn the schedules back on. */
export type CastOffer =
  { kind: "run"; schedule: Schedule; lead: boolean } | { kind: "resume"; schedules: Schedule[] };

/** The host runs a schedule, not a specialist: a failure offers the schedule
 *  that failed, anything else the next one due. Nothing while it works. */
export function castOffer(blob: Blob): CastOffer | null {
  const kind = castKind(blob);
  if (kind === "working" || kind === "oncall") return null;
  if (kind === "paused") {
    const off = blob.schedules.filter((s) => !s.enabled);
    return off.length > 0 ? { kind: "resume", schedules: off } : null;
  }
  const failed =
    kind === "failed" ? blob.schedules.find((s) => s.id === blob.lastRun?.scheduleId) : undefined;
  const schedule = failed ?? soonest(blob.schedules);
  return schedule ? { kind: "run", schedule, lead: Boolean(failed) } : null;
}

// ─── the room: a group's members on one shelf ───────────────────────────────

/** From this many members they stand closer: smaller figures, shorter labels. */
export const ROOM_CROWD_FROM = 6;

/** Replying, stopped by an error, skipped, sat this turn out, or nothing to mark. */
export type RoomTone = "live" | "failed" | "warn" | "idle" | "plain";

export interface RoomMember {
  blob: Blob;
  tone: RoomTone;
  /** Under its name: replying, how its last turn ended, or its job. */
  state: string;
  /** Why its last turn ended as it did ("took over 2 min"); "" for none. */
  reason: string;
  foot: number;
  /** Not replying, with open eyes: its blink clock, as on the shelf. */
  clock?: string;
  /** It handed the turn to the one replying. */
  from: boolean;
}

export interface Room {
  crowd: boolean;
  members: RoomMember[];
  /** The handoff under way, as places along the shelf. */
  handoff: { from: number; to: number } | null;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The members a text @mentions, read as the host reads it (kleio-host
 *  groups.ts): the name, then no letter, digit or underscore; longest first. */
function mentioned(text: string, members: readonly Blob[]): string[] {
  let rest = text;
  const out: string[] = [];
  for (const b of [...members].sort((a, c) => c.name.length - a.name.length)) {
    const re = new RegExp(`@${escapeRegExp(b.name)}(?![\\p{L}\\p{N}_])`, "giu");
    if (rest.search(re) < 0) continue;
    out.push(b.id);
    rest = rest.replace(re, (m) => " ".repeat(m.length));
  }
  return out;
}

/** The host doesn't say who handed over to whom, so it is read off the
 *  conversation: the newest message is a member's, and it @mentions one who is
 *  now replying. A message of yours hands over to nobody. */
function handoffOf(
  members: readonly Blob[],
  typing: readonly string[],
  messages: readonly GroupMessage[],
): Room["handoff"] {
  const last = messages[messages.length - 1];
  const from = last ? members.findIndex((b) => b.id === last.author) : -1;
  if (!last || from < 0) return null;
  const others = members.filter((b) => b.id !== last.author);
  const next = mentioned(last.text, others).find((id) => typing.includes(id));
  const to = members.findIndex((b) => b.id === next);
  return to < 0 ? null : { from, to };
}

/** Everyone in the room, in member order, with what each is doing. */
export function roomOf(
  members: readonly Blob[],
  live: {
    typing: readonly string[];
    outcomes: Readonly<Record<string, GroupTurnOutcome>>;
    messages: readonly GroupMessage[];
  },
): Room {
  const crowd = members.length >= ROOM_CROWD_FROM;
  const handoff = handoffOf(members, live.typing, live.messages);
  // Someone sat a turn out only if a turn has happened.
  const turn = members.some((b) => live.typing.includes(b.id) || live.outcomes[b.id]);
  let blinking = 0;
  return {
    crowd,
    handoff,
    members: members.map((blob, i) => {
      const look = lookOf(blob);
      const outcome = live.outcomes[blob.id];
      const from = handoff?.from === i;
      let tone: RoomTone = "plain";
      let state = "";
      if (live.typing.includes(blob.id)) {
        tone = "live";
        state = "Replying…";
      } else if (outcome) {
        // A newer host may send a kind this build doesn't know.
        const label = OUTCOME_LABEL[outcome.kind] ?? "Ended";
        const shade = outcomeTone(outcome.kind);
        tone = shade === " is-error" ? "failed" : shade === " is-warning" ? "warn" : "plain";
        state = !from ? label : crowd ? "Handed over" : `${label} · handed over`;
      } else if (from) {
        state = "Handed over";
      } else if (!crowd) {
        // With room to spare, one who took no part shows its job instead.
        tone = turn ? "idle" : "plain";
        state = blob.job;
      }
      const blinks = tone !== "live" && tone !== "idle" && BLINKING.includes(look.face);
      return {
        blob,
        tone,
        state,
        reason: tone === "live" ? "" : (outcome?.reason ?? ""),
        foot: FOOT[look.shape],
        ...(blinks ? { clock: `${crowd ? "c" : "b"}${(blinking++ % BLINK_CLOCKS) + 1}` } : {}),
        from,
      };
    }),
  };
}
