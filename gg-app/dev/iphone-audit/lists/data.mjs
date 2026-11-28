// Made-up data for the lists audit. Nothing here comes from a real host.
import { KLEIO_SOURCE } from "../base.mjs";
export const ROOT = "/Users/demo/projects";
export const MOTION_ROOT = `${ROOT}/GG Motion`;

const AGO = ["2m ago", "14m ago", "1h ago", "3h ago", "yesterday", "2d ago", "3d ago", "5d ago", "1w ago", "2w ago", "3w ago", "1mo ago", "2mo ago", "Sep 14", "Aug 2"];
const ago = (i) => AGO[i % AGO.length];

const CHAT_TITLES = [
  "Plan the autumn release notes and decide which three customer stories lead the announcement email, the blog post and the in-app banner",
  "Budget",
  "What should I cook for six people on Friday when two are vegetarian?",
  "Hi",
  "Summarise the board pack",
  "Draft a reply to Priya about the supplier contract renewal, keeping the tone firm but friendly and under 150 words",
  "Translate",
  "Compare the three laptop quotes",
  "Supercalifragilisticexpialidocious_antidisestablishmentarianism_no_spaces_anywhere_in_this_title",
  "Weekly review: what slipped and why",
  "Ideas",
  "Explain the difference between a Roth and a traditional pension as if I were twelve",
  "Trip",
  "Rewrite the onboarding checklist for the new support hires",
  "https://example.com/a/very/long/url/that/has/no/natural/break/points/at/all/in/its/path?query=1&another=2",
  "Notes",
  "Which of these four fonts reads best at small sizes on a phone?",
  "Taxes",
  "Help me word a difficult message to my landlord about the boiler",
  "Brainstorm names for the internal newsletter",
  "Recipe",
  "Outline a 20-minute talk on why our deploys got slower",
  "Gift",
  "Turn these meeting notes into actions with owners and dates",
  "Mum",
  "Proofread the grant application summary",
  "Run",
  "What does this error from the bank export mean and how do I fix the CSV?",
  "Books",
  "Draft the Q4 hiring plan",
  "Quiz",
  "Suggest a week of dinners under forty pounds",
  "Check my maths on the mortgage overpayment",
  "Poem",
];
const AGENTS = ["general", "therapist", "research"];
export const chats = (n) =>
  CHAT_TITLES.slice(0, n).map((preview, i) => ({
    id: `chat-${i + 1}`,
    path: `${ROOT}/.kleio/chats/chat-${i + 1}.jsonl`,
    preview,
    lastActiveDisplay: ago(i),
    messageCount: [4, 128, 12, 1, 36, 2048, 7, 19][i % 8],
    chatAgent: AGENTS[i % 3],
  }));

const MOTION_TITLES = [
  "A 30-second launch teaser for the aurora store with the product spinning in on a dark stage and three feature callouts",
  "Logo",
  "Animated bar chart of quarterly revenue",
  "Intro",
  "Explainer: how idempotency keys stop double charges, in four scenes with captions",
  "Countdown",
  "Kinetic typography for the conference opener",
  "Loop",
  "Product_demo_final_FINAL_v7_really_final_this_time_no_spaces.mp4 re-cut",
  "Title card",
  "Lower thirds for the interview series",
  "Outro",
  "Map animation of the delivery route from Leeds to Lisbon",
  "Reel",
  "Screen recording polish: zooms, cursor highlights and callouts for the settings walkthrough",
  "Sting",
  "Birthday card animation for Sam",
  "Chart race",
  "Pricing table reveal",
  "Bumper",
  "Testimonial quote cards",
  "Weather",
  "Year in review montage with music beats",
  "Promo",
  "Confetti burst on success screen",
  "GIF",
  "Onboarding carousel as a video",
  "Wave",
  "Podcast audiogram with waveform",
  "Timer",
  "App store preview, portrait, 6.7 inch",
  "Sale",
];
export const motions = (n) =>
  MOTION_TITLES.slice(0, n).map((preview, i) => ({
    id: `motion-${i + 1}`,
    path: `${MOTION_ROOT}/.kleio/sessions/motion-${i + 1}.jsonl`,
    preview,
    lastActiveDisplay: ago(i),
    messageCount: [6, 42, 3, 310, 15][i % 5],
  }));

const GOAL_NAMES = [
  ["API latency", "Get checkout loading under one second on mobile, measured at the 95th percentile across the three slowest regions", "running", 2, 1],
  ["Docs refresh", "Rewrite the getting-started guide", "paused", 1, 0],
  ["Billing v2", "Move every customer from the legacy invoicing tables to the new ledger without a single double charge, and prove it with a reconciliation report signed off by finance", "idle", 0, 3],
  ["Flaky tests", "Find and fix the ten flakiest tests", "interrupted", 0, 0],
  ["Onboarding", "Halve the steps to first value", "briefing", 3, 2],
  ["Search", "Relevance", "running", 0, 0],
  ["WWWWWWWWWWWWWWW", "A name at the 15 character limit, all wide letters", "paused", 12, 8],
  ["i18n", "Ship German, French and Japanese", "idle", 1, 1],
  ["Perf budget", "Keep the bundle under 300 kB and fail CI when it grows", "running", 0, 2],
  ["A11y audit", "Reach WCAG 2.2 AA on the five busiest screens", "idle", 2, 0],
  ["Data export", "Let customers export everything they own as a single archive", "interrupted", 1, 4],
  ["Dark mode", "Finish it", "idle", 0, 0],
  ["Rate limits", "Protect the public API from the scraper that took us down in September without hurting the three partners who legitimately call it in bursts", "paused", 0, 1],
  ["Mobile nav", "Rework the tab bar", "briefing", 0, 0],
  ["Support bot", "Answer the top twenty tickets automatically", "running", 4, 4],
  ["Cost cut", "Trim the cloud bill by a fifth", "idle", 0, 0],
  ["SSO", "Add SAML and SCIM", "idle", 1, 0],
  ["Changelog", "Publish one every Friday", "paused", 0, 1],
  ["Crash rate", "Under 0.1% of sessions", "running", 2, 2],
  ["Migrations", "Zero-downtime schema changes", "idle", 0, 0],
  ["Email", "Rebuild the digest", "idle", 0, 0],
  ["Pricing page", "Test three layouts and keep the winner", "interrupted", 0, 2],
  ["Audit log", "Record every admin action", "idle", 1, 0],
  ["Backups", "Prove a restore works", "running", 0, 0],
];
const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const goals = (n) =>
  GOAL_NAMES.slice(0, n).map(([name, goal, status, folders, files], i) => ({
    id: `goal-${i + 1}`,
    name,
    goal,
    context: [
      ...Array.from({ length: folders }, (_, k) => ({ path: `${ROOT}/ctx-${i}-${k}`, kind: "folder" })),
      ...Array.from({ length: files }, (_, k) => ({ path: `${ROOT}/ctx-${i}/spec-${k}.md`, kind: "file" })),
    ],
    path: `/Users/demo/.kleio/goals/${slugOf(name)}-${i + 1}`,
    createdAt: "2026-10-01T09:00:00.000Z",
    lastActiveMs: Date.UTC(2026, 10, 27) - i * 3_600_000,
    lastActiveDisplay: ago(i),
    latestSessionPath: `/Users/demo/.kleio/goals/${slugOf(name)}-${i + 1}/session.jsonl`,
    status,
  }));

const PROJECT_NAMES = [
  ["aurora-store", [KLEIO_SOURCE]],
  ["pixel-pipeline", [KLEIO_SOURCE, "claude-code"]],
  ["rusty-parser", ["codex"]],
  ["landing-page", ["folder"]],
  ["enterprise-customer-data-platform-ingestion-service-v2-rewrite", [KLEIO_SOURCE, "claude-code", "codex", "ken"]],
  ["x", [KLEIO_SOURCE]],
  ["marketing-site-2026-autumn-campaign-landing-pages", ["claude-code", "codex"]],
  ["api", [KLEIO_SOURCE, "claude-code", "codex", "folder", "ken"]],
  ["ios-app", [KLEIO_SOURCE]],
  ["design-system", [KLEIO_SOURCE, "ken"]],
  ["infra", ["codex"]],
  ["billing-ledger-reconciliation-tools", [KLEIO_SOURCE]],
  ["docs", ["folder"]],
  ["ml-experiments", ["claude-code"]],
  ["kleio-plugins", [KLEIO_SOURCE]],
  ["scratch", ["folder"]],
  ["ThisIsAProjectNameWithNoDashesOrSpacesAtAllWhichCannotWrapNaturallyAnywhere", [KLEIO_SOURCE, "codex"]],
  ["web", [KLEIO_SOURCE]],
  ["android-app", ["claude-code"]],
  ["analytics-dashboards", [KLEIO_SOURCE, "claude-code"]],
  ["cli", ["codex"]],
  ["onboarding-flow", [KLEIO_SOURCE]],
  ["status-page", ["folder"]],
  ["search-relevance", [KLEIO_SOURCE, "ken"]],
  ["auth", [KLEIO_SOURCE]],
  ["email-templates", ["claude-code"]],
  ["data-warehouse-dbt-models", [KLEIO_SOURCE, "codex"]],
  ["support-bot", [KLEIO_SOURCE]],
  ["feature-flags", ["codex"]],
  ["playground", ["folder"]],
  ["perf-lab", [KLEIO_SOURCE]],
  ["release-notes", [KLEIO_SOURCE, "claude-code"]],
];
export const projects = (n) =>
  PROJECT_NAMES.slice(0, n).map(([name, sources], i) => ({
    name,
    path: `${ROOT}/${name}`,
    lastActiveDisplay: ago(i),
    sources,
  }));

const SESSION_TITLES = [
  ["Add checkout retry with idempotency keys so a double tap on Pay never charges the customer twice, and cover it with an integration test", undefined],
  ["Fix", undefined],
  ["Port the image resizer to sharp", "claude-code"],
  ["Why is the cart total wrong when a discount code and a gift card are applied together?", "codex"],
  ["Refactor", undefined],
  ["src/components/checkout/PaymentMethodSelector/PaymentMethodSelector.stories.tsx is failing typecheck", undefined],
  ["Bump deps", "claude-code"],
  ["Write the migration for the orders table", undefined],
  ["", undefined],
  ["Lint", "codex"],
  ["Investigate the memory leak in the websocket gateway under sustained load", undefined],
  ["Tests", undefined],
  ["Add dark mode tokens", undefined],
  ["Review the PR from Sam on rate limiting", "claude-code"],
  ["CI", undefined],
  ["Speed up the Docker build by caching the pnpm store between layers", undefined],
  ["Typo", undefined],
  ["Explain how the retry queue works", "codex"],
  ["Rename OrderService to OrdersService everywhere", undefined],
  ["Docs", undefined],
  ["Add an end-to-end test for guest checkout", undefined],
  ["Profile", undefined],
  ["Replace moment with date-fns", "claude-code"],
  ["Flag", undefined],
  ["Generate OpenAPI types and wire them into the client", undefined],
  ["Seed", undefined],
  ["Fix the flaky cart integration test", undefined],
  ["Hook", undefined],
  ["Upgrade to React 19 and fix the warnings", "codex"],
  ["Logs", undefined],
  ["Add structured logging to the payment webhook handler", undefined],
  ["Wip", undefined],
];
export const sessions = (n, cwd = `${ROOT}/aurora-store`) =>
  SESSION_TITLES.slice(0, n).map(([preview, source], i) => ({
    id: `sess-${i + 1}`,
    path: `${cwd}/.kleio/sessions/sess-${i + 1}.jsonl`,
    preview,
    lastActiveDisplay: ago(i),
    messageCount: [24, 1, 61, 8, 1024, 3][i % 6],
    ...(source ? { source } : {}),
  }));

const FOLDER_NAMES = [
  "aurora-store", "pixel-pipeline", "rusty-parser", "landing-page", "site", "site",
  "enterprise-customer-data-platform-ingestion-service-v2-rewrite", "x", "docs", "infra",
  "ml-experiments", "scratch", "old-prototype", "archive-2024",
];
export const hostFolders = (n) =>
  FOLDER_NAMES.slice(0, n).map((name, i) => ({
    name,
    path: i === 5 ? `/Users/demo/client-work/${name}` : `${ROOT}/${name}`,
    hidden: i >= 11,
  }));

/** agent_sessions answered by what was asked for. */
export const sessionsFor = ({ chat = [], motion = [], project = [] }) => (cmd, args) => {
  if (cmd !== "agent_sessions") return undefined;
  if (args?.chatAgent === "motion") return { sessions: motion };
  if (args?.chatAgent) return { sessions: chat };
  return { sessions: typeof project === "function" ? project(args?.cwd) : project };
};
