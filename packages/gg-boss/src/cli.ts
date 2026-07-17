#!/usr/bin/env -S node --max-old-space-size=8192 --expose-gc
// Heap default (~1.5–4GB) fatal-OOMs on long boss sessions: 6 workers, large
// tool results in message history, and Whisper/Ink tensors all live in the
// same V8 heap. 8GB gives headroom; --expose-gc lets us nudge GC after
// post-turn truncation. Users can override via NODE_OPTIONS — Node merges
// shebang flags with the env var.
import path from "node:path";
import chalk from "chalk";
import type { Provider } from "@kleio/ai";
import { setStreamDiagnostic } from "@kleio/agent";
import { AuthStorage, getDefaultModel, getModel, KLEIO_PRODUCT_PROFILE } from "@kleio/core";
import { KleioManager } from "./orchestrator.js";
import type { ProjectSpec } from "./types.js";
import { loadLinks } from "./links.js";
import { runLinkCommand } from "./link-command.js";
import { runBossServeMode, loadBossTelegramConfig } from "./serve-mode.js";
import { runBossTelegramSetup } from "./telegram-setup.js";
import { COLORS, clearScreen } from "./branding.js";
import { renderBossApp } from "./orchestrator-app.js";
import { loadSettings } from "./settings.js";
import { showSplash } from "./splash.js";
import { initLogger, log } from "./logger.js";
import { VERSION } from "./branding.js";
import { checkAndAutoUpdate } from "./auto-update.js";
import { resolveManagerTelegramEnvironment } from "./environment.js";
import { stopRadio } from "./radio.js";

const MANAGER_DISPLAY_NAME = KLEIO_PRODUCT_PROFILE.manager.displayName;
const MANAGER_COMMAND = KLEIO_PRODUCT_PROFILE.manager.preferredCommand;
const LEGACY_MANAGER_COMMAND = KLEIO_PRODUCT_PROFILE.manager.legacyCommand;
const CODER_DISPLAY_NAME = KLEIO_PRODUCT_PROFILE.coder.displayName;
const CODER_COMMAND = KLEIO_PRODUCT_PROFILE.coder.preferredCommand;

interface CliArgs {
  /** Undefined when not passed on the CLI — settings file then defaults take over. */
  bossProvider?: Provider;
  bossModel?: string;
  workerProvider?: Provider;
  workerModel?: string;
  projects: ProjectSpec[];
  continueRecent?: boolean;
  resumeSessionId?: string;
}

function parseProjectSpec(raw: string): ProjectSpec {
  const eq = raw.indexOf("=");
  if (eq > 0) {
    const name = raw.slice(0, eq);
    const cwd = path.resolve(raw.slice(eq + 1));
    return { name, cwd };
  }
  const cwd = path.resolve(raw);
  return { name: path.basename(cwd), cwd };
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    projects: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--project" || a === "-p") {
      const v = argv[++i];
      if (!v) throw new Error("--project requires a value");
      args.projects.push(parseProjectSpec(v));
    } else if (a === "--manager-model" || a === "--boss-model") {
      const v = argv[++i];
      if (!v) throw new Error(`${a} requires a value`);
      args.bossModel = v;
    } else if (a === "--worker-model") {
      const v = argv[++i];
      if (!v) throw new Error("--worker-model requires a value");
      args.workerModel = v;
    } else if (a === "--resume") {
      const v = argv[++i];
      if (!v) throw new Error("--resume requires a session id");
      args.resumeSessionId = v;
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return args;
}

function printHelpAndExit(): never {
  const c = (color: string, text: string): string => chalk.hex(color)(text);
  process.stdout.write(
    "\n" +
      c(COLORS.primary, `${MANAGER_DISPLAY_NAME} v${VERSION}`) +
      c(
        COLORS.textDim,
        ` — orchestrator that drives multiple ${CODER_DISPLAY_NAME} workers from one chat.\n\n`,
      ) +
      c(COLORS.text, "Usage\n") +
      "  " +
      c(COLORS.accent, MANAGER_COMMAND) +
      c(COLORS.textDim, "                         start with linked projects\n") +
      "  " +
      c(COLORS.accent, `${MANAGER_COMMAND} link`) +
      c(COLORS.textDim, "                    pick projects to link (interactive)\n") +
      "  " +
      c(COLORS.accent, `${MANAGER_COMMAND} telegram`) +
      c(COLORS.textDim, "                configure Telegram integration\n") +
      "  " +
      c(COLORS.accent, `${MANAGER_COMMAND} serve`) +
      c(COLORS.textDim, `                   run ${MANAGER_DISPLAY_NAME} over Telegram\n`) +
      "  " +
      c(COLORS.accent, `${MANAGER_COMMAND} continue`) +
      c(COLORS.textDim, "                resume the most recent Manager session\n") +
      "  " +
      c(COLORS.accent, `${MANAGER_COMMAND} --resume <id>`) +
      c(COLORS.textDim, "           resume a specific Manager session\n") +
      "  " +
      c(COLORS.accent, `${MANAGER_COMMAND} --project <spec> [...]`) +
      c(COLORS.textDim, "  override links with explicit project(s)\n\n") +
      c(COLORS.text, "Options\n") +
      "  " +
      c(COLORS.primary, "--project, -p <spec>") +
      c(COLORS.textDim, '    project to manage; "cwd" or "name=cwd"; repeatable\n') +
      "  " +
      c(COLORS.primary, "--manager-model <id>") +
      c(COLORS.textDim, "      Manager model (default: claude-opus-4-8)\n") +
      "  " +
      c(COLORS.primary, "--worker-model <id>") +
      c(COLORS.textDim, "       Coder worker model (default: claude-sonnet-4-6)\n") +
      "  " +
      c(COLORS.primary, "--version, -v") +
      c(COLORS.textDim, "               show version\n") +
      "  " +
      c(COLORS.primary, "--help, -h") +
      c(COLORS.textDim, "                  show this help\n\n") +
      c(
        COLORS.textDim,
        `Compatibility: ${LEGACY_MANAGER_COMMAND} and --boss-model remain supported.\n`,
      ) +
      c(COLORS.textDim, `Talk to ${MANAGER_DISPLAY_NAME} at the prompt. Press `) +
      c(COLORS.accent, "Ctrl+C") +
      c(COLORS.textDim, " twice to exit.\n\n"),
  );
  process.exit(0);
}

// ── `kleio-manager serve` ─────────────────────────────────────
//
// Runs the orchestrator headless and bridges it to Telegram. Resolves the bot
// token + user ID from CLI flags > preferred env > legacy env > saved config.
// Manager/worker provider and model resolution mirrors interactive mode.
async function runServeSubcommand(argv: string[]): Promise<void> {
  let cliBotToken: string | undefined;
  let cliUserId: string | undefined;
  let cliBossModel: string | undefined;
  let cliWorkerModel: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--bot-token") cliBotToken = argv[++i];
    else if (a === "--user-id") cliUserId = argv[++i];
    else if (a === "--manager-model" || a === "--boss-model") cliBossModel = argv[++i];
    else if (a === "--worker-model") cliWorkerModel = argv[++i];
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        `\n${MANAGER_COMMAND} serve — drive ${MANAGER_DISPLAY_NAME} from Telegram\n\n` +
          "Options\n" +
          "  --bot-token <token>   Telegram token (env KLEIO_MANAGER_TELEGRAM_BOT_TOKEN)\n" +
          "  --user-id <id>        Allowed user (env KLEIO_MANAGER_TELEGRAM_USER_ID)\n" +
          "  --manager-model <id>  Override Manager model\n" +
          "  --worker-model <id>   Override Coder worker model\n\n" +
          `Legacy GG_BOSS_TELEGRAM_* variables and --boss-model remain supported.\n` +
          `Run \`${MANAGER_COMMAND} telegram\` first to save credentials interactively.\n\n`,
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  const saved = await loadBossTelegramConfig();
  const telegramEnvironment = resolveManagerTelegramEnvironment();
  const botToken = cliBotToken ?? telegramEnvironment.botToken ?? saved?.botToken;
  const userIdStr = cliUserId ?? telegramEnvironment.userId;
  const userId = userIdStr !== undefined ? parseInt(userIdStr, 10) : saved?.userId;

  if (!botToken || !userId || isNaN(userId)) {
    process.stderr.write(
      chalk.hex(COLORS.error)("Telegram not configured.\n\n") +
        "Run " +
        chalk.hex(COLORS.primary).bold(`${MANAGER_COMMAND} telegram`) +
        " to set up your bot token and user ID.\n\n" +
        chalk.hex(COLORS.textDim)("Or provide manually:\n") +
        chalk.hex(COLORS.textDim)(`  ${MANAGER_COMMAND} serve --bot-token TOKEN --user-id ID\n`),
    );
    process.exit(1);
  }

  const settings = await loadSettings();
  const { bossProvider, bossModel, workerProvider, workerModel } = await resolveBossAuth({
    bossProvider: settings.bossProvider ?? "anthropic",
    bossModel: cliBossModel ?? settings.bossModel ?? "claude-opus-4-8",
    workerProvider: settings.workerProvider ?? "anthropic",
    workerModel: cliWorkerModel ?? settings.workerModel ?? "claude-sonnet-4-6",
  });

  await runBossServeMode({
    bossProvider,
    bossModel,
    bossThinkingLevel: settings.bossThinkingLevel,
    workerProvider,
    workerModel,
    telegram: { botToken, userId },
  });
}

const ALL_PROVIDERS: Provider[] = [
  "anthropic",
  "openai",
  "xiaomi",
  "gemini",
  "glm",
  "moonshot",
  "minimax",
  "deepseek",
  "openrouter",
];

/** Boss wants the strongest model; on anthropic that's Opus, else the provider default. */
function bossDefaultModel(provider: Provider): string {
  return provider === "anthropic" ? "claude-opus-4-8" : getDefaultModel(provider).id;
}

/**
 * Resolve Manager + worker provider/model against the providers the user is
 * actually logged in with. Mirrors Kleio Coder's active-provider fallback: never
 * fail just because the *saved* provider isn't authenticated — fall back to a
 * logged-in one for this launch. Settings on disk are left untouched, so a
 * later re-login to the preferred provider restores the preference. Only
 * throws when NOTHING is logged in.
 */
async function resolveBossAuth(input: {
  bossProvider: Provider;
  bossModel: string;
  workerProvider: Provider;
  workerModel: string;
}): Promise<{
  bossProvider: Provider;
  bossModel: string;
  workerProvider: Provider;
  workerModel: string;
  fellBack: boolean;
}> {
  const auth = new AuthStorage();
  await auth.load();
  const stored = await auth.listProviders();
  const loggedIn = ALL_PROVIDERS.filter((p) => stored.includes(p));

  if (loggedIn.length === 0) {
    throw new Error(`Not logged in to any provider. Run "${CODER_COMMAND} login" to authenticate.`);
  }

  const fallback = loggedIn[0]!;
  const resolve = (
    preferredProvider: Provider,
    preferredModel: string,
    defaultFor: (p: Provider) => string,
  ): { provider: Provider; model: string } => {
    const provider = loggedIn.includes(preferredProvider) ? preferredProvider : fallback;
    // Keep the saved model only if it belongs to the resolved provider.
    const modelFits = getModel(preferredModel)?.provider === provider;
    return { provider, model: modelFits ? preferredModel : defaultFor(provider) };
  };

  const boss = resolve(input.bossProvider, input.bossModel, bossDefaultModel);
  const worker = resolve(input.workerProvider, input.workerModel, (p) => getDefaultModel(p).id);
  const fellBack = boss.provider !== input.bossProvider || worker.provider !== input.workerProvider;

  return {
    bossProvider: boss.provider,
    bossModel: boss.model,
    workerProvider: worker.provider,
    workerModel: worker.model,
    fellBack,
  };
}

async function runOrchestrator(args: CliArgs): Promise<void> {
  if (args.projects.length === 0) {
    const links = await loadLinks();
    if (links.projects.length === 0) {
      process.stderr.write(
        "\n" +
          chalk.hex(COLORS.warning)("No linked projects.") +
          chalk.hex(COLORS.textDim)(" Run ") +
          chalk.hex(COLORS.accent)(`${MANAGER_COMMAND} link`) +
          chalk.hex(COLORS.textDim)(" to choose, or pass ") +
          chalk.hex(COLORS.accent)("--project") +
          chalk.hex(COLORS.textDim)(".\n\n"),
      );
      process.exit(1);
    }
    args.projects = links.projects.map((p) => ({ name: p.name, cwd: p.cwd }));
  }

  clearScreen();

  // Splash — Ink-rendered ASCII logo with shimmering gradient, shown while
  // Kleio Manager spins up its workers. dismiss() blocks until min-visible-time
  // has elapsed AND Ink has flushed the unmount, so the chat UI never
  // overlaps with the splash on screen.
  const splash = showSplash({
    caption: `Spinning up ${args.projects.length} worker${args.projects.length === 1 ? "" : "s"}…`,
  });

  // Resolve final Manager/worker models: CLI flags > saved settings > defaults.
  // Settings persist user choices made via model commands across restarts so
  // the user doesn't have to re-pick every session.
  const settings = await loadSettings();
  const preferredBossProvider = args.bossProvider ?? settings.bossProvider ?? "anthropic";
  const preferredBossModel = args.bossModel ?? settings.bossModel ?? "claude-opus-4-8";
  const preferredWorkerProvider = args.workerProvider ?? settings.workerProvider ?? "anthropic";
  const preferredWorkerModel = args.workerModel ?? settings.workerModel ?? "claude-sonnet-4-6";

  // Fall back to a logged-in provider instead of crashing when the saved
  // Manager/worker provider isn't authenticated (matches Kleio Coder startup).
  const {
    bossProvider: finalBossProvider,
    bossModel: finalBossModel,
    workerProvider: finalWorkerProvider,
    workerModel: finalWorkerModel,
    fellBack,
  } = await resolveBossAuth({
    bossProvider: preferredBossProvider,
    bossModel: preferredBossModel,
    workerProvider: preferredWorkerProvider,
    workerModel: preferredWorkerModel,
  });
  if (fellBack) {
    log("INFO", "cli", "provider fallback", {
      preferredBoss: preferredBossProvider,
      boss: finalBossProvider,
      preferredWorker: preferredWorkerProvider,
      worker: finalWorkerProvider,
    });
  }

  // Open ~/.gg/boss/debug.log in append mode and stamp a startup line so
  // future tail/grep diagnoses have the full session context up front.
  initLogger({
    version: VERSION,
    bossProvider: finalBossProvider,
    bossModel: finalBossModel,
    bossThinking: settings.bossThinkingLevel,
    workerProvider: finalWorkerProvider,
    workerModel: finalWorkerModel,
    projectCount: args.projects.length,
  });
  log("INFO", "cli", "linked projects", {
    projects: args.projects.map((p) => p.name).join(","),
  });
  setStreamDiagnostic((phase, data) => {
    log("INFO", "stream", phase, data as Record<string, unknown>);
  });

  // Auto-update: instantly applies any pending install from the prior run
  // (background spawn, takes effect next launch) and schedules a fresh
  // registry check. Returns a one-liner if an install just kicked off so
  // we can surface it before the splash takes over.
  const updateMessage = checkAndAutoUpdate(VERSION);
  if (updateMessage) log("INFO", "auto_update", updateMessage);

  const boss = new KleioManager({
    bossProvider: finalBossProvider,
    bossModel: finalBossModel,
    bossThinkingLevel: settings.bossThinkingLevel,
    workerProvider: finalWorkerProvider,
    workerModel: finalWorkerModel,
    projects: args.projects,
    continueRecent: args.continueRecent,
    resumeSessionId: args.resumeSessionId,
  });

  await boss.initialize();
  await splash.dismiss();

  clearScreen();

  const ink = renderBossApp({ boss });

  // Don't register process.on("SIGINT") here. Ink puts stdin in raw mode, so
  // Ctrl+C is delivered as a byte (0x03) to InputArea — not as a process
  // signal. Registering SIGINT would race InputArea's onAbort and exit
  // immediately on the first press, breaking the double-press exit flow.

  // Run Manager in the background; await the Ink unmount triggered when the
  // user double-presses Ctrl+C.
  const runPromise = boss.run();
  await ink.waitUntilExit();
  await boss.dispose();
  // Kill any in-flight radio stream before exiting — otherwise the detached
  // mpv/ffplay child keeps playing after the user closes Kleio Manager.
  stopRadio();
  await runPromise.catch(() => {});
  process.exit(0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${MANAGER_DISPLAY_NAME} v${VERSION}\n`);
    return;
  }

  if (argv[0] === "link") {
    await runLinkCommand();
    process.exit(0);
  }

  if (argv[0] === "telegram") {
    await runBossTelegramSetup();
    process.exit(0);
  }

  if (argv[0] === "serve") {
    await runServeSubcommand(argv.slice(1));
    return;
  }

  // `kleio-manager continue` resumes the latest session under either bin alias.
  // Accept any flags after `continue` as normal flag args.
  const isContinue = argv[0] === "continue";
  const args = parseArgs(isContinue ? argv.slice(1) : argv);
  if (isContinue) args.continueRecent = true;
  await runOrchestrator(args);
}

// Process-level error guards. With ~6 workers sharing the same Node process,
// any uncaught throw or unhandled rejection would otherwise take the whole
// orchestrator down — losing every worker's in-flight task. We log the
// failure to ~/.gg/boss/debug.log (already initialized by this point) and
// keep running. Truly unrecoverable conditions (OOM, native segfault) still
// kill the process; nothing JS-side can guard against those.
process.on("uncaughtException", (err) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log("ERROR", "uncaught_exception", message, { stack });
  // Keep Kleio Manager running; any worker in a bad state surfaces the issue
  // via worker_error on its next interaction. This is less disruptive than
  // terminating every in-flight worker.
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  log("ERROR", "unhandled_rejection", message, { stack });
  // Same rationale as uncaughtException — log and survive.
});

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.hex(COLORS.error)(`\n${MANAGER_DISPLAY_NAME} failed: ${message}\n`));
  process.exit(1);
});
