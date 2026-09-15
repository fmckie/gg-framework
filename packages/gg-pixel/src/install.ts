import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

import type * as BabelParser from "@babel/parser";
import type * as BabelTypes from "@babel/types";
import type * as Recast from "recast";

const nodeRequire = createRequire(import.meta.url);

export const DEFAULT_INGEST_URL = "https://gg-pixel-server.buzzbeamaustralia.workers.dev";

export interface InstallOptions {
  cwd?: string;
  ingestUrl?: string;
  projectName?: string;
  fetchFn?: typeof fetch;
  skipPackageInstall?: boolean;
  homeDir?: string;
}

export interface InstallResult {
  projectId: string;
  projectKey: string;
  /**
   * Per-project bearer secret returned by the server on creation. Stored in
   * ~/.gg/projects.json and required for every /api/* call (read/list/patch/
   * delete). Never leaves the user's machine — never inlined into source.
   */
  projectSecret: string;
  projectName: string;
  projectKind: ProjectKind;
  /** Resolved root of the user's project (the dir containing package.json /
   *  pyproject.toml / go.mod / Gemfile, depending on kind). Needed by the
   *  verifier so it can spawn a probe child from the right cwd. */
  projectRoot: string;
  initFilePath: string;
  envFilePath: string;
  projectsJsonPath: string;
  packageManager: PackageManager | PythonPackageManager;
  packageInstalled: boolean;
  entryWiring: EntryWiringResult;
  /** True when an existing project mapping was reused instead of minting a fresh one. */
  reused: boolean;
  /** Hybrid frameworks: a second init file (e.g. server-side for Next.js). */
  secondaryInit?: { path: string; description: string };
  /** Honest disclaimers — surfaced in the CLI summary. */
  warnings: string[];
}

export type EntryWiringResult =
  | { kind: "injected"; entryPath: string }
  | { kind: "already_present"; entryPath: string }
  | { kind: "no_entry_found" }
  | { kind: "skipped"; reason: string };

interface PackageJson {
  name?: string;
  type?: string;
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  browser?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export type ProjectKind =
  | "node"
  | "browser"
  | "python"
  | "nextjs"
  | "sveltekit"
  | "nuxt"
  | "remix"
  | "electron"
  | "tauri"
  | "react-native"
  | "cloudflare-workers"
  | "go"
  | "ruby";

export type PythonPackageManager = "uv" | "poetry" | "pipenv" | "pip";

export async function install(opts: InstallOptions = {}): Promise<InstallResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const ingestUrl = (opts.ingestUrl ?? DEFAULT_INGEST_URL).replace(/\/+$/, "");
  const fetchFn = opts.fetchFn ?? fetch;
  const home = opts.homeDir ?? homedir();

  // Detect project kind. We pick the closest (deepest) root when multiple
  // markers exist — polyglot monorepos commonly have everything at root.
  const nodeRoot = findProjectRoot(cwd);
  const pythonRoot = findPythonProjectRoot(cwd);
  const goRoot = findGoProjectRoot(cwd);
  const rubyRoot = findRubyProjectRoot(cwd);

  if (!nodeRoot && !pythonRoot && !goRoot && !rubyRoot) {
    throw new Error(
      `No project found at ${cwd}: looked for package.json, pyproject.toml/setup.py/requirements.txt/Pipfile, go.mod, Gemfile/*.gemspec.`,
    );
  }

  const closestRoot = pickClosestRoot([nodeRoot, pythonRoot, goRoot, rubyRoot]);

  if (closestRoot === goRoot && goRoot) {
    return installGo({ projectRoot: goRoot, opts, ingestUrl, fetchFn, home });
  }
  if (closestRoot === rubyRoot && rubyRoot) {
    return installRuby({ projectRoot: rubyRoot, opts, ingestUrl, fetchFn, home });
  }
  if (closestRoot === pythonRoot && pythonRoot) {
    return installPython({ projectRoot: pythonRoot, opts, ingestUrl, fetchFn, home });
  }

  // Node / browser / hybrid framework path.
  if (!nodeRoot) {
    throw new Error("Internal: closest root is Node but nodeRoot is null");
  }
  const pkgPath = join(nodeRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  const projectName = opts.projectName ?? pkg.name ?? nodeRoot.split("/").pop() ?? "unnamed";
  const kind = detectJsProjectKind(pkg, nodeRoot);

  const projectsJsonPath = join(home, ".gg", "projects.json");
  const envFilePath = join(nodeRoot, ".env");

  const existing = findMappingByPath(projectsJsonPath, nodeRoot);
  const existingKey = readEnvKey(envFilePath, "GG_PIXEL_KEY");
  let created: CreatedProject;
  let reused = false;
  // Reusing requires *all three* — id, publishable key, and the secret —
  // because the secret is now mandatory for every management call. If any
  // is missing (e.g. legacy install before secrets existed), mint fresh.
  if (existing && existing.secret && existingKey) {
    created = { id: existing.id, key: existingKey, secret: existing.secret };
    reused = true;
  } else {
    created = await createProject(fetchFn, ingestUrl, projectName);
  }

  const pm = detectPackageManager(nodeRoot);
  const packageInstalled = opts.skipPackageInstall
    ? false
    : runInstall(nodeRoot, pm, "@kenkaiiii/gg-pixel");

  // Dispatch to per-framework wiring.
  const wired = wireFramework({
    kind,
    projectRoot: nodeRoot,
    pkg,
    projectKey: created.key,
    ingestUrl,
  });

  // .env: write the key for runtimes that read it from process.env (Node servers,
  // Electron main, Next.js server, etc). Pure browser apps don't need it (key
  // is inlined into the init file).
  if (kind !== "browser" && kind !== "tauri") {
    writeEnvKey(envFilePath, "GG_PIXEL_KEY", created.key);
  }

  writeProjectsMapping(projectsJsonPath, created.id, projectName, nodeRoot, created.secret);

  return {
    projectId: created.id,
    projectKey: created.key,
    projectSecret: created.secret,
    projectName,
    projectKind: kind,
    projectRoot: nodeRoot,
    initFilePath: wired.primaryInitPath,
    envFilePath,
    projectsJsonPath,
    packageManager: pm,
    packageInstalled,
    entryWiring: wired.entryWiring,
    reused,
    secondaryInit: wired.secondaryInit,
    warnings: wired.warnings,
  };
}

interface CreatedProject {
  id: string;
  key: string;
  secret: string;
}

function findMappingByPath(
  projectsJsonPath: string,
  projectRoot: string,
): { id: string; name: string; path: string; secret?: string } | null {
  if (!existsSync(projectsJsonPath)) return null;
  let map: Record<string, { name: string; path: string; secret?: string }>;
  try {
    map = JSON.parse(readFileSync(projectsJsonPath, "utf8")) as typeof map;
  } catch {
    return null;
  }
  // If the same path appears in multiple entries (e.g. legacy entries from a
  // pre-secret install plus a newer entry from a re-install), prefer the
  // entry that has a secret — otherwise the install logic falls into the
  // "no secret stored" branch and mints yet another fresh project.
  let fallback: { id: string; name: string; path: string; secret?: string } | null = null;
  for (const [id, entry] of Object.entries(map)) {
    if (entry.path !== projectRoot) continue;
    if (entry.secret) return { id, ...entry };
    if (!fallback) fallback = { id, ...entry };
  }
  return fallback;
}

function readEnvKey(envPath: string, key: string): string | null {
  if (!existsSync(envPath)) return null;
  try {
    const content = readFileSync(envPath, "utf8");
    const match = new RegExp(`^${key}=(.+)$`, "m").exec(content);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function findProjectRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

async function createProject(
  fetchFn: typeof fetch,
  ingestUrl: string,
  name: string,
): Promise<CreatedProject> {
  const res = await fetchFn(`${ingestUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/projects failed: ${res.status} ${await safeText(res)}`);
  }
  const body = (await res.json()) as { id: string; key: string; secret: string };
  if (!body.id || !body.key || !body.secret) {
    throw new Error("response missing id/key/secret");
  }
  return { id: body.id, key: body.key, secret: body.secret };
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

export function detectPackageManager(projectRoot: string): PackageManager {
  if (existsSync(join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  // Bun 1.2+ defaults to the text-based `bun.lock`; older versions used the
  // binary `bun.lockb`. Either lockfile means this is a Bun project — falling
  // through to npm partially mutates `node_modules` in a layout incompatible
  // with `bun.lock`, leaving the user to rm -rf and re-bun-install to recover.
  if (existsSync(join(projectRoot, "bun.lock")) || existsSync(join(projectRoot, "bun.lockb"))) {
    return "bun";
  }
  if (existsSync(join(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

function runInstall(projectRoot: string, pm: PackageManager, pkg: string): boolean {
  const cmd = pm;
  // npm prints `npm audit` warnings + `npm fund` solicitations on every install.
  // That output is about the user's *existing* project — irrelevant to pixel.
  // The other package managers don't show this noise by default.
  const args = pm === "npm" ? ["install", pkg, "--no-audit", "--no-fund"] : ["add", pkg];
  const result = spawnSync(cmd, args, { cwd: projectRoot, stdio: "inherit" });
  return result.status === 0;
}

export function renderInitFile(ingestUrl: string, projectKey?: string): string {
  const fallback = projectKey ? ` || ${JSON.stringify(projectKey)}` : "";
  return `import { initPixel } from "@kenkaiiii/gg-pixel";

const key = process.env.GG_PIXEL_KEY${fallback};
if (key) {
  initPixel({
    projectKey: key,
    sink: { kind: "http", ingestUrl: ${JSON.stringify(`${ingestUrl}/ingest`)} },
  });
}
`;
}

export function renderInitFileCjs(ingestUrl: string, projectKey?: string): string {
  const fallback = projectKey ? ` || ${JSON.stringify(projectKey)}` : "";
  return `const { initPixel } = require("@kenkaiiii/gg-pixel");

const key = process.env.GG_PIXEL_KEY${fallback};
if (key) {
  initPixel({
    projectKey: key,
    sink: { kind: "http", ingestUrl: ${JSON.stringify(`${ingestUrl}/ingest`)} },
  });
}
`;
}

export function writeEnvKey(envPath: string, key: string, value: string): void {
  if (existsSync(envPath)) {
    const current = readFileSync(envPath, "utf8");
    const lineRegex = new RegExp(`^${key}=.*$`, "m");
    if (lineRegex.test(current)) {
      writeFileSync(envPath, current.replace(lineRegex, `${key}=${value}`), "utf8");
      return;
    }
    const sep = current.endsWith("\n") || current.length === 0 ? "" : "\n";
    appendFileSync(envPath, `${sep}${key}=${value}\n`, "utf8");
    return;
  }
  writeFileSync(envPath, `${key}=${value}\n`, "utf8");
}

export function wireEntryFile(
  projectRoot: string,
  initFilePath: string,
  pkg: PackageJson,
): EntryWiringResult {
  const entryPath = findEntryFile(projectRoot, pkg);
  if (!entryPath) return { kind: "no_entry_found" };

  let content: string;
  try {
    content = readFileSync(entryPath, "utf8");
  } catch (err) {
    return { kind: "skipped", reason: `unreadable: ${(err as Error).message}` };
  }

  if (content.includes("gg-pixel.init")) {
    return { kind: "already_present", entryPath };
  }

  // Compute import specifier relative to the entry file.
  const fromDir = dirname(entryPath);
  let spec = relative(fromDir, initFilePath).split(sep).join("/");
  if (!spec.startsWith(".")) spec = "./" + spec;

  const isCjs = isCommonJsEntry(entryPath, pkg);
  const importLine = isCjs
    ? `require(${JSON.stringify(spec)});`
    : `import ${JSON.stringify(spec)};`;

  // Inject at the top — after a shebang line and any leading "use strict",
  // but before all other code, so pixel hooks run before anything else.
  const lines = content.split("\n");
  let insertAt = 0;
  if (lines[0]?.startsWith("#!")) insertAt = 1;
  while (
    insertAt < lines.length &&
    /^\s*(?:["']use strict["']|\/\/|\/\*)/.test(lines[insertAt] ?? "")
  ) {
    insertAt++;
  }

  const updated = [...lines.slice(0, insertAt), importLine, ...lines.slice(insertAt)].join("\n");
  writeFileSync(entryPath, updated, "utf8");
  return { kind: "injected", entryPath };
}

function findEntryFile(projectRoot: string, pkg: PackageJson): string | null {
  const tryPath = (rel: string): string | null => {
    const p = join(projectRoot, rel);
    if (existsSync(p)) return p;
    // If user pointed `main` at .js but only the .ts source exists (common in TS projects).
    if (rel.endsWith(".js")) {
      const ts = join(projectRoot, rel.replace(/\.js$/, ".ts"));
      if (existsSync(ts)) return ts;
    }
    return null;
  };

  if (typeof pkg.bin === "string") {
    const found = tryPath(pkg.bin);
    if (found) return found;
  }
  if (pkg.bin && typeof pkg.bin === "object") {
    for (const value of Object.values(pkg.bin)) {
      if (typeof value === "string") {
        const found = tryPath(value);
        if (found) return found;
      }
    }
  }
  if (pkg.main) {
    const found = tryPath(pkg.main);
    if (found) return found;
  }
  if (pkg.module) {
    const found = tryPath(pkg.module);
    if (found) return found;
  }

  // Fall back to common conventions.
  const candidates = [
    "src/index.ts",
    "src/index.tsx",
    "src/index.js",
    "src/index.mjs",
    "src/main.ts",
    "src/main.tsx",
    "src/main.js",
    "src/server.ts",
    "src/server.js",
    "src/app.ts",
    "src/app.js",
    "src/cli.ts",
    "src/cli.js",
    "index.ts",
    "index.tsx",
    "index.js",
    "index.mjs",
    "main.ts",
    "main.js",
    "server.ts",
    "server.js",
    "app.ts",
    "app.js",
  ];
  for (const c of candidates) {
    const found = tryPath(c);
    if (found) return found;
  }
  return null;
}

function isCommonJsEntry(entryPath: string, pkg: PackageJson): boolean {
  if (entryPath.endsWith(".cjs")) return true;
  if (entryPath.endsWith(".mjs")) return false;
  if (entryPath.endsWith(".ts") || entryPath.endsWith(".tsx")) return false;
  // .js → governed by package.json type (default is "commonjs")
  return pkg.type !== "module";
}

// ── Framework detection + wiring ────────────────────────────────────

export function detectJsProjectKind(pkg: PackageJson, projectRoot: string): ProjectKind {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  // Order matters: more specific first (Electron + React = electron, not browser).
  if (
    existsSync(join(projectRoot, "wrangler.toml")) ||
    existsSync(join(projectRoot, "wrangler.jsonc")) ||
    existsSync(join(projectRoot, "wrangler.json"))
  ) {
    return "cloudflare-workers";
  }
  if ("electron" in all) return "electron";
  if (existsSync(join(projectRoot, "src-tauri")) || "@tauri-apps/api" in all) return "tauri";
  if ("react-native" in all) return "react-native";
  if ("next" in all) return "nextjs";
  if ("@sveltejs/kit" in all) return "sveltekit";
  if ("nuxt" in all || "nuxt3" in all) return "nuxt";
  if ("@remix-run/react" in all || "@remix-run/node" in all) return "remix";
  if (isBrowserProject(pkg, projectRoot)) return "browser";
  return "node";
}

interface WiringInput {
  kind: ProjectKind;
  projectRoot: string;
  pkg: PackageJson;
  projectKey: string;
  ingestUrl: string;
}

interface WiringResult {
  primaryInitPath: string;
  entryWiring: EntryWiringResult;
  secondaryInit?: { path: string; description: string };
  warnings: string[];
}

function wireFramework(w: WiringInput): WiringResult {
  switch (w.kind) {
    case "node":
      return wireNode(w);
    case "browser":
      return wireBrowser(w);
    case "nextjs":
      return wireNextjs(w);
    case "sveltekit":
      return wireSveltekit(w);
    case "nuxt":
      return wireNuxt(w);
    case "remix":
      return wireRemix(w);
    case "electron":
      return wireElectron(w);
    case "tauri":
      return wireTauri(w);
    case "react-native":
      return wireReactNative(w);
    case "cloudflare-workers":
      return wireWorkers(w);
    case "python":
    case "go":
    case "ruby":
      throw new Error(`Internal: ${w.kind} should have been handled earlier`);
  }
}

function wireNode({ projectRoot, pkg, projectKey, ingestUrl }: WiringInput): WiringResult {
  const initPath = join(projectRoot, "gg-pixel.init.mjs");
  writeFileSync(initPath, renderInitFile(ingestUrl, projectKey), "utf8");
  return {
    primaryInitPath: initPath,
    entryWiring: wireEntryFile(projectRoot, initPath, pkg),
    warnings: [],
  };
}

function wireBrowser({ projectRoot, pkg, projectKey, ingestUrl }: WiringInput): WiringResult {
  const initPath = join(projectRoot, "gg-pixel.init.mjs");
  writeFileSync(initPath, renderBrowserInitFile(ingestUrl, projectKey), "utf8");
  return {
    primaryInitPath: initPath,
    entryWiring: wireEntryFile(projectRoot, initPath, pkg),
    warnings: [],
  };
}

function wireNextjs({ projectRoot, projectKey, ingestUrl }: WiringInput): WiringResult {
  // Next.js auto-loads `instrumentation.ts` for the server. No entry wiring needed.
  // For the client, we drop a registration script and import it from the root layout.
  const warnings: string[] = [];

  // ── Server: instrumentation.ts ─────────────
  const serverInitPath = pickPath(projectRoot, ["instrumentation.ts", "instrumentation.js"]);
  const finalServerPath = serverInitPath ?? join(projectRoot, "instrumentation.ts");
  writeNextInstrumentation(finalServerPath, ingestUrl, projectKey);

  // ── next.config: mark @kenkaiiii/gg-pixel as a server-external package
  //    so Next's bundler doesn't try to compile better-sqlite3 (a native
  //    module) when bundling API routes / Server Components.
  patchNextConfig(projectRoot);

  // ── Client: drop a Client Component that initializes pixel only on the
  //    browser, then render it from the root layout. We can't just import
  //    a `.mjs` from layout.tsx — server-side rendering of pages like
  //    /_not-found would evaluate `window.onerror = ...` and blow up.
  const clientInitPath = join(projectRoot, "gg-pixel.client.tsx");
  writeFileSync(clientInitPath, renderNextClientComponent(ingestUrl, projectKey), "utf8");

  const layoutPath = findNextLayout(projectRoot);
  let entryWiring: EntryWiringResult;
  if (!layoutPath) {
    warnings.push(
      'Could not auto-wire the Next.js client init — no app/layout.{tsx,jsx} or pages/_app.{tsx,jsx} found. Add `<GGPixelClient />` from "./gg-pixel.client" to your root layout/_app.',
    );
    entryWiring = { kind: "no_entry_found" };
  } else {
    entryWiring = injectNextClientComponent(layoutPath, clientInitPath);
  }

  return {
    primaryInitPath: clientInitPath,
    entryWiring,
    secondaryInit: {
      path: finalServerPath,
      description: "Next.js server instrumentation (auto-loaded by Next runtime)",
    },
    warnings,
  };
}

function writeNextInstrumentation(path: string, ingestUrl: string, projectKey?: string): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const cleaned = stripLegacyPixelContent(existing);
  const block = nextInstrumentationBlock(ingestUrl, projectKey);
  const next = upsertPixelBlock(cleaned, block);
  if (next !== existing) writeFileSync(path, next, "utf8");
}

function nextInstrumentationBlock(ingestUrl: string, projectKey?: string): string {
  const fallback = projectKey ? ` ?? ${JSON.stringify(projectKey)}` : "";
  return `// Next.js auto-loads this file on server start. Pixel hooks the
// uncaughtExceptionMonitor + unhandledRejection events for API routes,
// Server Components, and route handlers.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initPixel } = await import("@kenkaiiii/gg-pixel");
    initPixel({
      projectKey: process.env.GG_PIXEL_KEY${fallback},
      sink: { kind: "http", ingestUrl: ${JSON.stringify(`${ingestUrl}/ingest`)} },
    });
  }
}`;
}

function findNextLayout(projectRoot: string): string | null {
  const candidates = [
    "app/layout.tsx",
    "app/layout.jsx",
    "app/layout.ts",
    "src/app/layout.tsx",
    "src/app/layout.jsx",
    "pages/_app.tsx",
    "pages/_app.jsx",
    "src/pages/_app.tsx",
    "src/pages/_app.jsx",
  ];
  for (const c of candidates) {
    const p = join(projectRoot, c);
    if (existsSync(p)) return p;
  }
  return null;
}

function renderNextClientComponent(ingestUrl: string, projectKey: string): string {
  return `"use client";
// Client-only pixel init. Rendered from the root layout. The "use client"
// directive guarantees this module never executes during server-side
// rendering — \`window.onerror\` references would otherwise crash builds.
import { useEffect } from "react";
import { initPixel } from "@kenkaiiii/gg-pixel/browser";

let inited = false;

export default function GGPixelClient() {
  useEffect(() => {
    if (inited) return;
    inited = true;
    initPixel({
      projectKey: ${JSON.stringify(projectKey)},
      ingestUrl: ${JSON.stringify(ingestUrl)},
    });
  }, []);
  return null;
}
`;
}

function injectNextClientComponent(layoutPath: string, clientInitPath: string): EntryWiringResult {
  let content: string;
  try {
    content = readFileSync(layoutPath, "utf8");
  } catch (err) {
    return { kind: "skipped", reason: `unreadable: ${(err as Error).message}` };
  }
  if (content.includes("GGPixelClient") || content.includes("@kenkaiiii/gg-pixel")) {
    return { kind: "already_present", entryPath: layoutPath };
  }
  const fromDir = dirname(layoutPath);
  let spec = relative(fromDir, clientInitPath).split(sep).join("/");
  if (!spec.startsWith(".")) spec = "./" + spec;
  // Strip the .tsx extension for cleanest imports.
  spec = spec.replace(/\.tsx$/, "");

  // Try AST-first so we land <GGPixelClient /> as the first child of <body>
  // (i.e., a sibling of any auth-gate / provider tree wrapping {children}),
  // not deeply nested where it would only init after the gate resolves.
  const astResult = injectClientComponentViaAst(layoutPath, content, spec);
  if (astResult) return astResult;

  // Fallback: previous regex behaviour. Used when the file doesn't parse as
  // TSX (extremely rare — would require syntactically broken code) or when
  // we can't locate the JSX `<body>` element through the AST.
  return injectClientComponentViaRegex(layoutPath, content, spec);
}

/**
 * Parse the layout, find `<body>`, and prepend `<GGPixelClient />` to its
 * children list. Also adds the import. Uses recast so untouched code stays
 * byte-identical (only the inserted nodes are reformatted).
 *
 * Returns null on any AST issue so the caller can fall back to regex.
 */
function injectClientComponentViaAst(
  layoutPath: string,
  content: string,
  importSpec: string,
): EntryWiringResult | null {
  let recast: typeof Recast;
  let bp: typeof BabelParser;
  let bt: typeof BabelTypes;
  try {
    recast = nodeRequire("recast") as typeof Recast;
    bp = nodeRequire("@babel/parser") as typeof BabelParser;
    bt = nodeRequire("@babel/types") as typeof BabelTypes;
  } catch {
    return null;
  }

  let ast: ReturnType<typeof recast.parse>;
  try {
    ast = recast.parse(content, {
      parser: {
        parse: (src: string) =>
          bp.parse(src, {
            sourceType: "module",
            plugins: ["jsx", "typescript"],
            allowImportExportEverywhere: true,
            tokens: true,
          }),
      },
    });
  } catch {
    return null;
  }

  const program = (ast as { program: { body: Array<unknown> } }).program;
  if (!program || !Array.isArray(program.body)) return null;

  const bodyEl = findFirstJsxElementByName(ast, "body");
  if (!bodyEl) return null; // No <body> — let the regex fallback handle / warn.

  // 1. Prepend <GGPixelClient /> to <body>'s children. Use a JSXText with a
  //    newline so the output reads naturally even when recast reformats.
  const newComponent = bt.jsxElement(
    bt.jsxOpeningElement(bt.jsxIdentifier("GGPixelClient"), [], true),
    null,
    [],
    true,
  );
  const leadingText = bt.jsxText("\n        ");
  const trailingText = bt.jsxText("\n        ");
  bodyEl.children = [leadingText, newComponent, trailingText, ...bodyEl.children];

  // 2. Insert the import after the last existing import statement.
  const importDecl = bt.importDeclaration(
    [bt.importDefaultSpecifier(bt.identifier("GGPixelClient"))],
    bt.stringLiteral(importSpec),
  );
  const body = program.body as Array<{ type: string }>;
  let insertAt = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i]?.type === "ImportDeclaration") insertAt = i + 1;
  }
  body.splice(insertAt, 0, importDecl as unknown as { type: string });

  let out: string;
  try {
    out = recast.print(ast).code;
  } catch {
    return null;
  }
  writeFileSync(layoutPath, out, "utf8");
  return { kind: "injected", entryPath: layoutPath };
}

/**
 * Walks the AST and returns the first JSXElement whose opening name matches.
 * Uses string type checks rather than babel's typed predicates so we don't
 * have to coerce loosely-typed walkers through narrow predicate signatures.
 *
 * Recast's parsed AST isn't a clean Babel tree — it wraps nodes and attaches
 * `original`/`tokens`/`loc`/`comments` back-references that share substructure.
 * A naive recursive walker over `Object.keys` revisits those references and on
 * real Next.js root layouts (`<html><body>...</body></html>`) blows the stack.
 * Guard with a `WeakSet` of visited objects, a depth cap, and a skip-list for
 * the metadata keys that aren't part of the syntactic tree.
 */
export function findFirstJsxElementByName(
  ast: unknown,
  name: string,
): { children: unknown[] } | null {
  let found: { children: unknown[] } | null = null;
  const seen = new WeakSet<object>();
  const MAX_DEPTH = 500;
  const SKIP_KEYS = new Set([
    "loc",
    "tokens",
    "original",
    "comments",
    "leadingComments",
    "trailingComments",
    "innerComments",
    "range",
    "start",
    "end",
  ]);
  function walk(node: unknown, depth: number): void {
    if (found || !node || typeof node !== "object") return;
    if (depth > MAX_DEPTH) return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const c of node) walk(c, depth + 1);
      return;
    }
    const n = node as Record<string, unknown> & { type?: string };
    if (n.type === "JSXElement") {
      const opening = n.openingElement as
        { type?: string; name?: { type?: string; name?: string } } | undefined;
      if (opening?.type === "JSXOpeningElement" && opening.name) {
        const namedNode = opening.name;
        if (namedNode.type === "JSXIdentifier" && namedNode.name === name) {
          found = n as unknown as { children: unknown[] };
          return;
        }
      }
    }
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      walk(n[key], depth + 1);
    }
  }
  walk(ast, 0);
  return found;
}

function injectClientComponentViaRegex(
  layoutPath: string,
  content: string,
  spec: string,
): EntryWiringResult {
  const importLine = `import GGPixelClient from ${JSON.stringify(spec)};`;
  const lines = content.split("\n");
  let insertImportAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i] ?? "")) insertImportAt = i + 1;
  }
  lines.splice(insertImportAt, 0, importLine);

  const updated = lines.join("\n");
  const childrenIdx = updated.lastIndexOf("{children}");
  if (childrenIdx === -1) {
    writeFileSync(layoutPath, updated, "utf8");
    return {
      kind: "skipped",
      reason: "added import but couldn't find {children} to render <GGPixelClient />",
    };
  }
  const before = updated.slice(0, childrenIdx);
  const after = updated.slice(childrenIdx);
  const finalContent = before + "<GGPixelClient />\n        " + after;
  writeFileSync(layoutPath, finalContent, "utf8");
  return { kind: "injected", entryPath: layoutPath };
}

/**
 * Adds `@kenkaiiii/gg-pixel` to `serverExternalPackages` in the user's
 * next.config.{ts,mjs,js,cjs}. Required so Next's bundler doesn't statically
 * follow `better-sqlite3` (an optional native peer dep) when the SDK is
 * imported server-side.
 *
 * Uses `magicast` (Babel-backed AST surgery) so we handle the long tail of
 * config shapes the previous regex implementation mangled:
 *   - wrappers like `withSentryConfig(config)` / `withMDX({...})`
 *   - object spreads `{ ...baseConfig, foo: bar }`
 *   - `module.exports = function() { return {...}; }`
 *   - `satisfies NextConfig`, `as const`, generic type assertions
 *   - existing arrays containing comments or trailing commas
 *
 * Falls back to the original line-injection only when magicast can't load
 * the config (extremely rare — would require syntactically invalid JS/TS).
 */
function patchNextConfig(projectRoot: string): void {
  const candidates = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"];
  let configPath: string | null = null;
  for (const c of candidates) {
    const p = join(projectRoot, c);
    if (existsSync(p)) {
      configPath = p;
      break;
    }
  }
  if (!configPath) {
    configPath = join(projectRoot, "next.config.ts");
    writeFileSync(
      configPath,
      `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  // Keeps Next's bundler from trying to compile better-sqlite3 (native dep).\n  serverExternalPackages: ["@kenkaiiii/gg-pixel"],\n};\n\nexport default nextConfig;\n`,
      "utf8",
    );
    return;
  }
  patchNextConfigViaAst(configPath);
}

const PIXEL_PKG = "@kenkaiiii/gg-pixel";

function patchNextConfigViaAst(configPath: string): void {
  const original = readFileSync(configPath, "utf8");
  if (original.includes(PIXEL_PKG)) return; // already wired

  // Lazy require so the rest of install.ts doesn't pay the magicast import
  // cost for non-Next.js projects. magicast is in `dependencies` so it's
  // always installed; the require resolves synchronously.
  let parseModule: (code: string) => MagicastModule;
  let generateCode: (m: MagicastModule) => { code: string };
  try {
    const mod = nodeRequire("magicast") as {
      parseModule: typeof parseModule;
      generateCode: typeof generateCode;
    };
    parseModule = mod.parseModule;
    generateCode = mod.generateCode;
  } catch {
    return patchNextConfigViaRegex(configPath, original);
  }

  let module_: MagicastModule;
  try {
    module_ = parseModule(original);
  } catch {
    return patchNextConfigViaRegex(configPath, original);
  }

  // Resolve the config object regardless of how it's exported.
  const cfg = resolveNextConfigObject(module_);
  if (!cfg) {
    // Wrapped in a function call we can't unwrap (e.g. defineConfig(() => ({}))
    // returning a closure). Fall back to regex injection.
    return patchNextConfigViaRegex(configPath, original);
  }

  // Add to existing array, or create one. Magicast surfaces array nodes as
  // proxies that respond to `includes` / `push` regardless of source shape;
  // we cast through `unknown` because magicast's type surface for nested
  // values is intentionally loose.
  type ArrLike = { includes(v: string): boolean; push(v: string): void };
  const existing = cfg.serverExternalPackages as unknown;
  const isArrayLike =
    Array.isArray(existing) ||
    (typeof existing === "object" &&
      existing !== null &&
      (existing as { $type?: string }).$type === "array");
  if (isArrayLike) {
    const arr = existing as ArrLike;
    if (arr.includes(PIXEL_PKG)) return;
    arr.push(PIXEL_PKG);
  } else {
    cfg.serverExternalPackages = [PIXEL_PKG];
  }

  const out = generateCode(module_).code;
  if (out !== original) writeFileSync(configPath, out, "utf8");
}

/**
 * Walks the magicast module to find the NextConfig object literal, regardless
 * of whether the user wraps it in `withSomething(...)`, exports as `default`
 * vs CJS, or assigns to a const first. Returns the proxied object the caller
 * can mutate, or null if it's a function/expression we can't statically reach.
 */
interface MagicastObject {
  [key: string]: unknown;
  $type?: string;
  $args?: unknown[];
}
interface MagicastModule {
  exports: { default?: MagicastObject } & Record<string, MagicastObject | undefined>;
  $code?: string;
}

function resolveNextConfigObject(mod: MagicastModule): MagicastObject | null {
  const root: MagicastObject | undefined =
    mod.exports.default ?? (mod.exports as MagicastObject | undefined);
  if (!root) return null;
  return unwrapWrappers(root);
}

/**
 * Many real configs are `withSomething(realConfig)` (Sentry, MDX, PWA, bundle-
 * analyzer, etc.). Walk into the first object-literal argument we can find.
 * If the wrapper takes a function (`defineConfig(() => ({...}))`), we bail —
 * mutating closure bodies via magicast isn't reliable.
 */
function unwrapWrappers(node: MagicastObject): MagicastObject | null {
  let cur = node;
  for (let i = 0; i < 6; i++) {
    if (cur.$type === "function-call") {
      const args = cur.$args ?? [];
      const objArg = args.find(
        (a): a is MagicastObject =>
          typeof a === "object" && a !== null && (a as MagicastObject).$type !== "function-call",
      );
      if (!objArg) return null; // function-as-arg → can't mutate safely
      cur = objArg;
      continue;
    }
    if (cur.$type === "object" || cur.$type === undefined) return cur;
    return null;
  }
  return null;
}

function patchNextConfigViaRegex(configPath: string, content: string): void {
  if (content.includes(PIXEL_PKG)) return;
  if (content.includes("serverExternalPackages")) {
    const updated = content.replace(
      /serverExternalPackages\s*:\s*\[([^\]]*)\]/,
      (_match: string, inside: string) => {
        const trimmed = inside.trim();
        const sep = trimmed.length > 0 ? ", " : "";
        return `serverExternalPackages: [${trimmed}${sep}${JSON.stringify(PIXEL_PKG)}]`;
      },
    );
    if (updated !== content) writeFileSync(configPath, updated, "utf8");
    return;
  }
  const objStart =
    /(const\s+\w+\s*(?::\s*\w+)?\s*=\s*\{|module\.exports\s*=\s*\{|export\s+default\s*\{)/;
  const m = objStart.exec(content);
  if (m) {
    const insertAt = m.index + m[0].length;
    const updated =
      content.slice(0, insertAt) +
      `\n  serverExternalPackages: [${JSON.stringify(PIXEL_PKG)}],` +
      content.slice(insertAt);
    writeFileSync(configPath, updated, "utf8");
  }
}

function wireSveltekit({ projectRoot, projectKey, ingestUrl }: WiringInput): WiringResult {
  // SvelteKit auto-loads src/hooks.server.ts and src/hooks.client.ts.
  const serverPath = join(projectRoot, "src/hooks.server.ts");
  const clientPath = join(projectRoot, "src/hooks.client.ts");
  if (!existsSync(dirname(serverPath))) mkdirSync(dirname(serverPath), { recursive: true });

  upsertPixelBlockInFile(
    serverPath,
    `import { initPixel } from "@kenkaiiii/gg-pixel";
initPixel({
  projectKey: process.env.GG_PIXEL_KEY ?? ${JSON.stringify(projectKey)},
  sink: { kind: "http", ingestUrl: ${JSON.stringify(`${ingestUrl}/ingest`)} },
});`,
  );
  upsertPixelBlockInFile(
    clientPath,
    `import { initPixel } from "@kenkaiiii/gg-pixel/browser";
initPixel({
  projectKey: ${JSON.stringify(projectKey)},
  ingestUrl: ${JSON.stringify(ingestUrl)},
});`,
  );
  return {
    primaryInitPath: clientPath,
    entryWiring: { kind: "injected", entryPath: clientPath },
    secondaryInit: {
      path: serverPath,
      description: "SvelteKit server hooks (auto-loaded)",
    },
    warnings: [],
  };
}

function wireNuxt({ projectRoot, projectKey, ingestUrl }: WiringInput): WiringResult {
  // Nuxt auto-loads plugins/*.client.ts and plugins/*.server.ts.
  const pluginsDir = join(projectRoot, "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  const serverPath = join(pluginsDir, "gg-pixel.server.ts");
  const clientPath = join(pluginsDir, "gg-pixel.client.ts");
  writeFileSync(
    serverPath,
    `import { initPixel } from "@kenkaiiii/gg-pixel";\nexport default defineNuxtPlugin(() => {\n  initPixel({\n    projectKey: process.env.GG_PIXEL_KEY ?? ${JSON.stringify(projectKey)},\n    sink: { kind: "http", ingestUrl: ${JSON.stringify(`${ingestUrl}/ingest`)} },\n  });\n});\n`,
    "utf8",
  );
  writeFileSync(
    clientPath,
    `import { initPixel } from "@kenkaiiii/gg-pixel/browser";\nexport default defineNuxtPlugin(() => {\n  initPixel({\n    projectKey: ${JSON.stringify(projectKey)},\n    ingestUrl: ${JSON.stringify(ingestUrl)},\n  });\n});\n`,
    "utf8",
  );
  return {
    primaryInitPath: clientPath,
    entryWiring: { kind: "injected", entryPath: clientPath },
    secondaryInit: { path: serverPath, description: "Nuxt server plugin (auto-loaded)" },
    warnings: [],
  };
}

function wireRemix({ projectRoot, projectKey, ingestUrl }: WiringInput): WiringResult {
  // Remix uses app/entry.server.tsx and app/entry.client.tsx.
  const serverPath = pickPath(projectRoot, ["app/entry.server.tsx", "app/entry.server.jsx"]);
  const clientPath = pickPath(projectRoot, ["app/entry.client.tsx", "app/entry.client.jsx"]);
  const warnings: string[] = [];

  // Drop a small init module to import.
  const clientInitPath = join(projectRoot, "gg-pixel.client.mjs");
  writeFileSync(clientInitPath, renderBrowserInitFile(ingestUrl, projectKey), "utf8");

  if (clientPath) {
    injectImport(clientPath, clientInitPath);
  } else {
    warnings.push(
      "No app/entry.client.tsx found. Run `npx remix reveal` then re-run pixel install.",
    );
  }

  // Server-side: write a small init we import from entry.server.
  const serverInitPath = join(projectRoot, "gg-pixel.server.mjs");
  writeFileSync(serverInitPath, renderInitFile(ingestUrl), "utf8");
  let serverEntry: EntryWiringResult = { kind: "no_entry_found" };
  if (serverPath) {
    serverEntry = injectImport(serverPath, serverInitPath);
  } else {
    warnings.push(
      "No app/entry.server.tsx found. Run `npx remix reveal` then re-run pixel install.",
    );
  }
  void serverEntry;

  return {
    primaryInitPath: clientInitPath,
    entryWiring: clientPath
      ? { kind: "injected", entryPath: clientPath }
      : { kind: "no_entry_found" },
    secondaryInit: { path: serverInitPath, description: "Remix server init" },
    warnings,
  };
}

function wireElectron({ projectRoot, pkg, projectKey, ingestUrl }: WiringInput): WiringResult {
  const warnings: string[] = [];
  const isMainEsm = pkg.type === "module";
  const mainInitPath = isMainEsm
    ? join(projectRoot, "gg-pixel.main.mjs")
    : join(projectRoot, "gg-pixel.main.cjs");
  writeFileSync(
    mainInitPath,
    isMainEsm ? renderInitFile(ingestUrl, projectKey) : renderInitFileCjs(ingestUrl, projectKey),
    "utf8",
  );

  // ── Main entry resolution: pkg.main might point at compiled output
  //    (e.g. dist/main/index.js for TS-compiled apps like pocket-agent).
  //    We prefer the source file so the import survives `npm run build`.
  const mainEntry = resolveMainEntryFromPkg(projectRoot, pkg);
  let mainWiring: EntryWiringResult = { kind: "no_entry_found" };
  if (mainEntry && existsSync(mainEntry)) {
    mainWiring = injectImport(mainEntry, mainInitPath);
  }

  // ── Renderer: HTML-with-CSP apps use the IIFE bundle; module-system
  //    apps use the .mjs init.
  const htmlFiles = findRendererHtmlFiles(projectRoot);
  let rendererInitPath: string;
  if (htmlFiles.length > 0) {
    const rendererDir = dirname(htmlFiles[0]!);
    rendererInitPath = join(rendererDir, "gg-pixel.browser.iife.js");
    if (!copyIifeBundle(projectRoot, rendererInitPath)) {
      warnings.push(
        "Could not copy gg-pixel browser IIFE bundle — install @kenkaiiii/gg-pixel and re-run.",
      );
    }
    let wiredAny = false;
    for (const html of htmlFiles) {
      const r = patchRendererHtml(html, rendererInitPath, projectKey, ingestUrl);
      // Both "patched" (changed on disk) and "already" (no-op because the
      // file is up to date with the current key) count as success.
      if (r === "patched" || r === "already") wiredAny = true;
    }
    if (!wiredAny) {
      warnings.push(
        `Found HTML files in ${rendererDir} but couldn't patch any — they may have unusual CSP or no <head>.`,
      );
    }
  } else {
    rendererInitPath = join(projectRoot, "gg-pixel.renderer.mjs");
    writeFileSync(rendererInitPath, renderBrowserInitFile(ingestUrl, projectKey), "utf8");
    const rendererEntry = pickPath(projectRoot, [
      "src/renderer/index.ts",
      "src/renderer/index.tsx",
      "src/renderer/index.js",
      "src/renderer/main.ts",
      "src/renderer/main.tsx",
      "src/renderer/main.js",
      "renderer/index.ts",
      "renderer/index.tsx",
      "renderer/index.js",
      "renderer.ts",
      "renderer.tsx",
      "renderer.js",
      // `src/renderer.{ts,tsx,js}` is the convention used by multi-window
      // Electron apps that keep all renderer entries in src/.
      "src/renderer.ts",
      "src/renderer.tsx",
      "src/renderer.js",
      "src/index.tsx",
      "src/index.jsx",
      "src/main.tsx",
      "src/main.jsx",
    ]);
    if (rendererEntry) injectImport(rendererEntry, rendererInitPath);
    else
      warnings.push(
        'Could not auto-detect the Electron renderer entry. Add `import "./gg-pixel.renderer.mjs";` to the top of your renderer entry file.',
      );
  }

  return {
    primaryInitPath: rendererInitPath,
    entryWiring: { kind: "injected", entryPath: rendererInitPath },
    secondaryInit: {
      path: mainInitPath,
      description:
        "Electron main-process init" +
        (mainWiring.kind === "injected" ? ` (wired into ${mainEntry})` : ""),
    },
    warnings,
  };
}

function resolveMainEntryFromPkg(projectRoot: string, pkg: PackageJson): string | null {
  if (pkg.main) {
    const sourceCandidates: string[] = [];
    const main = pkg.main;
    // dist/X.js → src/X.ts (most common TS-compiled layout)
    if (/^(dist|build|\.next|out)\//.test(main)) {
      const swap = main.replace(/^(dist|build|\.next|out)\//, "src/");
      if (swap.endsWith(".js")) {
        sourceCandidates.push(swap.replace(/\.js$/, ".ts"));
        sourceCandidates.push(swap.replace(/\.js$/, ".tsx"));
      }
      sourceCandidates.push(swap);
    }
    if (main.endsWith(".js")) {
      sourceCandidates.push(main.replace(/\.js$/, ".ts"));
      sourceCandidates.push(main.replace(/\.js$/, ".tsx"));
    }
    for (const c of sourceCandidates) {
      const p = join(projectRoot, c);
      if (existsSync(p)) return p;
    }
    const literal = join(projectRoot, main);
    if (existsSync(literal)) return literal;
  }
  return pickPath(projectRoot, [
    "main.js",
    "main.ts",
    "src/main.js",
    "src/main.ts",
    "src/main/index.ts",
    "src/main/index.js",
    "electron/main.js",
    "electron/main.ts",
  ]);
}

// Directories the installer scans for renderer HTML files. `src` covers the
// common multi-window Electron pattern where each window has a paired
// `src/<name>.html` + `src/<name>.ts` entry (shortformed-style apps).
const RENDERER_HTML_DIRS = ["ui", "renderer", "src/renderer", "src", "public", "static"];

function findRendererHtmlFiles(projectRoot: string): string[] {
  for (const dir of RENDERER_HTML_DIRS) {
    const root = join(projectRoot, dir);
    if (!existsSync(root)) continue;
    const html: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith(".html")) continue;
      const p = join(root, e);
      try {
        const c = readFileSync(p, "utf8");
        if (/<meta[^>]+content-security-policy/i.test(c) || /<script[\s>]/i.test(c)) {
          html.push(p);
        }
      } catch {
        // ignore
      }
    }
    if (html.length > 0) return html;
  }
  return [];
}

function copyIifeBundle(projectRoot: string, dest: string): boolean {
  const candidates = [
    join(projectRoot, "node_modules/@kenkaiiii/gg-pixel/dist/browser.iife.global.js"),
    join(projectRoot, "node_modules/@kenkaiiii/gg-pixel/dist/browser.iife.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        writeFileSync(dest, readFileSync(c, "utf8"), "utf8");
        return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

// HTML comment that delimits the auto-injected gg-pixel block in renderer
// HTML. Used both to recognise an existing injection (so re-installs replace
// it instead of stacking) and as the human-readable header on fresh writes.
const PIXEL_HTML_MARKER = "<!-- gg-pixel: auto-wired by ggcoder pixel install -->";

function patchRendererHtml(
  htmlPath: string,
  iifePath: string,
  projectKey: string,
  ingestUrl: string,
): "patched" | "already" | "not-applicable" {
  let content: string;
  try {
    content = readFileSync(htmlPath, "utf8");
  } catch {
    return "not-applicable";
  }

  // Strip any existing gg-pixel injection (legacy or recent) before re-emitting
  // with the current key. Detected by the comment marker; conservative match
  // ends at the first `</script>` after the second injected `<script>` tag.
  const original = content;
  const markerIdx = content.indexOf(PIXEL_HTML_MARKER);
  if (markerIdx !== -1) {
    // Two consecutive script tags follow the marker. Find the close of the
    // SECOND one, then eat trailing whitespace/newline.
    const firstScriptEnd = content.indexOf("</script>", markerIdx);
    const secondScriptEnd =
      firstScriptEnd !== -1
        ? content.indexOf("</script>", firstScriptEnd + "</script>".length)
        : -1;
    if (secondScriptEnd !== -1) {
      let stripEnd = secondScriptEnd + "</script>".length;
      while (stripEnd < content.length && /\s/.test(content[stripEnd]!)) stripEnd++;
      // Walk back past leading newline/whitespace before the marker so we
      // don't leave a blank line in the head.
      let stripStart = markerIdx;
      while (stripStart > 0 && /[ \t]/.test(content[stripStart - 1]!)) stripStart--;
      if (stripStart > 0 && content[stripStart - 1] === "\n") stripStart--;
      content = content.slice(0, stripStart) + content.slice(stripEnd);
    }
  }

  const ingestOrigin = new URL(ingestUrl).origin;
  // Match content="..." OR content='...'. Critical: don't use `[^"']` for
  // the inner — CSPs legitimately contain `'self'` etc., which would halt
  // a `[^"']+` match at the first single-quote and corrupt the directive.
  content = content.replace(
    /(<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*content=)("([^"]+)"|'([^']+)')/i,
    (
      _match: string,
      before: string,
      _all: string,
      dq: string | undefined,
      sq: string | undefined,
    ) => {
      const quote = dq !== undefined ? '"' : "'";
      const csp = dq !== undefined ? dq : (sq as string);
      let updated = csp;
      if (/connect-src\s/i.test(csp)) {
        if (!csp.includes(ingestOrigin)) {
          updated = csp.replace(/(connect-src[^;]*)/i, `$1 ${ingestOrigin}`);
        }
      } else {
        updated = csp.trim().replace(/;?$/, `; connect-src 'self' ${ingestOrigin};`);
      }
      return before + quote + updated + quote;
    },
  );

  const relScript = relative(dirname(htmlPath), iifePath).split(sep).join("/");
  const inject = `\n  ${PIXEL_HTML_MARKER}\n  <script src="${relScript}"></script>\n  <script>\n    if (window.GGPixel) GGPixel.initPixel({ projectKey: ${JSON.stringify(projectKey)}, ingestUrl: ${JSON.stringify(ingestUrl)} });\n  </script>\n`;
  if (/<head[^>]*>/i.test(content)) {
    content = content.replace(/(<head[^>]*>)/i, `$1${inject}`);
  } else if (/<html[^>]*>/i.test(content)) {
    content = content.replace(/(<html[^>]*>)/i, `$1<head>${inject}</head>`);
  } else {
    return "not-applicable";
  }
  if (content === original) return "already";
  writeFileSync(htmlPath, content, "utf8");
  return "patched";
}

function wireTauri({ projectRoot, pkg, projectKey, ingestUrl }: WiringInput): WiringResult {
  // Tauri frontend = web. Use Browser SDK on the JS side.
  // The Rust backend has no SDK yet — we say so honestly.
  const initPath = join(projectRoot, "gg-pixel.init.mjs");
  writeFileSync(initPath, renderBrowserInitFile(ingestUrl, projectKey), "utf8");
  const entryWiring = wireEntryFile(projectRoot, initPath, pkg);
  return {
    primaryInitPath: initPath,
    entryWiring,
    warnings: [
      "Tauri Rust backend is not instrumented — no Rust SDK exists yet. Frontend errors are captured.",
    ],
  };
}

function wireWorkers({ projectRoot, projectKey, ingestUrl }: WiringInput): WiringResult {
  // Cloudflare Workers / Vercel Edge / etc. The user's worker exports a default
  // object with fetch/scheduled/queue handlers. We can't safely refactor their
  // default export with regex, so we drop a snippet showing the wrap pattern
  // and warn the user.
  const initPath = join(projectRoot, "gg-pixel.workers.snippet.ts");
  writeFileSync(
    initPath,
    `// gg-pixel — Cloudflare Workers wiring snippet.
// Auto-generated by ggcoder pixel install. Wrap your default export with
// withPixel(...) so any throw in your handler is auto-reported. Example:
//
//   import { withPixel } from "@kenkaiiii/gg-pixel/workers";
//
//   export default withPixel(
//     { projectKey: ${JSON.stringify(projectKey)} },
//     {
//       async fetch(req, env, ctx) { /* your code */ },
//       async scheduled(evt, env, ctx) { /* your code */ },
//     },
//   );
//
// For manual reports inside a handler:
//
//   import { reportPixel } from "@kenkaiiii/gg-pixel/workers";
//   reportPixel(ctx, { projectKey: ${JSON.stringify(projectKey)} }, {
//     message: "user clicked the broken button",
//   });
//
// Your project_key is publishable — safe to commit.

import { withPixel, reportPixel } from "@kenkaiiii/gg-pixel/workers";
export const PIXEL_KEY = ${JSON.stringify(projectKey)};
export const PIXEL_INGEST = ${JSON.stringify(ingestUrl)};
export { withPixel, reportPixel };
`,
    "utf8",
  );
  return {
    primaryInitPath: initPath,
    entryWiring: { kind: "no_entry_found" },
    warnings: [
      `Cloudflare Workers default exports can't be auto-wrapped safely. Open ${initPath} for a 3-line snippet you can paste into your worker.`,
    ],
  };
}

function wireReactNative({ projectRoot }: WiringInput): WiringResult {
  // RN's JS engine is neither a real browser nor Node. Our current SDKs
  // don't reliably hook it. Be honest rather than ship something broken.
  return {
    primaryInitPath: join(projectRoot, "(not-installed)"),
    entryWiring: { kind: "skipped", reason: "react-native SDK not built yet" },
    warnings: [
      "React Native is not yet supported — its JS runtime is neither browser nor Node.",
      "A dedicated React Native SDK will be a future slice.",
    ],
  };
}

// ── small helpers used by the per-framework writers ────────────────

function pickPath(root: string, candidates: string[]): string | null {
  for (const c of candidates) {
    const p = join(root, c);
    if (existsSync(p)) return p;
  }
  return null;
}

// Wrap an auto-generated snippet between markers so re-installs (which mint
// a fresh project_id+key+secret when the local mapping is legacy) can replace
// the previous block in-place instead of bailing on a "looks already wired"
// check and leaving a stale key behind. User code outside the markers is
// preserved untouched.
const PIXEL_MARK_BEGIN = "// >>> gg-pixel auto-generated — do not edit between these markers <<<";
const PIXEL_MARK_END = "// >>> /gg-pixel <<<";

export function wrapPixelBlock(content: string): string {
  return `${PIXEL_MARK_BEGIN}\n${content.replace(/\s+$/, "")}\n${PIXEL_MARK_END}\n`;
}

/**
 * If `existing` already contains a markered gg-pixel block, replace it with a
 * freshly-wrapped `block`. Otherwise append the wrapped block to the end of
 * `existing`. Idempotent when the new block matches the existing one.
 */
export function upsertPixelBlock(existing: string, block: string): string {
  const wrapped = wrapPixelBlock(block);
  const beginIdx = existing.indexOf(PIXEL_MARK_BEGIN);
  if (beginIdx !== -1) {
    const endIdx = existing.indexOf(PIXEL_MARK_END, beginIdx);
    if (endIdx !== -1) {
      const after = endIdx + PIXEL_MARK_END.length;
      const trailNL = existing[after] === "\n" ? 1 : 0;
      return existing.slice(0, beginIdx) + wrapped + existing.slice(after + trailNL);
    }
  }
  if (existing.length === 0) return wrapped;
  const sep = existing.endsWith("\n") ? "" : "\n";
  return existing + sep + "\n" + wrapped;
}

function upsertPixelBlockInFile(filePath: string, block: string): void {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const cleaned = stripLegacyPixelContent(existing);
  const next = upsertPixelBlock(cleaned, block);
  if (next !== existing) writeFileSync(filePath, next, "utf8");
}

/**
 * Remove unmarkered gg-pixel content emitted by older versions of the
 * installer so re-installs don't end up with two `register()` exports
 * (or two `initPixel(...)` calls) — one legacy + one in the new markered
 * block. Conservative: only operates outside the marker delimiters.
 */
export function stripLegacyPixelContent(content: string): string {
  if (!content.includes("@kenkaiiii/gg-pixel")) return content;

  const beginIdx = content.indexOf(PIXEL_MARK_BEGIN);
  const endIdx = beginIdx === -1 ? -1 : content.indexOf(PIXEL_MARK_END, beginIdx);
  const insideMarkers = (start: number, end: number): boolean =>
    beginIdx !== -1 && endIdx !== -1 && start >= beginIdx && end <= endIdx + PIXEL_MARK_END.length;

  // Walk the source and collect ranges to delete. Patterns:
  //   1. `[leading // comment lines] export async function register() { … gg-pixel … }`
  //      — Next.js `instrumentation.ts` from the pre-marker installer.
  //   2. `[leading // comment lines] import { initPixel } … initPixel({ … });`
  //      — SvelteKit hooks from the pre-marker installer.
  const ranges: Array<{ start: number; end: number }> = [];

  // (1) brace-balanced register() containing @kenkaiiii/gg-pixel.
  // The capture group is INSIDE the match — comments are part of m[0], not
  // before it — so blockStart is just m.index (skipping a leading newline if
  // we anchored on `\n`).
  const registerRe =
    /(?:^|\n)((?:[ \t]*\/\/[^\n]*\n)*)[ \t]*export\s+async\s+function\s+register\s*\(\s*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = registerRe.exec(content)) !== null) {
    const blockStart = m.index + (content[m.index] === "\n" ? 1 : 0);
    const openBraceIdx = m.index + m[0].length - 1;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    if (depth !== 0) continue;
    const blockEnd = i;
    const blockText = content.slice(blockStart, blockEnd);
    if (!blockText.includes("@kenkaiiii/gg-pixel")) continue;
    if (insideMarkers(blockStart, blockEnd)) continue;
    const trailingNL = content[blockEnd] === "\n" ? 1 : 0;
    ranges.push({ start: blockStart, end: blockEnd + trailingNL });
  }

  // (2) `import { initPixel } from "@kenkaiiii/gg-pixel[/...]"` followed within
  //     ~2KB by a balanced `initPixel({ … });` call. Same comment-inside-match
  //     rule as (1).
  const importRe =
    /(?:^|\n)((?:[ \t]*\/\/[^\n]*\n)*)[ \t]*import\s*\{\s*initPixel[^}]*\}\s*from\s*"@kenkaiiii\/gg-pixel(?:\/[\w-]+)?"\s*;?\s*\n/g;
  while ((m = importRe.exec(content)) !== null) {
    const blockStart = m.index + (content[m.index] === "\n" ? 1 : 0);
    // Find `initPixel({` after the import statement and brace-match the call.
    const callIdx = content.indexOf("initPixel(", importRe.lastIndex);
    if (callIdx === -1 || callIdx - importRe.lastIndex > 2048) continue;
    const openParen = content.indexOf("(", callIdx);
    let depth = 1;
    let i = openParen + 1;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === "(" || ch === "{") depth++;
      else if (ch === ")" || ch === "}") depth--;
      i++;
    }
    if (depth !== 0) continue;
    // Eat the trailing semicolon + spaces + newline.
    while (i < content.length && (content[i] === ";" || content[i] === " ")) i++;
    const trailingNL = content[i] === "\n" ? 1 : 0;
    const blockEnd = i + trailingNL;
    if (insideMarkers(blockStart, blockEnd)) continue;
    ranges.push({ start: blockStart, end: blockEnd });
  }

  if (ranges.length === 0) return content;
  ranges.sort((a, b) => b.start - a.start);
  let out = content;
  for (const r of ranges) out = out.slice(0, r.start) + out.slice(r.end);
  return out.replace(/\n{3,}/g, "\n\n");
}

function injectImport(entryPath: string, initFilePath: string): EntryWiringResult {
  let content: string;
  try {
    content = readFileSync(entryPath, "utf8");
  } catch (err) {
    return { kind: "skipped", reason: `unreadable: ${(err as Error).message}` };
  }
  const initBasename = initFilePath.split(sep).pop() ?? "gg-pixel.init.mjs";
  if (content.includes(initBasename) || content.includes("@kenkaiiii/gg-pixel")) {
    return { kind: "already_present", entryPath };
  }
  const fromDir = dirname(entryPath);
  let spec = relative(fromDir, initFilePath).split(sep).join("/");
  if (!spec.startsWith(".")) spec = "./" + spec;
  // Detect CJS by content: .cjs, or .js using `require(` and lacking ESM markers.
  // Electron's main.js is the canonical case here.
  const isCjs =
    entryPath.endsWith(".cjs") ||
    (entryPath.endsWith(".js") &&
      /\brequire\s*\(/.test(content) &&
      !/\bimport\s+/.test(content) &&
      !/\bexport\s+/.test(content));
  const importLine = isCjs
    ? `require(${JSON.stringify(spec)});`
    : `import ${JSON.stringify(spec)};`;
  const lines = content.split("\n");
  let insertAt = 0;
  if (lines[0]?.startsWith("#!")) insertAt = 1;
  while (
    insertAt < lines.length &&
    /^\s*(?:["']use strict["']|\/\/|\/\*)/.test(lines[insertAt] ?? "")
  ) {
    insertAt++;
  }
  const updated = [...lines.slice(0, insertAt), importLine, ...lines.slice(insertAt)].join("\n");
  writeFileSync(entryPath, updated, "utf8");
  return { kind: "injected", entryPath };
}

// ── /Framework wiring ───────────────────────────────────────────────

export function isBrowserProject(pkg: PackageJson, projectRoot: string): boolean {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const browserishDeps = [
    "react",
    "react-dom",
    "vue",
    "@vue/runtime-core",
    "svelte",
    "next",
    "vite",
    "@vitejs/plugin-react",
    "@angular/core",
    "solid-js",
    "preact",
    "@remix-run/react",
    "astro",
    "qwik",
    "@sveltejs/kit",
    "expo",
  ];
  if (browserishDeps.some((d) => d in all)) return true;
  if (pkg.browser !== undefined) return true;
  if (existsSync(join(projectRoot, "index.html"))) return true;
  if (existsSync(join(projectRoot, "public", "index.html"))) return true;
  return false;
}

export function renderBrowserInitFile(ingestUrl: string, projectKey: string): string {
  return `// gg-pixel init — auto-generated by ggcoder pixel install.
// The project_key is publishable (designed to live in browser bundles).
import { initPixel } from "@kenkaiiii/gg-pixel/browser";

initPixel({
  projectKey: ${JSON.stringify(projectKey)},
  ingestUrl: ${JSON.stringify(ingestUrl)},
});
`;
}

// ── Python ──────────────────────────────────────────────────────────

const PYTHON_MARKERS = ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"];

export function findPythonProjectRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (PYTHON_MARKERS.some((m) => existsSync(join(dir, m)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function detectPythonPackageManager(projectRoot: string): PythonPackageManager {
  if (existsSync(join(projectRoot, "uv.lock"))) return "uv";
  if (existsSync(join(projectRoot, "poetry.lock"))) return "poetry";
  if (existsSync(join(projectRoot, "Pipfile.lock"))) return "pipenv";
  return "pip";
}

function pickClosestRoot(roots: Array<string | null>): string | null {
  let best: string | null = null;
  for (const r of roots) {
    if (!r) continue;
    if (!best || r.length > best.length) best = r;
  }
  return best;
}

const GO_MARKER = "go.mod";
const RUBY_MARKERS = ["Gemfile"];

export function findGoProjectRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, GO_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function findRubyProjectRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    for (const m of RUBY_MARKERS) {
      if (existsSync(join(dir, m))) return dir;
    }
    // Also catch *.gemspec files at this level.
    try {
      const entries = readdirSync(dir);
      if (entries.some((e) => e.endsWith(".gemspec"))) return dir;
    } catch {
      // ignore
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

interface NativeInstallContext {
  projectRoot: string;
  opts: InstallOptions;
  ingestUrl: string;
  fetchFn: typeof fetch;
  home: string;
}

async function installGo(ctx: NativeInstallContext): Promise<InstallResult> {
  const { projectRoot, opts, ingestUrl, fetchFn, home } = ctx;
  const projectName =
    opts.projectName ?? readGoModuleName(projectRoot) ?? projectRoot.split("/").pop() ?? "unnamed";
  const projectsJsonPath = join(home, ".gg", "projects.json");
  const envFilePath = join(projectRoot, ".env");

  const existing = findMappingByPath(projectsJsonPath, projectRoot);
  const existingKey = readEnvKey(envFilePath, "GG_PIXEL_KEY");
  let created: CreatedProject;
  let reused = false;
  if (existing && existing.secret && existingKey) {
    created = { id: existing.id, key: existingKey, secret: existing.secret };
    reused = true;
  } else {
    created = await createProject(fetchFn, ingestUrl, projectName);
  }

  const packageInstalled = opts.skipPackageInstall ? false : runGoGet(projectRoot);

  const initFilePath = join(projectRoot, "gg_pixel_init.go");
  writeFileSync(
    initFilePath,
    `// gg-pixel init — auto-generated by ggcoder pixel install.
package main

import (
	"os"
	gg "github.com/kenkaiiii/gg-pixel-go"
)

func init() {
	key := os.Getenv("GG_PIXEL_KEY")
	if key == "" {
		key = ${JSON.stringify(created.key)}
	}
	_ = gg.Init(gg.Options{ProjectKey: key, IngestURL: ${JSON.stringify(`${ingestUrl}/ingest`)}})
}
`,
    "utf8",
  );

  writeEnvKey(envFilePath, "GG_PIXEL_KEY", created.key);
  writeProjectsMapping(projectsJsonPath, created.id, projectName, projectRoot, created.secret);

  return {
    projectId: created.id,
    projectKey: created.key,
    projectSecret: created.secret,
    projectName,
    projectKind: "go",
    projectRoot,
    initFilePath,
    envFilePath,
    projectsJsonPath,
    packageManager: "pip",
    packageInstalled,
    entryWiring: { kind: "no_entry_found" },
    reused,
    warnings: [
      "Add `defer ggpixel.Recover()` near the top of your main() so panics are captured before the process exits.",
    ],
  };
}

function readGoModuleName(projectRoot: string): string | null {
  try {
    const content = readFileSync(join(projectRoot, "go.mod"), "utf8");
    const match = /^\s*module\s+(\S+)\s*$/m.exec(content);
    if (!match) return null;
    return match[1]!.split("/").pop() ?? null;
  } catch {
    return null;
  }
}

function runGoGet(projectRoot: string): boolean {
  const result = spawnSync("go", ["get", "github.com/kenkaiiii/gg-pixel-go@latest"], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  return result.status === 0;
}

async function installRuby(ctx: NativeInstallContext): Promise<InstallResult> {
  const { projectRoot, opts, ingestUrl, fetchFn, home } = ctx;
  const projectName =
    opts.projectName ?? readRubyAppName(projectRoot) ?? projectRoot.split("/").pop() ?? "unnamed";
  const projectsJsonPath = join(home, ".gg", "projects.json");
  const envFilePath = join(projectRoot, ".env");

  const existing = findMappingByPath(projectsJsonPath, projectRoot);
  const existingKey = readEnvKey(envFilePath, "GG_PIXEL_KEY");
  let created: CreatedProject;
  let reused = false;
  if (existing && existing.secret && existingKey) {
    created = { id: existing.id, key: existingKey, secret: existing.secret };
    reused = true;
  } else {
    created = await createProject(fetchFn, ingestUrl, projectName);
  }

  const packageInstalled = opts.skipPackageInstall ? false : runRubyInstall(projectRoot);

  const initFilePath = join(projectRoot, "gg_pixel_init.rb");
  writeFileSync(
    initFilePath,
    `# gg-pixel init — auto-generated by ggcoder pixel install.
require "gg_pixel"
GGPixel.init(
  project_key: ENV["GG_PIXEL_KEY"] || ${JSON.stringify(created.key)},
  ingest_url: ${JSON.stringify(`${ingestUrl}/ingest`)},
)
`,
    "utf8",
  );

  writeEnvKey(envFilePath, "GG_PIXEL_KEY", created.key);
  writeProjectsMapping(projectsJsonPath, created.id, projectName, projectRoot, created.secret);

  return {
    projectId: created.id,
    projectKey: created.key,
    projectSecret: created.secret,
    projectName,
    projectKind: "ruby",
    projectRoot,
    initFilePath,
    envFilePath,
    projectsJsonPath,
    packageManager: "pip",
    packageInstalled,
    entryWiring: { kind: "no_entry_found" },
    reused,
    warnings: [
      `Add \`require "./gg_pixel_init"\` at the top of your entry script (often \`config/application.rb\` for Rails, \`app.rb\` for Sinatra, or your main file).`,
    ],
  };
}

function readRubyAppName(projectRoot: string): string | null {
  try {
    const entries = readdirSync(projectRoot);
    const gemspec = entries.find((e) => e.endsWith(".gemspec"));
    if (!gemspec) return null;
    return gemspec.replace(/\.gemspec$/, "");
  } catch {
    return null;
  }
}

function runRubyInstall(projectRoot: string): boolean {
  // Prefer bundler if a Gemfile exists.
  if (existsSync(join(projectRoot, "Gemfile"))) {
    // Append to Gemfile if not present.
    try {
      const content = readFileSync(join(projectRoot, "Gemfile"), "utf8");
      if (!content.includes("gg_pixel")) {
        writeFileSync(
          join(projectRoot, "Gemfile"),
          content + (content.endsWith("\n") ? "" : "\n") + 'gem "gg_pixel"\n',
          "utf8",
        );
      }
    } catch {
      // ignore
    }
    const r = spawnSync("bundle", ["install"], { cwd: projectRoot, stdio: "inherit" });
    if (r.status === 0) return true;
  }
  const r2 = spawnSync("gem", ["install", "gg_pixel"], { cwd: projectRoot, stdio: "inherit" });
  return r2.status === 0;
}

interface PythonInstallContext {
  projectRoot: string;
  opts: InstallOptions;
  ingestUrl: string;
  fetchFn: typeof fetch;
  home: string;
}

async function installPython(ctx: PythonInstallContext): Promise<InstallResult> {
  const { projectRoot, opts, ingestUrl, fetchFn, home } = ctx;
  const projectName =
    opts.projectName ?? readPyprojectName(projectRoot) ?? projectRoot.split("/").pop() ?? "unnamed";

  const projectsJsonPath = join(home, ".gg", "projects.json");
  const envFilePath = join(projectRoot, ".env");

  const existing = findMappingByPath(projectsJsonPath, projectRoot);
  const existingKey = readEnvKey(envFilePath, "GG_PIXEL_KEY");
  let created: CreatedProject;
  let reused = false;
  if (existing && existing.secret && existingKey) {
    created = { id: existing.id, key: existingKey, secret: existing.secret };
    reused = true;
  } else {
    created = await createProject(fetchFn, ingestUrl, projectName);
  }

  const pm = detectPythonPackageManager(projectRoot);
  const packageInstalled = opts.skipPackageInstall ? false : runPythonInstall(projectRoot, pm);

  const initFilePath = join(projectRoot, "gg_pixel_init.py");
  writeFileSync(initFilePath, renderPythonInitFile(ingestUrl, created.key), "utf8");

  writeEnvKey(envFilePath, "GG_PIXEL_KEY", created.key);
  writeProjectsMapping(projectsJsonPath, created.id, projectName, projectRoot, created.secret);

  const entryWiring = wirePythonEntry(projectRoot, initFilePath);

  return {
    projectId: created.id,
    projectKey: created.key,
    projectSecret: created.secret,
    projectName,
    projectKind: "python",
    projectRoot,
    initFilePath,
    envFilePath,
    projectsJsonPath,
    packageManager: pm,
    packageInstalled,
    entryWiring,
    reused,
    warnings: [],
  };
}

function readPyprojectName(projectRoot: string): string | null {
  const path = join(projectRoot, "pyproject.toml");
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    const match = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(content);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function runPythonInstall(projectRoot: string, pm: PythonPackageManager): boolean {
  const cmd =
    pm === "uv"
      ? ["uv", ["add", "gg-pixel"]]
      : pm === "poetry"
        ? ["poetry", ["add", "gg-pixel"]]
        : pm === "pipenv"
          ? ["pipenv", ["install", "gg-pixel"]]
          : ["pip", ["install", "gg-pixel"]];
  const result = spawnSync(cmd[0] as string, cmd[1] as string[], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status === 0) return true;
  // Fallback: many systems only have `pip3` on PATH.
  if (pm === "pip") {
    const r2 = spawnSync("pip3", ["install", "gg-pixel"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    if (r2.status === 0) return true;
    const r3 = spawnSync("python3", ["-m", "pip", "install", "gg-pixel"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    return r3.status === 0;
  }
  return false;
}

export function renderPythonInitFile(ingestUrl: string, projectKey: string): string {
  return `"""gg-pixel init — auto-generated by ggcoder pixel install.

This file initializes error tracking. Importing it (which the install step
wires into your entry file) registers the global Python error handlers.
"""
import os

import gg_pixel

gg_pixel.init_pixel(
    project_key=os.environ.get("GG_PIXEL_KEY") or ${JSON.stringify(projectKey)},
    ingest_url=${JSON.stringify(`${ingestUrl}/ingest`)},
)
`;
}

function wirePythonEntry(projectRoot: string, initFilePath: string): EntryWiringResult {
  const entryPath = findPythonEntryFile(projectRoot);
  if (!entryPath) return { kind: "no_entry_found" };

  let content: string;
  try {
    content = readFileSync(entryPath, "utf8");
  } catch (err) {
    return { kind: "skipped", reason: `unreadable: ${(err as Error).message}` };
  }

  if (content.includes("gg_pixel_init")) {
    return { kind: "already_present", entryPath };
  }

  // Compute import name from the relative path. gg_pixel_init.py at root →
  // `gg_pixel_init`. For nested, the user can adjust manually.
  const fromDir = dirname(entryPath);
  const rel = relative(fromDir, initFilePath).split(sep).join("/");
  let moduleSpec: string;
  if (rel === "gg_pixel_init.py") {
    moduleSpec = "gg_pixel_init";
  } else if (rel.startsWith("../")) {
    // Init is above the entry — Python imports don't traverse via path,
    // so insert via sys.path manipulation as a fallback.
    moduleSpec = "gg_pixel_init";
  } else {
    // Same-or-deeper directory: use module path.
    moduleSpec = rel.replace(/\.py$/, "").replace(/\//g, ".");
  }

  const importLine = `import ${moduleSpec}  # noqa: F401, E402  -- gg-pixel`;

  const lines = content.split("\n");
  let insertAt = 0;
  if (lines[0]?.startsWith("#!")) insertAt = 1;
  // Skip encoding declarations and module docstrings.
  while (insertAt < lines.length && /^\s*(?:#.*coding[:=]|["']{3}|#)/.test(lines[insertAt] ?? "")) {
    insertAt++;
  }

  const updated = [...lines.slice(0, insertAt), importLine, ...lines.slice(insertAt)].join("\n");
  writeFileSync(entryPath, updated, "utf8");
  return { kind: "injected", entryPath };
}

function findPythonEntryFile(projectRoot: string): string | null {
  const tryPath = (rel: string): string | null => {
    const p = join(projectRoot, rel);
    return existsSync(p) ? p : null;
  };
  const candidates = [
    "main.py",
    "app.py",
    "server.py",
    "manage.py",
    "wsgi.py",
    "asgi.py",
    "__main__.py",
    "src/main.py",
    "src/app.py",
    "src/server.py",
    "src/__main__.py",
  ];
  for (const c of candidates) {
    const found = tryPath(c);
    if (found) return found;
  }
  return null;
}

// ── /Python ─────────────────────────────────────────────────────────

export function writeProjectsMapping(
  projectsJsonPath: string,
  projectId: string,
  name: string,
  path: string,
  secret?: string,
): void {
  mkdirSync(dirname(projectsJsonPath), { recursive: true });
  let map: Record<string, { name: string; path: string; secret?: string }> = {};
  if (existsSync(projectsJsonPath)) {
    try {
      map = JSON.parse(readFileSync(projectsJsonPath, "utf8")) as typeof map;
    } catch {
      // start fresh on corrupt file
    }
  }
  const entry: { name: string; path: string; secret?: string } = { name, path };
  if (secret) entry.secret = secret;
  map[projectId] = entry;
  writeFileSync(projectsJsonPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}
