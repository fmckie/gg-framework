// Auto-schedules: the pure half of reading a Blob's job for timing. blobs.ts
// sends the job to the sidecar's one-shot `POST /complete` with this system
// prompt, takes the first JSON object out of the reply, and validates each
// item with the same validator as `POST /kleio/blobs/:id/schedules`.

/** Most schedules one extraction may add. */
export const MAX_AUTO_SCHEDULES = 5;
/** The whole extraction, sidecar call included. */
export const EXTRACT_TIMEOUT_MS = 25_000;
export const EXTRACT_MAX_TOKENS = 800;

/** `<weekday, d MMM yyyy HH:mm>` of `at`, on the wall clock of `timeZone`. */
export function wallClock(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`;
}

export function extractionPrompt(at: Date, timeZone: string): string {
  return [
    "You turn a helper's job description into schedules. Reply with JSON only:",
    '{"schedules":[{"label":string (≤60 chars),"prompt":string (what to do at that time, as an',
    'instruction to the helper),"kind":"interval"|"daily"|"weekly"|"once","everyMinutes":int≥15?,',
    '"time":"HH:MM"?,"days":[0-6]? (0=Sunday),"at":ISO-8601 with offset?}]}',
    'Rules: only timing the job states or clearly implies. "every morning" = daily 08:00,',
    '"evening" = 18:00, "weekdays" = kind "weekly" with days [1,2,3,4,5], "weekends" = kind',
    '"weekly" with days [0,6], "hourly" = interval 60. "daily" means every day: any named days',
    'make it "weekly". Relative times',
    '("tomorrow at 9", "in 2 hours") are "once". No timing → {"schedules":[]}. At most 5.',
    `Now: ${wallClock(at, timeZone)} in ${timeZone}.`,
  ].join("\n");
}

/**
 * The first balanced `{…}` block of a model reply, parsed; null when there is
 * none or it is not JSON. Braces inside JSON strings do not count.
 */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as unknown;
      } catch {
        return null;
      }
    }
  }
  return null;
}
