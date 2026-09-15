/**
 * Internal-only session diagnostics — NOT a public feature.
 *
 * Enabled only when the internal flag is set (env `GG_INTERNAL=1` or
 * `~/.gg/internal.json` containing `{"diagnostics": true}`). When disabled,
 * nothing is recorded, no tool is registered, and `/diagnose` does not exist,
 * so the public tool list and prompt stay byte-identical.
 *
 * What it captures per session (counters and timings only — never prompt
 * text, file contents, or credentials):
 *   - per-turn usage + timing (reuses TurnMetricPayload, already persisted)
 *   - per-tool call/error/duration stats and clustered error digests
 *   - identical-call repeats (same tool + same args ≥ 3×)
 *   - truncation/continuation events, model switches, compactions
 *
 * Consumers: the `session_stats` tool (live, agent-facing) and the
 * `/diagnose` slash command (cross-session aggregate, agent-facing).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { environmentSecrets, redactValue } from "@kleio/ai";
import { z } from "zod";
import { getAppPaths } from "../config.js";
import type { EventBus } from "./event-bus.js";
import type { SlashCommand } from "./slash-commands.js";

let enabledCache: boolean | undefined;

/** Internal mode gate. Env wins; otherwise `~/.gg/internal.json` must set
 * `diagnostics: true`. Result is cached for the process lifetime. */
export function isInternalDiagnosticsEnabled(): boolean {
  if (enabledCache !== undefined) return enabledCache;
  const env = process.env.GG_INTERNAL;
  if (env) {
    enabledCache = ["1", "true", "yes"].includes(env.toLowerCase());
    return enabledCache;
  }
  try {
    const file = path.join(getAppPaths().agentDir, "internal.json");
    const parsed = JSON.parse(readBoundedFile(file, 4096)) as { diagnostics?: unknown };
    enabledCache = parsed?.diagnostics === true;
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

/** Test seam: reset the cached flag after mutating env/file state. */
export function resetInternalDiagnosticsCacheForTests(): void {
  enabledCache = undefined;
}

export function diagnosticsSessionsDir(): string {
  return (
    process.env.GG_DIAGNOSTICS_DIR ?? path.join(getAppPaths().agentDir, "diagnostics", "sessions")
  );
}

// ── Record shape ───────────────────────────────────────────

export interface TurnDiagnostics {
  turn: number;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
  ttftMs?: number;
  providerDurationMs: number;
}

export interface ToolDiagnostics {
  calls: number;
  errors: number;
  /** Non-zero exits, empty greps, tool-rejection strings — failures the tools
   * report as ordinary result text (isError stays false). */
  softErrors: number;
  totalMs: number;
  maxMs: number;
  invalidArgAttempts: number;
  truncatedResults: number;
}

export interface ErrorCluster {
  digest: string;
  count: number;
}

export interface RepeatEntry {
  tool: string;
  argsDigest: string;
  count: number;
}

export interface SessionDiagnosticsRecord {
  version: 2;
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  startedAt: number;
  endedAt?: number;
  modelSwitches: { at: number; provider: string; model: string }[];
  turns: TurnDiagnostics[];
  toolStats: Record<string, ToolDiagnostics>;
  errorClusters: ErrorCluster[];
  repeats: RepeatEntry[];
  truncations: { reason: string; continued: boolean }[];
  compactions: { originalCount: number; newCount: number }[];
  totals: {
    turns: number;
    toolCalls: number;
    toolErrors: number;
    inputTokens: number;
    outputTokens: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

/** The subset of TurnMetricPayload the recorder consumes — kept structural so
 * agent-session can pass its full payload without an import cycle. */
export interface TurnMetricLike {
  turn: number;
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number };
  timing: { providerDurationMs: number; ttftMs?: number };
}

// ── Recorder ───────────────────────────────────────────────

const REPEAT_THRESHOLD = 3;
const MAX_ERROR_CLUSTERS = 8;
const MAX_REPEATED_KEYS = 16;
const MAX_TURNS_KEPT = 500;
const MAX_TRACKED_KEYS = 1024;
const MAX_TOOL_NAMES = 128;
const MAX_RECORD_BYTES = 1024 * 1024;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const LABEL_RE = /^[a-zA-Z0-9_./:-]{1,128}$/;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function label(value: string): string {
  const redacted = redactValue(value, { secrets: environmentSecrets(process.env) });
  return LABEL_RE.test(redacted) && !["__proto__", "constructor", "prototype"].includes(redacted)
    ? redacted
    : "redacted";
}

function sessionKey(value: string): string {
  return SAFE_ID_RE.test(value) && label(value) === value ? value : `session-${digest(value)}`;
}

function argsDigest(args: Record<string, unknown> | undefined): string {
  try {
    // Even empty/short arguments must never become persisted identifiers.
    return digest(JSON.stringify(args ?? {}));
  } catch {
    // Cyclic arguments are not comparable; never manufacture false repeats.
    return digest(randomUUID());
  }
}

function capMap<K, V>(map: Map<K, V>): void {
  if (map.size > MAX_TRACKED_KEYS) map.delete(map.keys().next().value!);
}

function capEvents<T>(events: T[]): void {
  if (events.length > MAX_TURNS_KEPT) events.splice(0, events.length - MAX_TURNS_KEPT);
}

/** Bound reads before allocation and refuse links, directories, and devices. */
function readBoundedFile(file: string, maxBytes = MAX_RECORD_BYTES): string {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.size > maxBytes) throw new Error("Invalid diagnostics file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Invalid diagnostics file");
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const n = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!n) break;
      size += n;
    }
    if (size > maxBytes) throw new Error("Diagnostics file too large");
    return buffer.toString("utf8", 0, size);
  } finally {
    fs.closeSync(fd);
  }
}

const countSchema = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER);
const labelSchema = z.string().regex(LABEL_RE);
const turnSchema = z.object({
  turn: countSchema,
  stopReason: labelSchema,
  inputTokens: countSchema,
  outputTokens: countSchema,
  cacheRead: countSchema.optional(),
  cacheWrite: countSchema.optional(),
  ttftMs: countSchema.optional(),
  providerDurationMs: countSchema,
});
const statsSchema = z.object({
  calls: countSchema,
  errors: countSchema,
  softErrors: countSchema,
  totalMs: countSchema,
  maxMs: countSchema,
  invalidArgAttempts: countSchema,
  truncatedResults: countSchema,
});
const recordSchema = z
  .object({
    // v1 stored raw arguments/errors. Do not aggregate those legacy records.
    version: z.literal(2),
    sessionId: z.string().regex(SAFE_ID_RE),
    cwd: z.string().regex(DIGEST_RE),
    provider: labelSchema,
    model: labelSchema,
    startedAt: countSchema,
    endedAt: countSchema.optional(),
    modelSwitches: z
      .array(z.object({ at: countSchema, provider: labelSchema, model: labelSchema }))
      .max(MAX_TURNS_KEPT),
    turns: z.array(turnSchema).max(MAX_TURNS_KEPT),
    toolStats: z
      .record(labelSchema, statsSchema)
      .refine((value) => Object.keys(value).length <= MAX_TOOL_NAMES),
    errorClusters: z
      .array(z.object({ digest: z.string().regex(DIGEST_RE), count: countSchema }).strict())
      .max(MAX_ERROR_CLUSTERS),
    repeats: z
      .array(
        z
          .object({
            tool: labelSchema,
            argsDigest: z.string().regex(DIGEST_RE),
            count: countSchema,
          })
          .strict(),
      )
      .max(MAX_REPEATED_KEYS),
    truncations: z
      .array(z.object({ reason: labelSchema, continued: z.boolean() }))
      .max(MAX_TURNS_KEPT),
    compactions: z
      .array(z.object({ originalCount: countSchema, newCount: countSchema }))
      .max(MAX_TURNS_KEPT),
    totals: z.object({
      turns: countSchema,
      toolCalls: countSchema,
      toolErrors: countSchema,
      inputTokens: countSchema,
      outputTokens: countSchema,
      cacheRead: countSchema,
      cacheWrite: countSchema,
    }),
  })
  .strict();

/** True when a tool "succeeded" but its result text says it failed: bash
 * prefixes non-zero exits with "Exit code: N", and most tools prefix
 * rejections/refusals with "Error:". Empty-grep "no matches" is a legitimate
 * answer, not a failure, so it stays clean. */
function isSoftFailure(result: string): boolean {
  return /^Exit code: [1-9]/m.test(result) || /^Error:/m.test(result);
}

/** Collapse an error result into a stable digest: first line, digits and
 * quoted paths normalized, so 50 identical failures cluster into one row. */
function errorDigest(result: string): string {
  const firstLine =
    result
      .slice(0, 4096)
      .split("\n")
      .find((l) => l.trim().length > 0) ?? "";
  return digest(
    firstLine
      .replace(/\d+/g, "N")
      .replace(/"[^"]+"/g, '"…"')
      .replace(/'[^']+'/g, "'…'"),
  );
}

export class SessionDiagnosticsRecorder {
  private record: SessionDiagnosticsRecord;
  private pendingCalls = new Map<string, { name: string; argsKey: string }>();
  private repeatCounts = new Map<string, { tool: string; argsDigest: string; count: number }>();
  private clusterCounts = new Map<string, { count: number }>();
  private readonly enabled = isInternalDiagnosticsEnabled();
  private finalized = false;
  private unsubscribers: (() => void)[] = [];
  private fallbackSessionId?: string;

  private getSessionId: () => string;

  constructor(opts: {
    /** Lazy on purpose: hosts assign the session id at first prompt, AFTER
     * initialize() creates this recorder. A string snapshot would name the
     * record file `.json` (empty id). */
    sessionId: string | (() => string);
    cwd: string;
    provider: string;
    model: string;
    dir?: string;
  }) {
    this.getSessionId = () =>
      typeof opts.sessionId === "function" ? opts.sessionId() : opts.sessionId;
    this.record = {
      version: 2,
      sessionId: sessionKey(this.getSessionId()),
      cwd: digest(path.resolve(opts.cwd)),
      provider: label(opts.provider),
      model: label(opts.model),
      startedAt: Date.now(),
      modelSwitches: [],
      turns: [],
      toolStats: Object.create(null) as Record<string, ToolDiagnostics>,
      errorClusters: [],
      repeats: [],
      truncations: [],
      compactions: [],
      totals: {
        turns: 0,
        toolCalls: 0,
        toolErrors: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    };
    this.dir = opts.dir;
  }

  private dir?: string;

  /** Subscribe to the session bus. Safe to call once per session. */
  attach(bus: EventBus): void {
    if (!this.enabled || this.finalized || this.unsubscribers.length) return;
    this.unsubscribers.push(
      bus.on("tool_call_start", ({ toolCallId, name, args }) => {
        this.pendingCalls.set(digest(toolCallId), { name: label(name), argsKey: argsDigest(args) });
        capMap(this.pendingCalls);
      }),
    );
    this.unsubscribers.push(
      bus.on("tool_call_end", ({ toolCallId, result, isError, durationMs, invalidArgAttempt }) => {
        const pending = this.pendingCalls.get(digest(toolCallId));
        this.pendingCalls.delete(digest(toolCallId));
        const candidate = pending?.name ?? "unknown";
        // Reserve one bucket for overflow without dropping total call counts.
        const name =
          Object.hasOwn(this.record.toolStats, candidate) ||
          Object.keys(this.record.toolStats).length < MAX_TOOL_NAMES - 1
            ? candidate
            : "other";
        durationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
        const stat = (this.record.toolStats[name] ??= {
          calls: 0,
          errors: 0,
          softErrors: 0,
          totalMs: 0,
          maxMs: 0,
          invalidArgAttempts: 0,
          truncatedResults: 0,
        });
        stat.calls += 1;
        stat.totalMs += durationMs;
        stat.maxMs = Math.max(stat.maxMs, durationMs);
        if (invalidArgAttempt) stat.invalidArgAttempts += 1;
        if (/Full output saved to|\[truncated/i.test(result)) stat.truncatedResults += 1;
        this.record.totals.toolCalls += 1;
        const failed = isError || isSoftFailure(result);
        if (isError) stat.errors += 1;
        else if (failed) stat.softErrors += 1;
        if (failed) {
          this.record.totals.toolErrors += 1;
          const digest = errorDigest(result);
          const cluster = this.clusterCounts.get(digest) ?? {
            count: 0,
          };
          cluster.count += 1;
          this.clusterCounts.set(digest, cluster);
          capMap(this.clusterCounts);
        }
        if (pending) {
          const key = `${name}::${pending.argsKey}`;
          const entry = this.repeatCounts.get(key) ?? {
            tool: name,
            argsDigest: pending.argsKey,
            count: 0,
          };
          entry.count += 1;
          this.repeatCounts.set(key, entry);
          capMap(this.repeatCounts);
        }
      }),
    );
    this.unsubscribers.push(
      bus.on("model_change", ({ provider, model }) => {
        provider = label(provider);
        model = label(model);
        if (model !== this.record.model || provider !== this.record.provider) {
          this.record.modelSwitches.push({ at: Date.now(), provider, model });
          capEvents(this.record.modelSwitches);
          this.record.provider = provider;
          this.record.model = model;
        }
      }),
    );
    this.unsubscribers.push(
      bus.on("truncated", ({ reason, continued }) => {
        this.record.truncations.push({ reason: label(reason), continued });
        capEvents(this.record.truncations);
      }),
    );
    this.unsubscribers.push(
      bus.on("compaction_end", ({ compacted, originalCount, newCount }) => {
        if (
          compacted &&
          countSchema.safeParse(originalCount).success &&
          countSchema.safeParse(newCount).success
        ) {
          this.record.compactions.push({ originalCount, newCount });
          capEvents(this.record.compactions);
        }
      }),
    );
  }

  /** Called from AgentSession.persistTurnMetric — the authoritative per-turn
   * usage/timing source. Also the incremental flush point. */
  recordTurnMetric(metric: TurnMetricLike): void {
    if (!this.enabled || this.finalized) return;
    if (
      !turnSchema.safeParse({
        turn: metric.turn,
        stopReason: label(metric.stopReason),
        ...metric.usage,
        ...metric.timing,
      }).success
    )
      return;
    this.record.totals.turns += 1;
    this.record.totals.inputTokens += metric.usage.inputTokens;
    this.record.totals.outputTokens += metric.usage.outputTokens;
    this.record.totals.cacheRead += metric.usage.cacheRead ?? 0;
    this.record.totals.cacheWrite += metric.usage.cacheWrite ?? 0;
    this.record.turns.push({
      turn: metric.turn,
      stopReason: label(metric.stopReason),
      inputTokens: metric.usage.inputTokens,
      outputTokens: metric.usage.outputTokens,
      cacheRead: metric.usage.cacheRead,
      cacheWrite: metric.usage.cacheWrite,
      ttftMs: metric.timing.ttftMs,
      providerDurationMs: metric.timing.providerDurationMs,
    });
    if (this.record.turns.length > MAX_TURNS_KEPT)
      this.record.turns.splice(0, this.record.turns.length - MAX_TURNS_KEPT);
    void this.flush();
  }

  private materializeDerived(): void {
    if (this.finalized && this.clusterCounts.size === 0 && this.repeatCounts.size === 0) return;
    this.record.errorClusters = [...this.clusterCounts.entries()]
      .map(([digest, { count }]) => ({ digest, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_ERROR_CLUSTERS);
    this.record.repeats = [...this.repeatCounts.values()]
      .filter((e) => e.count >= REPEAT_THRESHOLD)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_REPEATED_KEYS);
  }

  /** Synchronous, bounded, temp-then-rename like SubAgentStore: the headless
   * host may exit immediately after the last turn. Never overwrite in place. */
  flush(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    let temp: string | undefined;
    try {
      this.materializeDerived();
      const id = this.getSessionId() || (this.fallbackSessionId ??= randomUUID());
      this.record.sessionId = sessionKey(id);
      const root = path.resolve(this.dir ?? diagnosticsSessionsDir());
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      if (!fs.lstatSync(root).isDirectory()) return Promise.resolve();
      fs.chmodSync(root, 0o700);
      const file = path.join(root, `${this.record.sessionId}.json`);
      if (path.dirname(file) !== root) return Promise.resolve();
      const sanitized = redactValue(this.record, { secrets: environmentSecrets(process.env) });
      const validated = recordSchema.safeParse(sanitized);
      if (!validated.success) return Promise.resolve();
      const serialized = JSON.stringify(validated.data);
      if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES) return Promise.resolve();
      temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(temp, serialized, { flag: "wx", mode: 0o600 });
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, file);
    } catch {
      // Best-effort, without logging untrusted data or disrupting the session.
    } finally {
      if (temp) {
        try {
          fs.unlinkSync(temp);
        } catch {
          /* Already renamed or not created. */
        }
      }
    }
    return Promise.resolve();
  }

  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.record.endedAt = Date.now();
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    await this.flush();
    this.pendingCalls.clear();
    this.repeatCounts.clear();
    this.clusterCounts.clear();
  }

  getRecord(): Readonly<SessionDiagnosticsRecord> {
    this.materializeDerived();
    return structuredClone(this.record);
  }

  // Test accessors — fresh derived state, independent of flush timing.
  snapshotForTests(): SessionDiagnosticsRecord {
    this.materializeDerived();
    return JSON.parse(JSON.stringify(this.record)) as SessionDiagnosticsRecord;
  }
  repeatsForTests(): RepeatEntry[] {
    this.materializeDerived();
    return [...this.record.repeats];
  }
  errorClustersForTests(): ErrorCluster[] {
    this.materializeDerived();
    return [...this.record.errorClusters];
  }

  /** Compact agent-readable summary of THIS session (for session_stats). */
  summary(): string {
    this.materializeDerived();
    return summarizeRecord(this.record);
  }
}

// ── Summaries + aggregation ─────────────────────────────────

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((100 * part) / whole).toFixed(0)}%` : "—";
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function summarizeRecord(r: SessionDiagnosticsRecord): string {
  const parsed = recordSchema.safeParse(r);
  if (!parsed.success) return "No valid session diagnostics record.";
  r = parsed.data;
  const lines: string[] = [];
  const t = r.totals;
  const promptTotal = t.inputTokens + t.cacheRead;
  lines.push(
    `Session ${r.sessionId} (${r.provider}/${r.model}) — ${t.turns} turns, ${t.toolCalls} tool calls (${t.toolErrors} errors).`,
  );
  lines.push(
    `Tokens: ${t.inputTokens + t.cacheRead} prompt (${t.cacheRead} cached, ${pct(t.cacheRead, promptTotal)} reuse), ${t.outputTokens} output.`,
  );
  if (r.modelSwitches.length) {
    lines.push(
      `Model switches: ${r.modelSwitches.length} (each likely rebuilds the cached prefix).`,
    );
  }
  const ttfts = r.turns.map((x) => x.ttftMs).filter((x): x is number => typeof x === "number");
  if (ttfts.length) {
    const sorted = [...ttfts].sort((a, b) => a - b);
    lines.push(
      `TTFT median ${fmtMs(sorted[Math.floor(sorted.length / 2)])}, worst ${fmtMs(sorted[sorted.length - 1])}.`,
    );
  }
  const toolLines = Object.entries(r.toolStats)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 6)
    .map(([name, s]) => {
      const failed = s.errors + (s.softErrors ?? 0);
      const err = failed > 0 ? `, ${failed} failed (${pct(failed, s.calls)})` : "";
      const bad = failed > 0 && failed / s.calls >= 0.25 ? " ⚠" : "";
      return `- ${name}: ${s.calls} calls, ${fmtMs(s.totalMs)} total, ${fmtMs(s.maxMs)} max${err}${bad}`;
    });
  if (toolLines.length) lines.push("Tools (by total time):", ...toolLines);
  if (r.repeats.length) {
    lines.push(
      `Repeated identical calls: ${r.repeats.map((x) => `${x.tool}×${x.count}`).join(", ")} — usually a stuck pattern.`,
    );
  }
  for (const c of r.errorClusters.slice(0, 3)) {
    lines.push(`Top error (${c.count}×): ${c.digest}`);
  }
  if (r.truncations.length) {
    const continued = r.truncations.filter((x) => x.continued).length;
    lines.push(`Output cut off ${r.truncations.length}× (${continued} auto-continued).`);
  }
  if (r.compactions.length) {
    lines.push(
      `Compactions: ${r.compactions.length}× (${r.compactions
        .map((c) => `${c.originalCount}→${c.newCount} msgs`)
        .join(", ")}).`,
    );
  }
  return redactValue(lines.join("\n"), { secrets: environmentSecrets(process.env) });
}

export interface DiagnosticsAggregate {
  sessionCount: number;
  report: string;
}

/** Read the newest N session records and produce a ranked, agent-readable
 * findings report. Findings are ordered by cost × frequency, most urgent
 * first; "what works" is included so regressions are visible. */
export function aggregateRecentDiagnostics(limit = 20, dir?: string): DiagnosticsAggregate {
  if (!isInternalDiagnosticsEnabled())
    return { sessionCount: 0, report: "No session diagnostics: internal mode disabled." };
  const root = path.resolve(dir ?? diagnosticsSessionsDir());
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
  const files: { file: string; time: number }[] = [];
  try {
    if (!fs.lstatSync(root).isDirectory()) throw new Error("Invalid diagnostics directory");
    const directory = fs.opendirSync(root);
    try {
      // Bounded directory walk; one stat per candidate, never inside sort.
      for (let i = 0; i < 5000; i++) {
        const entry = directory.readSync();
        if (!entry) break;
        if (!entry.isFile() || !/^[a-zA-Z0-9_-]{1,128}\.json$/.test(entry.name)) continue;
        const file = path.join(root, entry.name);
        try {
          const stat = fs.lstatSync(file);
          if (stat.isFile() && stat.size <= MAX_RECORD_BYTES)
            files.push({ file, time: stat.mtimeMs });
        } catch {
          /* A concurrent cleanup must not invalidate other records. */
        }
      }
    } finally {
      directory.closeSync();
    }
  } catch {
    return { sessionCount: 0, report: "No session diagnostics found (is internal mode enabled?)." };
  }
  const records: SessionDiagnosticsRecord[] = [];
  for (const { file } of files.sort((a, b) => b.time - a.time).slice(0, 100)) {
    try {
      const parsed = recordSchema.safeParse(JSON.parse(readBoundedFile(file)));
      if (parsed.success) records.push(parsed.data);
      if (records.length >= limit) break;
    } catch {
      // Corrupt/old/raw records are ignored, never included in summaries.
    }
  }
  if (!records.length) {
    return { sessionCount: 0, report: "No valid session diagnostics records found." };
  }

  const findings: string[] = [];
  const toolAgg = new Map<
    string,
    { calls: number; errors: number; maxMs: number; totalMs: number }
  >();
  const clusterAgg = new Map<string, number>();
  const repeatAgg = new Map<string, number>();
  let input = 0;
  let cacheRead = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let truncations = 0;
  let compactions = 0;
  let modelSwitches = 0;
  const ttfts: number[] = [];

  for (const r of records) {
    input += r.totals.inputTokens;
    cacheRead += r.totals.cacheRead;
    toolCalls += r.totals.toolCalls;
    toolErrors += r.totals.toolErrors;
    truncations += r.truncations.length;
    compactions += r.compactions.length;
    modelSwitches += r.modelSwitches.length;
    for (const x of r.turns) if (typeof x.ttftMs === "number") ttfts.push(x.ttftMs);
    for (const [name, s] of Object.entries(r.toolStats)) {
      const agg = toolAgg.get(name) ?? { calls: 0, errors: 0, maxMs: 0, totalMs: 0 };
      agg.calls += s.calls;
      agg.errors += s.errors + (s.softErrors ?? 0);
      agg.maxMs = Math.max(agg.maxMs, s.maxMs);
      agg.totalMs += s.totalMs;
      toolAgg.set(name, agg);
    }
    for (const c of r.errorClusters)
      clusterAgg.set(c.digest, (clusterAgg.get(c.digest) ?? 0) + c.count);
    for (const rep of r.repeats) {
      const key = `${rep.tool}::${rep.argsDigest}`;
      repeatAgg.set(key, (repeatAgg.get(key) ?? 0) + rep.count);
    }
  }

  const promptTotal = input + cacheRead;
  findings.push(
    `${records.length} sessions — ${toolCalls} tool calls, ${toolErrors} errors (${pct(toolErrors, toolCalls)}), cache reuse ${pct(cacheRead, promptTotal)} across ${(promptTotal / 1000).toFixed(0)}k prompt tokens.`,
  );

  // 1. Error clusters — reliability, ranked by count.
  const clusters = [...clusterAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (clusters.length) {
    findings.push(
      "CHECK OUT — recurring errors:",
      ...clusters.map(([digest, n]) => `- ${n}× ${digest}`),
    );
  }

  // 2. High-failure-rate tools.
  const flaky = [...toolAgg.entries()]
    .filter(([, s]) => s.calls >= 5 && s.errors / s.calls >= 0.25)
    .sort((a, b) => b[1].errors / b[1].calls - a[1].errors / a[1].calls);
  if (flaky.length) {
    findings.push(
      "CHECK OUT — tools failing ≥25% of calls:",
      ...flaky.map(([name, s]) => `- ${name}: ${s.errors}/${s.calls} (${pct(s.errors, s.calls)})`),
    );
  }

  // 3. Slow tools — worst-case duration.
  const slow = [...toolAgg.entries()]
    .filter(([, s]) => s.maxMs >= 30_000)
    .sort((a, b) => b[1].maxMs - a[1].maxMs);
  if (slow.length) {
    findings.push(
      "SPEED — tools with ≥30s worst-case calls:",
      ...slow.map(([name, s]) => `- ${name}: max ${fmtMs(s.maxMs)}, total ${fmtMs(s.totalMs)}`),
    );
  }

  // 4. Repeats — wasted turns.
  const repeats = [...repeatAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (repeats.length) {
    findings.push(
      "WASTE — identical calls repeated ≥3× (stuck patterns):",
      ...repeats.map(([key]) => `- ${key.replace("::", " ")}`),
    );
  }

  // 5. Cache + compaction pressure.
  if (modelSwitches > 0) {
    findings.push(
      `COST — ${modelSwitches} mid-session model switch(es): each one can rebuild the cached prefix and re-bill the whole context.`,
    );
  }
  if (compactions > 0) findings.push(`COST — ${compactions} compaction(s) across these sessions.`);
  if (truncations > 0)
    findings.push(`RELIABILITY — output cut off ${truncations}× (output-token limits).`);

  if (ttfts.length) {
    const sorted = [...ttfts].sort((a, b) => a - b);
    findings.push(
      `SPEED — TTFT median ${fmtMs(sorted[Math.floor(sorted.length / 2)])}, p95 ${fmtMs(sorted[Math.floor(sorted.length * 0.95)])} over ${ttfts.length} turns.`,
    );
  }

  // What's working — the counterfactual baseline.
  const healthy = [...toolAgg.entries()].filter(([, s]) => s.calls >= 5 && s.errors === 0);
  if (healthy.length) {
    findings.push(`WORKING — zero-error tools (≥5 calls): ${healthy.map(([n]) => n).join(", ")}.`);
  }

  return {
    sessionCount: records.length,
    report: redactValue(findings.join("\n"), { secrets: environmentSecrets(process.env) }),
  };
}

// ── /diagnose slash command ────────────────────────────────

/** Internal-only command; registered exclusively when the internal flag is on. */
export function createDiagnoseCommand(): SlashCommand {
  return {
    name: "diagnose",
    aliases: ["diag"],
    description: "Internal: aggregate recent session diagnostics into ranked findings",
    usage: "/diagnose [sessions]",
    execute(args) {
      const parsed = Number.parseInt(args.trim(), 10);
      const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
      return aggregateRecentDiagnostics(limit).report;
    },
  };
}
