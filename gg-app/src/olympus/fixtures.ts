// Subagent records for tests and previews: the mockup's run (run.js: Kleio's
// four as the plan sent them, and its three extras), as this app would hold
// them, and one record for each state a row can show.

import type { SubAgentLine } from "../SubAgentFeed";

/** [ms after the agent was sent, the activity as the host words it, tokens so far in thousands]. */
type Step = readonly [at: number, activity: string, tokensK: number];

export interface FixtureAgent {
  readonly id: string;
  /** The bundled agent it runs as; none for an agent with no name of its own. */
  readonly agentType?: string;
  /** Sent by spawn_agent under this task name, so its activities are raw. */
  readonly taskName?: string;
  readonly task: string;
  /** Ms into the run when it was sent. */
  readonly sentAt: number;
  readonly steps: readonly Step[];
  readonly end: readonly [at: number, status: "done" | "error", result: string, tokensK: number];
}

/** Kleio's four: three end done, one with an error. */
export const MOCK_RUN: readonly FixtureAgent[] = [
  {
    id: "owl-1",
    agentType: "owl",
    sentAt: 0,
    task: "Survey how the other routes throttle requests",
    steps: [
      [450, "Reading src/http/routes.ts", 2.4],
      [4900, 'Searching for "rateLimit("', 5.1],
      [8100, "Listing src/http/middleware", 7.0],
      [8300, 'Finding "*throttle*.ts"', 7.9],
      [8500, 'Searching for "throttle("', 9.1],
      [8700, "Reading …/middleware/throttle.ts", 12.9],
      [11200, "Reading …/public/routes.ts", 19.6],
    ],
    end: [13000, "done", "2 of 9 routes throttle; none guards `/login`", 22.1],
  },
  {
    id: "bee-1",
    agentType: "bee",
    sentAt: 120,
    task: "Build `createLimiter()` in `src/http/limits.ts`",
    steps: [
      [650, "Reading src/http/limits.ts", 3.1],
      [5300, "Reading …/middleware/throttle.ts", 6.0],
      [8200, "Editing src/http/limits.ts", 9.4],
      [8350, "Running pnpm test limits", 10.6],
      [8500, "Editing src/http/limits.ts", 11.8],
      [8650, "Running pnpm test limits", 13.0],
      [9500, "Editing src/http/limits.ts", 16.9],
      [14400, "Running pnpm test limits", 26.3],
    ],
    end: [16480, "done", "`createLimiter()` added in 3 edits", 31.7],
  },
  {
    id: "auditor-1",
    agentType: "auditor",
    sentAt: 240,
    task: "Audit `login.ts` for timing leaks",
    steps: [
      [800, "Reading src/auth/login.ts", 2.2],
      [4100, 'Searching for "bcrypt.compare("', 4.7],
      [7700, "Running node scripts/time-login.js", 7.4],
      [13800, "Searching web for constant-time string comparison", 9.6],
      [15900, "Fetching nodejs.org/api/crypto.html", 11.6],
      [17800, "Reading src/auth/users.ts", 13.1],
      [21800, 'Searching for "timingSafeEqual("', 16.9],
    ],
    end: [25260, "done", "One early return leaks timing; fix noted", 18.4],
  },
  {
    id: "unnamed-1",
    sentAt: 360,
    task: "Run the auth suite",
    steps: [
      [1000, "Running pnpm test auth", 1.6],
      [6800, "Editing test/auth/setup.ts", 4.1],
      [8600, "Fetching redis.io/docs/connect", 5.2],
      [12900, "Running pnpm test auth", 6.9],
      [16300, "Reading test/auth/output.log", 9.2],
    ],
    end: [20140, "error", "Redis wasn’t reachable; 2 of 41 tests failed", 9.8],
  },
];

/** The mockup's extras, here sent by spawn_agent: a task name each, raw activities. */
export const MOCK_EXTRAS: readonly FixtureAgent[] = [
  {
    id: "agent-r1",
    agentType: "researcher",
    taskName: "lockout-survey",
    sentAt: 0,
    task: "Find how other services lock out repeated logins",
    steps: [
      [500, "web_search: login lockout policy", 1.9],
      [3200, "read: docs/security.md", 5.2],
      [7700, "web_fetch: owasp.org/www-community/controls", 9.4],
      [10600, "read: services/billing/auth.ts", 11.7],
      [13800, "grep: lockout", 14.6],
    ],
    end: [15600, "done", "Two services lock out after 5 tries, for 15 minutes", 15.8],
  },
  {
    id: "agent-s1",
    agentType: "skeptic",
    taskName: "recheck-findings",
    sentAt: 120,
    task: "Re-check the auditor’s two findings",
    steps: [
      [500, "read: src/auth/login.ts", 2.0],
      [3400, "grep: return false", 3.3],
      [5600, "bash: node scripts/time-login.js", 4.6],
      [11600, "web_fetch: nodejs.org/api/crypto.html", 7.2],
    ],
    end: [17400, "done", "One finding confirmed, one dropped", 9.9],
  },
  {
    id: "agent-w1",
    agentType: "worker",
    taskName: "wire-login-limiter",
    sentAt: 240,
    task: "Wire the limiter into `POST /login`",
    steps: [
      [400, "read: src/http/routes.ts", 1.4],
      [4600, "edit: src/http/routes.ts", 4.0],
      [6900, "write: src/http/routes.test.ts", 5.5],
      [8800, "bash: pnpm test login", 7.7],
      [12700, "edit: src/http/routes.ts", 8.9],
    ],
    end: [15600, "error", "`pnpm test login` timed out", 9.3],
  },
];

const usage = (k: number): NonNullable<SubAgentLine["tokenUsage"]> => ({
  input: Math.round(k * 900),
  output: Math.round(k * 100),
});

/**
 * The records `ms` into a run, with `now` as this window's clock at that
 * moment. An agent not yet sent is left out.
 */
export function agentsAt(run: readonly FixtureAgent[], ms: number, now = ms): SubAgentLine[] {
  return run
    .filter((def) => ms >= def.sentAt)
    .map((def): SubAgentLine => {
      const t = ms - def.sentAt;
      const [endAt, endStatus, result, endTokens] = def.end;
      const spawned = def.taskName !== undefined;
      const steps = def.steps.filter(([at]) => at <= Math.min(t, endAt));
      const ended = t >= endAt;
      return {
        toolCallId: def.id,
        agentName: spawned ? def.taskName : def.agentType,
        agentType: def.agentType,
        ...(spawned ? { async: true } : { task: def.task }),
        // A spawned agent starts when its process is up; the subagent tool's is running at once.
        status: ended ? endStatus : spawned && steps.length === 0 ? "starting" : "running",
        activities: steps.map(([, activity]) => activity).slice(-12),
        toolUseCount: steps.length,
        tokenUsage: usage(ended ? endTokens : (steps[steps.length - 1]?.[2] ?? 0)),
        startedAt: now - t,
        ...(ended ? { durationMs: endAt, result } : spawned ? { durationMs: t } : {}),
      };
    });
}

const base: SubAgentLine = {
  toolCallId: "state",
  agentName: "auditor",
  agentType: "auditor",
  task: "Audit `login.ts` for timing leaks",
  status: "running",
  activities: ["Reading src/auth/login.ts", 'Searching for "bcrypt.compare("'],
  toolUseCount: 2,
  tokenUsage: usage(4.7),
  startedAt: 0,
};

/** One record for each state a record can be in. */
export const STATE_AGENTS: Readonly<Record<SubAgentLine["status"], SubAgentLine>> = {
  starting: { ...base, toolCallId: "s-starting", status: "starting", activities: [] },
  running: { ...base, toolCallId: "s-running" },
  done: {
    ...base,
    toolCallId: "s-done",
    status: "done",
    durationMs: 25_260,
    result: "One early return leaks timing; fix noted",
  },
  error: {
    ...base,
    toolCallId: "s-error",
    status: "error",
    durationMs: 9_400,
    result: "Lost track of `verifyPassword()`",
  },
  idle: {
    ...base,
    toolCallId: "s-idle",
    async: true,
    agentName: "audit-login",
    task: undefined,
    status: "idle",
    durationMs: 61_000,
    result: "One early return leaks timing; fix noted",
  },
  interrupted: {
    ...base,
    toolCallId: "s-interrupted",
    async: true,
    agentName: "audit-login",
    task: undefined,
    status: "interrupted",
    durationMs: 7_000,
    result: "Interrupted",
  },
};

/** A resumed chat's rows: a name, a status and a tool count are all it kept. */
export const RESUMED_AGENTS: readonly SubAgentLine[] = [
  {
    toolCallId: "history-0",
    agentName: "owl",
    status: "done",
    activities: [],
    toolUseCount: 9,
    tokenUsage: { input: 0, output: 0 },
  },
  {
    toolCallId: "history-1",
    agentName: undefined,
    status: "error",
    activities: [],
    toolUseCount: 5,
    tokenUsage: { input: 0, output: 0 },
  },
];
