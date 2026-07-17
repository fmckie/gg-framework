import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { renderLoginSelector } from "@kleio/coder/ui/login";
import { AuthStorage, loginAnthropic, loginOpenAI, type OAuthCredentials } from "@kleio/coder/auth";
import { openBrowser } from "@kleio/coder/utils/open-browser";
import { STATIC_KEY_PROVIDERS, type SupportedAuthProvider } from "./types.js";

/**
 * Editor brand palette — same warm sunset used by the main TUI. Applied to
 * every screen ggeditor renders (login selector, status output, login flow
 * messages) so the look is consistent and clearly distinct from Kleio Coder.
 */
const EDITOR_PRIMARY = "#f97316"; // orange-500
const EDITOR_ACCENT = "#ec4899"; // pink-500
const EDITOR_GRADIENT = [
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

const orange = chalk.hex(EDITOR_PRIMARY);
const pink = chalk.hex(EDITOR_ACCENT);

/**
 * Interactive `ggeditor login` flow. Uses the shared Ink-based provider
 * selector with the editor's warm palette + brand. Credentials saved to
 * ~/.gg/auth.json — same file Kleio Coder uses, so logging in via either CLI
 * works for both.
 */
export async function runLogin(opts: { provider?: SupportedAuthProvider } = {}): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("ggeditor login requires an interactive terminal");
  }
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

  let provider: SupportedAuthProvider;
  if (opts.provider) {
    provider = opts.provider;
  } else {
    const { getPackageVersion } = await import("../version.js");
    const picked = await renderLoginSelector({
      brand: "GG Editor",
      version: getPackageVersion(),
      gradient: EDITOR_GRADIENT,
      primary: EDITOR_PRIMARY,
      accent: EDITOR_ACCENT,
    });
    if (!picked) {
      process.stdout.write(chalk.dim("Login cancelled.\n"));
      return;
    }
    provider = picked as SupportedAuthProvider;
  }

  process.stdout.write(chalk.bold("\nLogging in to ") + pink(displayName(provider)) + "\n\n");

  let creds: OAuthCredentials;
  if (provider === "anthropic") {
    creds = await loginAnthropic(makeCallbacks());
  } else if (provider === "openai") {
    creds = await loginOpenAI(makeCallbacks());
  } else {
    creds = await promptApiKeyCreds(provider);
  }

  const storage = new AuthStorage();
  await storage.setCredentials(provider, creds);

  process.stdout.write(
    orange(`\n✓ Logged in to ${displayName(provider)}.\n`) +
      chalk.dim(`  Credentials saved to ${storage.path}\n`) +
      chalk.dim("  (Same file Kleio Coder uses — both CLIs share auth.)\n"),
  );
}

function displayName(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "glm":
      return "Z.AI (GLM)";
    case "moonshot":
      return "Moonshot (Kimi)";
    case "xiaomi":
      return "Xiaomi (MiMo)";
    case "minimax":
      return "MiniMax";
    case "deepseek":
      return "DeepSeek";
    case "openrouter":
      return "OpenRouter";
    default:
      return provider;
  }
}

async function promptApiKeyCreds(provider: SupportedAuthProvider): Promise<OAuthCredentials> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const key = (await rl.question(orange(`Paste your ${provider} API key: `))).trim();
    if (!key) throw new Error("empty API key");
    return {
      accessToken: key,
      refreshToken: "",
      expiresAt: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000, // ~100y, never refreshes
    };
  } finally {
    rl.close();
  }
}

function makeCallbacks() {
  return {
    onOpenUrl: (url: string) => {
      process.stdout.write(chalk.dim("\nOpening browser:\n  ") + url + "\n\n");
      openBrowser(url);
    },
    onPromptCode: async (message: string): Promise<string> => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return (await rl.question(orange(`${message} `))).trim();
      } finally {
        rl.close();
      }
    },
    onStatus: (msg: string) => {
      process.stdout.write(chalk.dim(`  ${msg}\n`));
    },
  };
}

export async function runLogout(provider?: SupportedAuthProvider): Promise<void> {
  const storage = new AuthStorage();
  await storage.load();
  if (provider) {
    await storage.clearCredentials(provider);
    process.stdout.write(orange(`✓ Logged out of ${displayName(provider)}\n`));
    return;
  }
  const providers = await storage.listProviders();
  for (const p of providers) await storage.clearCredentials(p);
  process.stdout.write(orange(`✓ Cleared all credentials (${providers.length})\n`));
}

export async function runStatus(): Promise<void> {
  const storage = new AuthStorage();
  await storage.load();
  const providers = await storage.listProviders();

  const { renderCliBanner } = await import("../cli-banner.js");
  const { getPackageVersion } = await import("../version.js");
  process.stdout.write(
    renderCliBanner({
      version: getPackageVersion(),
      screen: "Auth",
      subtitle: storage.path,
    }),
  );

  if (providers.length === 0) {
    process.stdout.write(chalk.yellow("  No credentials stored. Run `ggeditor login`.\n"));
    return;
  }

  for (const p of providers) {
    const c = await storage.getCredentials(p);
    if (!c) continue;
    const isStatic = STATIC_KEY_PROVIDERS.has(p as SupportedAuthProvider);
    const expires = isStatic ? "—" : new Date(c.expiresAt).toLocaleString();
    const valid = isStatic || Date.now() < c.expiresAt;
    const tag = isStatic ? "api-key" : valid ? "valid" : "expired (will refresh)";
    const tagColored = isStatic ? chalk.dim(tag) : valid ? chalk.green(tag) : chalk.yellow(tag);
    process.stdout.write(
      `  ${pink(p.padEnd(11))} ${tagColored.padEnd(28)}  ${chalk.dim(`expires: ${expires}`)}\n`,
    );
  }
  process.stdout.write("\n");
}
