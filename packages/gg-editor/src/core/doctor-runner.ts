/**
 * Interactive doctor screen.
 *
 * Modelled directly on `@kleio/coder/ui/login.tsx`'s
 * `renderLoginSelector` so the look matches:
 *
 *   ▄▀▀▀ ▄▀▀▀   GG Editor v0.6.0 · By Ken Kai
 *   █ ▀█ █ ▀█   Doctor
 *   ▀▄▄▀ ▀▄▄▀   Environment check
 *
 *   ❯ ✓ ffmpeg            — v8.0.1
 *     ✓ ffprobe           — v8.0.1
 *     ○ OpenAI API key    — not set
 *     ✓ Python 3          — v3.14.3
 *     …
 *
 *   ↑↓ navigate · Enter fix · r refresh · Esc quit
 *
 * Mechanics:
 *   - `\x1b[s` saves the cursor on entry; `\x1b[u\x1b[J` restores +
 *     clears below for each redraw. No alt-screen buffer (we don't need
 *     it; the doctor is short and re-runnable).
 *   - On exit we restore + clear so terminal scrollback is preserved.
 *   - Enter on an installable runs the package manager directly via
 *     `spawn` (stdio inherited so the user sees output / answers
 *     prompts). Enter on a `prompt` opens an inline secret capture.
 *   - q / Esc / Ctrl+C → quit cleanly.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { setStoredApiKey } from "./auth/api-keys.js";
import { type DoctorCheck, type PromptHint, runDoctor } from "./doctor.js";
import { renderDoctorReport } from "./doctor-render.js";
import { getPackageVersion } from "./version.js";

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
const PRIMARY = "#f97316";
const ACCENT = "#ec4899";
const TEXT = "#e2e8f0";
const TEXT_DIM = "#64748b";
const GAP = "   ";

export interface DoctorRunOptions {
  /** Welcome banner instead of the plain doctor banner. */
  onboarding?: boolean;
  /** Show the full inventory and exit (no interactive screen). */
  all?: boolean;
  /** Skip every prompt — print the report once and exit. CI-friendly. */
  nonInteractive?: boolean;
}

/**
 * Top-level entry called by cli.ts.
 *
 *   - `--all` → prints the static inventory, no screen.
 *   - non-TTY / `nonInteractive` → same.
 *   - everything else → mounts the interactive screen.
 */
export async function runDoctorInteractive(opts: DoctorRunOptions = {}): Promise<void> {
  if (opts.all || opts.nonInteractive || !process.stdin.isTTY) {
    const report = runDoctor();
    process.stdout.write(staticBanner(opts.onboarding === true));
    process.stdout.write(
      renderDoctorReport(report, { all: opts.all, onboarding: opts.onboarding }),
    );
    return;
  }

  await mountSelector(opts.onboarding === true);
}

// ── Renderers ─────────────────────────────────────────────

function gradientLine(text: string): string {
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

function bannerLines(onboarding: boolean): string[] {
  const screen = onboarding ? "Welcome" : "Doctor";
  const subtitle = onboarding ? "First-run environment check" : "Environment check — Enter to fix";
  return [
    gradientLine(LOGO_LINES[0]) +
      GAP +
      chalk.hex(PRIMARY).bold("GG Editor") +
      chalk.hex(TEXT_DIM)(` v${getPackageVersion()}`) +
      chalk.hex(TEXT_DIM)(" \u00b7 By ") +
      chalk.hex(TEXT).bold("Ken Kai"),
    gradientLine(LOGO_LINES[1]) + GAP + chalk.hex(ACCENT)(screen),
    gradientLine(LOGO_LINES[2]) + GAP + chalk.hex(TEXT_DIM)(subtitle),
  ];
}

function staticBanner(onboarding: boolean): string {
  return bannerLines(onboarding).join("\n") + "\n\n";
}

function statusGlyph(c: DoctorCheck): string {
  if (c.status === "ok") return chalk.green("\u2713");
  if (c.status === "warn") return chalk.yellow("!");
  if (c.severity === "required" || c.severity === "block") return chalk.red("\u2717");
  return chalk.yellow("\u25cb");
}

/**
 * One line per item, modelled on login.tsx's provider rows.
 *
 *   ❯ ✓ ffmpeg            — v8.0.1
 *     ○ OpenAI API key    — not set
 *
 * The `detail` is the right-side em-dash text (terse — see doctor.ts
 * for the trimmed strings: "v8.0.1", "set", "not set", etc).
 */
function renderItemLine(c: DoctorCheck, selected: boolean, status: "ok" | "miss" | "warn"): string {
  const marker = selected ? chalk.hex(PRIMARY)("\u276f ") : "  ";
  const labelColor =
    status === "ok"
      ? selected
        ? chalk.hex(PRIMARY)
        : chalk.hex(TEXT)
      : selected
        ? chalk.hex(PRIMARY).bold
        : chalk.hex(TEXT);
  const label = labelColor(c.label.padEnd(22));
  return `${marker}${statusGlyph(c)} ${label}${chalk.hex(TEXT_DIM)(` \u2014 ${c.detail}`)}`;
}

function renderScreen(
  items: DoctorCheck[],
  selectedIdx: number,
  onboarding: boolean,
  note?: string,
  exitPending?: boolean,
): string {
  const lines: string[] = [...bannerLines(onboarding), ""];
  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    const status: "ok" | "miss" | "warn" =
      c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : "miss";
    lines.push(renderItemLine(c, i === selectedIdx, status));
  }
  lines.push("");
  if (note) lines.push("  " + chalk.hex(ACCENT)(note));

  // Footer mirrors ggeditor's main-TUI abort pattern: first Esc / Ctrl+C
  // shows "Press again to exit"; the second press within 800ms quits.
  // Avoids accidental quits and matches the look users learned from the
  // main TUI footer.
  const footer = exitPending
    ? chalk.yellow("  Press Esc again to exit")
    : chalk.hex(TEXT_DIM)("  \u2191\u2193 navigate \u00b7 ") +
      chalk.hex(PRIMARY)("Enter") +
      chalk.hex(TEXT_DIM)(" fix \u00b7 ") +
      chalk.hex(PRIMARY)("r") +
      chalk.hex(TEXT_DIM)(" refresh \u00b7 ") +
      chalk.hex(PRIMARY)("Esc") +
      chalk.hex(TEXT_DIM)(" quit");
  lines.push(footer);
  return lines.join("\n");
}

// ── Interactive selector ──────────────────────────────────

async function mountSelector(onboarding: boolean): Promise<void> {
  const stdout = process.stdout;
  const stdin = process.stdin;

  let report = runDoctor();
  let items = report.checks.filter((c) => c.severity !== "info");
  let selectedIdx = pickFirstActionable(items);
  let note: string | undefined;
  let noteTimer: ReturnType<typeof setTimeout> | null = null;

  // Double-press exit (mirrors ggeditor's main TUI). First Esc / Ctrl+C
  // arms exitPending; second within DOUBLE_PRESS_TIMEOUT_MS confirms.
  let exitPending = false;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;

  // Full-clear + cursor home, then save the position so subsequent
  // redraws can restore it. Wipes the shell prompt that ran us, so the
  // doctor screen looks like a standalone view.
  stdout.write("\x1b[2J\x1b[H\x1b[s");

  const draw = () => {
    stdout.write(
      "\x1b[u\x1b[J" + renderScreen(items, selectedIdx, onboarding, note, exitPending) + "\n",
    );
  };

  const flashNote = (text: string) => {
    if (noteTimer) clearTimeout(noteTimer);
    note = text;
    draw();
    noteTimer = setTimeout(() => {
      note = undefined;
      draw();
    }, 2500);
  };

  const reload = () => {
    report = runDoctor();
    items = report.checks.filter((c) => c.severity !== "info");
    if (selectedIdx >= items.length) selectedIdx = Math.max(0, items.length - 1);
  };

  draw();
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      if (noteTimer) clearTimeout(noteTimer);
      if (exitTimer) clearTimeout(exitTimer);
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      // Full clear so the user's terminal scrollback isn't polluted with
      // selector frames; print one summary line as a fresh start.
      stdout.write("\x1b[2J\x1b[H");
      const total = items.length;
      const ok = items.filter((c) => c.status === "ok").length;
      if (ok === total) {
        stdout.write(
          chalk.green("\u2713 Nothing to fix. You're all good.") +
            chalk.hex(TEXT_DIM)(" Run `ggeditor` to start.\n"),
        );
      } else {
        stdout.write(
          chalk.hex(TEXT_DIM)(
            `Doctor closed. ${ok}/${total} ready. Re-run \`ggeditor doctor\` any time.\n`,
          ),
        );
      }
      resolve();
    };

    /**
     * Tear down the selector, fully clear the screen, re-print the
     * branded banner, then run an async block with normal stdio. The
     * full clear (\x1b[2J\x1b[H) wipes the prior shell prompt so the
     * sub-screen looks like a standalone view, not a continuation of
     * the user's terminal scrollback.
     */
    const runWithSubshell = async (block: () => Promise<{ ok: boolean }>): Promise<void> => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      // Full clear + cursor home, then re-render the banner.
      stdout.write("\x1b[2J\x1b[H");
      stdout.write(staticBanner(onboarding));

      let result: { ok: boolean };
      try {
        result = await block();
      } catch (e) {
        process.stdout.write(chalk.red(`\n  Error: ${(e as Error).message}\n`));
        result = { ok: false };
      }
      // Brief pause so the user sees the outcome.
      await new Promise((r) => setTimeout(r, 600));
      // Full clear + re-save cursor + redraw the selector.
      stdout.write("\x1b[2J\x1b[H\x1b[s");
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
      reload();
      const cur = items[selectedIdx];
      if (cur) {
        const newIdx = items.findIndex((c) => c.id === cur.id);
        selectedIdx = newIdx >= 0 ? newIdx : pickFirstActionable(items);
      }
      if (result.ok) flashNote(`Saved`);
      else draw();
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString();

      // Esc / Ctrl+C / q — double-press to confirm. First press arms
      // exitPending and the footer flips to "Press Esc again to exit";
      // second press within 800ms confirms; otherwise it auto-clears.
      if (key === "\x1b" || key === "\x03" || key === "q") {
        if (exitPending) {
          if (exitTimer) clearTimeout(exitTimer);
          cleanup();
        } else {
          exitPending = true;
          draw();
          exitTimer = setTimeout(() => {
            exitPending = false;
            draw();
          }, 800);
        }
        return;
      }

      // Any other key clears a pending-exit hint without acting on it.
      if (exitPending) {
        if (exitTimer) clearTimeout(exitTimer);
        exitPending = false;
        draw();
      }

      // ↑
      if (key === "\x1b[A" && selectedIdx > 0) {
        selectedIdx--;
        draw();
        return;
      }

      // ↓
      if (key === "\x1b[B" && selectedIdx < items.length - 1) {
        selectedIdx++;
        draw();
        return;
      }

      // r → refresh
      if (key === "r") {
        reload();
        flashNote("Refreshed");
        return;
      }

      // Enter → install / prompt / nothing
      if (key === "\r" || key === "\n") {
        const cur = items[selectedIdx];
        if (!cur) return;
        if (cur.status === "ok") {
          flashNote("Already done");
          return;
        }

        if (cur.installable) {
          const inst = cur.installable;
          void runWithSubshell(async () => {
            process.stdout.write(
              chalk.hex(TEXT_DIM)("Running: ") +
                chalk.cyan(`${inst.command} ${inst.args.join(" ")}`) +
                "\n\n",
            );
            const code = await spawnInstall(inst.command, inst.args);
            if (code === 0) {
              process.stdout.write(chalk.green("\n\u2713 Installed.\n"));
              return { ok: true };
            }
            process.stdout.write(chalk.red(`\n\u2717 Install failed (exit ${code}).\n`));
            return { ok: false };
          });
          return;
        }

        if (cur.prompt) {
          const p = cur.prompt;
          void runWithSubshell(async () => promptForSecret(p));
          return;
        }

        flashNote("No automatic fix");
      }
    };

    stdin.on("data", onData);
  });
}

// ── Helpers ───────────────────────────────────────────────

function pickFirstActionable(items: DoctorCheck[]): number {
  // Priority: required-missing/warn → optional-warn → optional-missing → 0.
  const tiers: Array<{ severity: DoctorCheck["severity"]; statuses: DoctorCheck["status"][] }> = [
    { severity: "block", statuses: ["missing", "warn"] },
    { severity: "required", statuses: ["missing", "warn"] },
    { severity: "optional", statuses: ["warn"] },
    { severity: "optional", statuses: ["missing"] },
  ];
  for (const tier of tiers) {
    const idx = items.findIndex(
      (c) => c.severity === tier.severity && tier.statuses.includes(c.status),
    );
    if (idx >= 0) return idx;
  }
  return 0;
}

function spawnInstall(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/**
 * Prompt the user for a secret, validate it, persist via setStoredApiKey.
 *
 * Echoes input as it's typed — these are API keys, and node has no
 * built-in masked-input primitive without dragging in a dep. Anyone
 * with shell access could `cat ~/.gg/api-keys.json` anyway.
 */
async function promptForSecret(p: PromptHint): Promise<{ ok: boolean }> {
  const dim = chalk.hex(TEXT_DIM);
  const primary = chalk.hex(PRIMARY);
  const accent = chalk.hex(ACCENT);
  // Caller (runWithSubshell) has already cleared the screen + printed
  // the banner. We just add the prompt body.
  process.stdout.write("  " + primary.bold(p.label) + "\n");
  if (p.hint) process.stdout.write("  " + dim(p.hint) + "\n");
  process.stdout.write("  " + dim("(blank + Enter to cancel)") + "\n\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const value = (await rl.question("  " + accent("\u276f "))).trim();
      if (value.length === 0) {
        process.stdout.write(dim("  Cancelled.\n"));
        return { ok: false };
      }
      const err = p.validate?.(value);
      if (err) {
        process.stdout.write(chalk.yellow(`  ! ${err}\n`));
        continue;
      }
      try {
        setStoredApiKey(p.store, value);
      } catch (e) {
        process.stdout.write(chalk.red(`  \u2717 Failed to save: ${(e as Error).message}\n`));
        return { ok: false };
      }
      process.stdout.write(chalk.green("  \u2713 Saved to ~/.gg/api-keys.json (chmod 600).\n"));
      return { ok: true };
    }
    process.stdout.write(dim("  Too many invalid attempts. Cancelled.\n"));
    return { ok: false };
  } finally {
    rl.close();
  }
}
