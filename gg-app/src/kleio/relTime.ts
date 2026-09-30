// Relative times for Kleio's connection screens. Its own tiny module so a page
// can use it without pulling the lazily loaded pairing window into its chunk.

/** "3 min ago" / "in 4 min" — enough for last-seen and expiry. */
export function relTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  const unit =
    abs < 60
      ? `${abs}s`
      : abs < 3600
        ? `${Math.round(abs / 60)} min`
        : abs < 86_400
          ? `${Math.round(abs / 3600)} h`
          : `${Math.round(abs / 86_400)} d`;
  return s < 0 ? `${unit} ago` : `in ${unit}`;
}
