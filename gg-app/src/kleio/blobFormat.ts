// Display helpers shared by the Blobs pane: schedule descriptions worded like
// the iPhone app ("Every day at 08:00", "Mon, Wed, Fri at 18:30",
// "Every 2 hours", "Once on 3 Oct at 09:00") and short relative times.

import type { Schedule } from "./kleioApi";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const FALLBACK_TIMEZONE = "Europe/London";

/**
 * The desktop's IANA zone; Blobs created here schedule in it. A zone the
 * system can't name comes back as "Etc/Unknown", which the host rejects, so
 * anything that isn't a usable zone falls back to London.
 */
export function systemTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === "Etc/Unknown") return FALLBACK_TIMEZONE;
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function describeDays(days: number[]): string {
  const set = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (set.length === 7) return "Every day";
  if (set.join() === "1,2,3,4,5") return "Weekdays";
  if (set.join() === "0,6") return "Weekends";
  // Monday-first, like the phone.
  const mondayFirst = [...set.filter((d) => d !== 0), ...set.filter((d) => d === 0)];
  return mondayFirst.map((d) => DAY_SHORT[d]).join(", ");
}

function describeInterval(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "Every day" : `Every ${d} days`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "Every hour" : `Every ${h} hours`;
  }
  return `Every ${minutes} minutes`;
}

function zoned(iso: string, timeZone: string | undefined): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const opts = timeZone ? { timeZone } : {};
  try {
    return {
      date: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...opts }).format(d),
      time: new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        ...opts,
      }).format(d),
    };
  } catch {
    // Unknown zone name: fall back to the viewer's own.
    return timeZone ? zoned(iso, undefined) : null;
  }
}

/** One-line description of when a schedule fires. */
export function describeSchedule(
  s: Pick<Schedule, "kind" | "everyMinutes" | "time" | "days" | "at" | "timezone">,
): string {
  switch (s.kind) {
    case "interval":
      return describeInterval(s.everyMinutes ?? 60);
    case "daily":
      return `Every day at ${s.time ?? "--:--"}`;
    case "weekly":
      return `${describeDays(s.days ?? [])} at ${s.time ?? "--:--"}`;
    case "once": {
      const z = s.at ? zoned(s.at, s.timezone) : null;
      return z ? `Once on ${z.date} at ${z.time}` : "Once";
    }
  }
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "today 08:00", "tomorrow 08:00", "Thu 3 Oct 08:00" in the viewer's zone. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (dayKey(d) === dayKey(now)) return `today ${time}`;
  if (dayKey(d) === dayKey(tomorrow)) return `tomorrow ${time}`;
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
  return `${date} ${time}`;
}

/** Earliest upcoming run across a Blob's enabled schedules, or null. */
export function nextRun(schedules: readonly Schedule[]): string | null {
  let best: string | null = null;
  for (const s of schedules) {
    if (!s.enabled || !s.nextRunAt) continue;
    if (best === null || Date.parse(s.nextRunAt) < Date.parse(best)) best = s.nextRunAt;
  }
  return best;
}

/** Auto-schedule outcome after a save, worded for a toast/hint; null = say nothing. */
export function describeAutoSchedules(
  auto: { status: "ok" | "none" | "failed"; count: number; error?: string } | undefined,
): string | null {
  if (!auto) return null;
  if (auto.status === "ok")
    return auto.count === 1
      ? "Added 1 schedule from the job."
      : `Added ${auto.count} schedules from the job.`;
  if (auto.status === "none") return "No timing in the job, so no schedules were added.";
  return `Couldn't read schedules from the job${auto.error ? ` (${auto.error})` : ""}. Add them under Schedules.`;
}

/** How the host words a schedule's prompt (kleio-host blobs.ts). */
const SCHEDULED = /^\u23F0\uFE0F?\s*Scheduled task "([^"\n]*)":\s*([\s\S]*)$/;

/** A run's summary as one plain line: Markdown marks (`**bold**`, `# `, links,
 *  code ticks, list bullets) removed, so a clipped preview reads cleanly. */
export function plainSummary(text: string): string {
  return (
    text
      .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
      // Emphasis and code only at word edges, so snake_case and 2*3 survive.
      .replace(/(^|[^\w*_`])(\*\*|__|\*|_|`)(?=\S)([^*_`\n]*?\S)\2(?![\w*_`])/g, "$1$3")
      .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s?|\d+\.\s+)/gm, "")
      // A summary clipped mid-phrase can leave an unpaired ** or `.
      .replace(/\*\*|`/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** A schedule's prompt, without the host's alarm-clock prefix. */
export function scheduledPrompt(text: string): { label: string; prompt: string } | null {
  const m = SCHEDULED.exec(text);
  return m ? { label: m[1] ?? "", prompt: (m[2] ?? "").trim() } : null;
}
