// When a Blob schedule fires next. Pure functions over epoch milliseconds, so
// the scheduler and its tests share one clock.
//
// Wall-clock kinds (daily, weekly) are computed in the schedule's IANA
// timezone with Intl only (no tz database dependency): the local date of the
// reference instant is read with Intl.DateTimeFormat, and each candidate
// HH:MM is mapped back to an instant with that zone's offset, so a DST change
// between now and the next run is honoured.
//
// - A wall time that does not exist (spring-forward gap) runs at the first
//   instant after the gap, e.g. 01:30 on the last Sunday of March in London
//   runs at 02:30 BST.
// - A wall time that happens twice (fall-back) runs at the first of the two.

export type ScheduleKind = "interval" | "daily" | "weekly" | "once";

export interface ScheduleTiming {
  readonly kind: ScheduleKind;
  readonly everyMinutes?: number;
  readonly time?: string;
  readonly days?: readonly number[];
  readonly at?: string;
  readonly timezone: string;
}

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Is `tz` an IANA zone this runtime knows? */
export function validTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  readonly h: number;
  readonly min: number;
}

function wallAt(t: number, tz: string): Wall {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(t)))
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  return { y: parts.year!, m: parts.month!, d: parts.day!, h: parts.hour!, min: parts.minute! };
}

/** The zone's UTC offset at instant `t`, in ms (east positive). */
function offsetAt(t: number, tz: string): number {
  const w = wallAt(t, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
  return asUtc - Math.floor(t / MINUTE) * MINUTE;
}

/** The instant a wall-clock time happens in `tz` (see the header for gaps/overlaps). */
export function zonedInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  tz: string,
): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // The offsets either side of the wall time: equal on an ordinary day.
  const candidates = [
    guess - offsetAt(guess - 12 * 3_600_000, tz),
    guess - offsetAt(guess + 12 * 3_600_000, tz),
  ];
  const wanted = Date.UTC(y, m - 1, d, h, min);
  const valid = candidates.filter((t) => {
    const w = wallAt(t, tz);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) === wanted;
  });
  return valid.length ? Math.min(...valid) : Math.max(...candidates);
}

function parseTime(time: string): { h: number; min: number } {
  const [h, min] = time.split(":").map(Number);
  return { h: h!, min: min! };
}

/**
 * The first occurrence strictly after `after`, or null when there is none
 * (a "once" in the past). `previous` is the occurrence that just fired, for
 * intervals: their grid is anchored there, so a late tick does not drift it.
 */
export function nextOccurrence(s: ScheduleTiming, after: number, previous?: number): number | null {
  switch (s.kind) {
    case "interval": {
      const step = (s.everyMinutes ?? 0) * MINUTE;
      if (step <= 0) return null;
      if (previous === undefined) return after + step;
      // Skip every boundary that is already past: missed runs are not replayed.
      const k = Math.max(1, Math.floor((after - previous) / step) + 1);
      return previous + k * step;
    }
    case "once": {
      const at = s.at ? Date.parse(s.at) : NaN;
      return Number.isFinite(at) && at > after ? at : null;
    }
    case "daily":
    case "weekly": {
      if (!s.time) return null;
      const { h, min } = parseTime(s.time);
      const today = wallAt(after, s.timezone);
      // Eight days always reach the next matching weekday, even across DST.
      for (let i = 0; i <= 8; i += 1) {
        const date = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
        if (s.kind === "weekly" && !s.days?.includes(date.getUTCDay())) continue;
        const t = zonedInstant(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
          h,
          min,
          s.timezone,
        );
        if (t > after) return t;
      }
      return null;
    }
  }
}
