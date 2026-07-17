#!/usr/bin/env node

// Catch stray abort-related promise rejections that escape the normal error
// handling chain (Ctrl+C race conditions, mid-stream tool aborts). Node 25+
// crashes the process on any unhandled rejection without this.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error) {
    const msg = reason.message.toLowerCase();
    if (reason.name === "AbortError" || msg.includes("aborted") || msg.includes("abort")) {
      return;
    }
  }
  throw reason;
});

// Drain ALL performance entries to prevent unbounded memory growth.
// Node emits entries for marks, measures, resource timing (HTTP), DNS, net,
// etc. Without clearing, these accumulate across every LLM call and tool
// execution — hits the 1M cap with the
// `MaxPerformanceEntryBufferExceededWarning` after a few hours of use.
// Mirrors the identical block in ggcoder/src/cli.ts.
import { PerformanceObserver, performance } from "node:perf_hooks";
{
  const allTypes = PerformanceObserver.supportedEntryTypes.filter(
    (t) => t !== "gc" && t !== "function",
  );
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      switch (entry.entryType) {
        case "measure":
          performance.clearMeasures(entry.name);
          break;
        case "mark":
          performance.clearMarks(entry.name);
          break;
        case "resource":
          performance.clearResourceTimings();
          break;
      }
    }
  }).observe({ entryTypes: allTypes });
}

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import { getDefaultModel } from "@kleio/coder/models";
import type { Message, Provider } from "@kleio/ai";
import {
  AuthStorage,
  NotLoggedInError,
  runLogin,
  runLogout,
  runStatus,
  type SupportedAuthProvider,
} from "./core/auth/index.js";
import { isOnboarded, onboardedMarkerPath } from "./core/doctor.js";
import { runDoctorInteractive } from "./core/doctor-runner.js";
import { closeLogger, defaultLogPath, initLogger, logError, logInfo } from "./core/logger.js";
import { getPackageVersion } from "./core/version.js";
import { discoverSkills } from "./core/skills-loader.js";
import { discoverStyles } from "./core/styles-loader.js";
import { SKILLS } from "./skills.js";
import { createLazyHost } from "./core/hosts/lazy.js";
import { hasLastSession, loadLastSession } from "./core/sessions.js";
import { buildEditorStaticBody, buildEditorSystemPrompt } from "./system-prompt.js";
import { createEditorTools } from "./tools/index.js";
import { renderEditorTui } from "./ui/render.js";

/** Auto-pick order — same priority ggcoder uses for default-provider selection. */
const PROVIDER_ORDER: SupportedAuthProvider[] = [
  "anthropic",
  "openai",
  "glm",
  "moonshot",
  "xiaomi",
  "minimax",
  "deepseek",
  "openrouter",
];

function parseProviderArg(arg: string | undefined): SupportedAuthProvider | undefined {
  if (!arg) return undefined;
  return (PROVIDER_ORDER as string[]).includes(arg) ? (arg as SupportedAuthProvider) : undefined;
}

function fail(msg: string): never {
  process.stderr.write(chalk.red(`error: ${msg}\n`));
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(`ggeditor — video editor agent for DaVinci Resolve and Premiere Pro

USAGE
  ggeditor           Launch the editor (auto-detects open NLE)
  ggeditor continue  Resume the most recent session
  ggeditor login     Authenticate
  ggeditor logout    Clear credentials
  ggeditor auth      Show stored credentials
  ggeditor doctor    Walk through environment fixes (--all to view inventory)
  ggeditor logs      Print the path to ~/.gg/ggeditor.log (use with tail -f)

Auth lives in ~/.gg/auth.json — the SAME file ggcoder uses, so logging into
either CLI works for both.

Debug logs are appended to ~/.gg/ggeditor.log — includes Python bridge
spawn/handshake/exit events and every Resolve method call with timing.
Tail it live: tail -f ~/.gg/ggeditor.log
`);
}

/**
 * Mark the current home as onboarded so we don't re-run the doctor on
 * subsequent launches. Called after a first-run doctor pass succeeds.
 */
function markOnboarded(): void {
  const path = onboardedMarkerPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, new Date().toISOString() + "\n", "utf8");
  } catch {
    // Non-fatal — we'll just re-run onboarding next time.
  }
}

async function pickProvider(auth: AuthStorage): Promise<SupportedAuthProvider | undefined> {
  for (const p of PROVIDER_ORDER) {
    if (await auth.hasCredentials(p)) return p;
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  if (sub === "-h" || sub === "--help") {
    printHelp();
    return;
  }
  if (sub === "login") {
    await runLogin();
    return;
  }
  if (sub === "logout") {
    await runLogout(parseProviderArg(args[1]));
    return;
  }
  if (sub === "auth" || sub === "status") {
    await runStatus();
    return;
  }
  if (sub === "doctor") {
    const all = args.includes("--all") || args.includes("-a");
    const yes = args.includes("--yes") || args.includes("-y");
    await runDoctorInteractive({ all, nonInteractive: yes });
    return;
  }
  if (sub === "logs") {
    process.stdout.write(`${defaultLogPath()}\n`);
    return;
  }

  const isContinue = sub === "continue";
  if (sub && !isContinue) {
    fail(`unknown command: ${sub}\nrun: ggeditor --help`);
  }

  // ── Bare `ggeditor` (or `ggeditor continue`) — interactive TUI ────────

  if (!process.stdin.isTTY) {
    fail("ggeditor requires an interactive terminal");
  }

  // First-run onboarding — only when the marker doesn't exist. Walks
  // the user through every actionable item, offering Y/N confirms for
  // anything we know how to install via a package manager.
  if (!isOnboarded()) {
    await runDoctorInteractive({ onboarding: true });
    markOnboarded();
  }

  const auth = new AuthStorage();
  await auth.load();
  const provider = await pickProvider(auth);
  if (!provider) {
    process.stderr.write(
      chalk.red("Not logged in.\n") +
        chalk.dim("Run: ggeditor login\n\n") +
        chalk.dim(
          "(Auth is shared with ggcoder via ~/.gg/auth.json — log in once, both CLIs work.)\n",
        ),
    );
    process.exit(1);
  }

  let token: string;
  try {
    token = await auth.resolveToken(provider);
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      process.stderr.write(chalk.red(`${e.message}\n`));
      process.exit(1);
    }
    fail(`auth refresh failed: ${(e as Error).message}`);
  }
  const accountId = (await auth.getCredentials(provider))?.accountId;

  // Resume support — if `continue`, load prior messages.
  let priorMessages: Message[] = [];
  if (isContinue) {
    if (!(await hasLastSession())) {
      process.stderr.write(
        chalk.yellow("No previous session to continue.\n") +
          chalk.dim("Run `ggeditor` to start a new one.\n"),
      );
      process.exit(1);
    }
    const last = await loadLastSession();
    if (last) priorMessages = last.messages;
  }

  // Pick the right model for this provider via ggcoder's registry.
  const model = getDefaultModel(provider as Provider).id;

  // All providers the user has logged into — used by /model selector.
  // Same set ggcoder supports.
  const allProviders = await auth.listProviders();
  const loggedInProviders = allProviders.filter((p): p is Provider =>
    (PROVIDER_ORDER as string[]).includes(p),
  ) as Provider[];

  // Initialize debug logger before host detection so the first detection
  // line lands in the log. ~/.gg/ggeditor.log, append-mode across sessions.
  initLogger(defaultLogPath(), {
    version: getPackageVersion(),
    provider,
    model,
  });

  // Lazy host: re-detects on every tool call (cached for 2s) so opening
  // Resolve / Premiere mid-session is picked up without restarting.
  const host = createLazyHost();
  const caps = await host.capabilities();
  const cwd = process.cwd();
  logInfo("startup", "caps", {
    host: host.name,
    available: caps.isAvailable,
    reason: caps.unavailableReason,
  });

  const skills = discoverSkills({ cwd, bundled: Object.values(SKILLS) });
  const styles = discoverStyles({ cwd });
  // Static body is host-independent and cached for the session. The host
  // block is spliced in at startup and re-spliced by App.tsx whenever the
  // user opens / closes their NLE.
  const staticPromptBody = buildEditorStaticBody(cwd, { skills, styles });
  const system = await buildEditorSystemPrompt(host, cwd, { skills, styles });
  const reviewConfig =
    provider === "anthropic" ||
    provider === "openai" ||
    provider === "glm" ||
    provider === "moonshot"
      ? { provider, model, apiKey: token, maxTurns: 10 }
      : undefined;
  const tools = createEditorTools({ host, cwd, reviewConfig, skills });

  const cleanup = () => {
    host.shutdown();
    closeLogger();
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("exit", cleanup);

  await renderEditorTui({
    provider: provider as Provider,
    model,
    apiKey: token,
    accountId,
    // OAuth tokens expire mid-session (Anthropic ~8h, OpenAI shorter). Without
    // this callback, useAgentLoop reuses the startup token forever — the next
    // turn after expiry returns 401 and the CLI dies. Re-resolve before each
    // turn (and on 401 retry with forceRefresh) using whatever provider the
    // user has currently selected via /model.
    resolveCredentials: async (p, opts) => {
      const c = await auth.resolveCredentials(p as SupportedAuthProvider, opts);
      return { apiKey: c.accessToken, accountId: c.accountId };
    },
    tools,
    systemPrompt: system,
    staticPromptBody,
    host,
    priorMessages,
    loggedInProviders,
    hostName: host.name,
    hostDisplayName: host.displayName,
    hostAvailable: caps.isAvailable,
    hostReason: caps.unavailableReason,
    cwd,
    version: getPackageVersion(),
    persistSessions: true,
    onShutdown: cleanup,
  });
  cleanup();
}

main().catch((e) => {
  const err = e as Error;
  logError("fatal", err.message, { stack: err.stack });
  closeLogger();
  process.stderr.write(chalk.red(`\nFatal: ${err.message}\n`));
  process.exit(1);
});
