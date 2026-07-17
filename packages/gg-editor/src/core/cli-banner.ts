/**
 * Shared chalk banner used by every non-TUI ggeditor screen
 * (auth, login, doctor, onboarding). Mirrors the Ink-rendered banner
 * from src/ui/components/Banner.tsx and the chalk login screen in
 * @kleio/coder/ui/login so all surfaces feel like one product.
 *
 * Layout (side-by-side, 3 lines):
 *
 *      ▄▀▀▀ ▄▀▀▀    GG Editor v0.3.0 · By Ken Kai
 *      █ ▀█ █ ▀█    <screen>
 *      ▀▄▄▀ ▀▄▄▀    <subtitle>
 *
 * Logo glyphs are colored with the editor's warm sunset gradient (amber
 * → orange → red → magenta). Brand text uses the editor primary; the
 * accent color is reserved for the screen name.
 */
import chalk from "chalk";

const LOGO_LINES = [
  " \u2584\u2580\u2580\u2580 \u2584\u2580\u2580\u2580",
  " \u2588 \u2580\u2588 \u2588 \u2580\u2588",
  " \u2580\u2584\u2584\u2580 \u2580\u2584\u2584\u2580",
];

const GRADIENT = [
  "#fbbf24",
  "#f59e0b",
  "#f97316",
  "#ea580c",
  "#dc2626",
  "#e11d48",
  "#db2777",
  "#e11d48",
  "#dc2626",
  "#ea580c",
  "#f97316",
  "#f59e0b",
];

const PRIMARY = "#f97316"; // brand orange
const ACCENT = "#ec4899"; // screen-name pink
const TEXT = "#e2e8f0";
const TEXT_DIM = "#64748b";

const GAP = "   ";

export interface CliBannerOptions {
  /** Brand label shown next to logo line 1. Default "GG Editor". */
  brand?: string;
  /** Version shown after the brand. */
  version: string;
  /** Screen name shown next to logo line 2 (e.g. "Doctor", "Auth"). */
  screen: string;
  /** Subtitle shown next to logo line 3. Optional. */
  subtitle?: string;
}

/**
 * Render the banner as a string. Newline-terminated; trailing blank
 * line so subsequent content has air. Print with process.stdout.write.
 */
export function renderCliBanner(opts: CliBannerOptions): string {
  const brand = opts.brand ?? "GG Editor";
  const lines: string[] = [];

  lines.push(
    gradient(LOGO_LINES[0]) +
      GAP +
      chalk.hex(PRIMARY).bold(brand) +
      chalk.hex(TEXT_DIM)(` v${opts.version}`) +
      chalk.hex(TEXT_DIM)(" \u00b7 By ") +
      chalk.hex(TEXT).bold("Ken Kai"),
  );
  lines.push(gradient(LOGO_LINES[1]) + GAP + chalk.hex(ACCENT)(opts.screen));
  lines.push(
    gradient(LOGO_LINES[2]) + (opts.subtitle ? GAP + chalk.hex(TEXT_DIM)(opts.subtitle) : ""),
  );
  lines.push("");
  return lines.join("\n") + "\n";
}

function gradient(text: string): string {
  let result = "";
  let colorIdx = 0;
  for (const ch of text) {
    if (ch === " ") {
      result += ch;
    } else {
      const color = GRADIENT[Math.min(colorIdx, GRADIENT.length - 1)];
      result += chalk.hex(color)(ch);
      colorIdx++;
    }
  }
  return result;
}
