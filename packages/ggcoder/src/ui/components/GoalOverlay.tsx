import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useInput, useStdout } from "ink";
import { basename } from "node:path";
import {
  formatGoalPrerequisiteInstruction,
  goalHasBlockingPrerequisites,
  isBlockingGoalPrerequisite,
  loadGoalRuns,
  saveGoalRuns,
  summarizeGoalCountsFromRuns,
  type GoalRun,
  type GoalRunStatus,
} from "../../core/goal-store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { buildGoalFinalSummarySections } from "../goal-summary.js";
import { Markdown } from "./Markdown.js";
import { useTheme } from "../theme/theme.js";

const GOAL_LOGO = [" ▄▀▀▀ ▄▀▀▀", " █ ▀█ █ ▀█", " ▀▄▄▀ ▀▄▄▀"];
const GRADIENT = [
  "#4ade80",
  "#5ad89a",
  "#6fd2b4",
  "#85ccce",
  "#60a5fa",
  "#85ccce",
  "#6fd2b4",
  "#5ad89a",
];
const GOAL_SUCCESS = "#4ade80";
const GOAL_ACTIVE = "#fbbf24";
const GAP = "   ";
const LOGO_WIDTH = 9;
const SIDE_BY_SIDE_MIN = LOGO_WIDTH + GAP.length + 20;
const PREFIX_WIDTH = 2;

export interface GoalOverlayProps {
  cwd: string;
  onClose: () => void;
  onRunGoal: (run: GoalRun) => void;
  onVerifyGoal: (run: GoalRun) => void;
  onPauseGoal: (run: GoalRun) => void;
  onRefineGoal?: (run: GoalRun, feedback: string) => void;
  agentRunning?: boolean;
  autoExpandNewest?: boolean;
}

export function clampGoalSelectedIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}

export function formatGoalPrerequisiteSummary(run: GoalRun): string {
  if (run.prerequisites.length === 0) return "no prereqs";
  const met = run.prerequisites.filter((item) => item.status === "met").length;
  const missing = run.prerequisites.filter((item) => item.status === "missing").length;
  const unknown = run.prerequisites.filter((item) => item.status === "unknown").length;
  const suffix = [missing > 0 ? `${missing} missing` : "", unknown > 0 ? `${unknown} unknown` : ""]
    .filter(Boolean)
    .join(", ");
  return `${met}/${run.prerequisites.length} prereqs met${suffix ? ` (${suffix})` : ""}`;
}

export function formatGoalTaskSummary(run: GoalRun): string {
  if (run.tasks.length === 0) return "no tasks";
  const done = run.tasks.filter((item) => item.status === "done").length;
  const running = run.tasks.filter(
    (item) => item.status === "running" || item.status === "verifying",
  ).length;
  const failed = run.tasks.filter((item) => item.status === "failed").length;
  const blocked = run.tasks.filter((item) => item.status === "blocked").length;
  const suffix = [
    running > 0 ? `${running} running` : "",
    failed > 0 ? `${failed} failed` : "",
    blocked > 0 ? `${blocked} blocked` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `${done}/${run.tasks.length} tasks done${suffix ? ` (${suffix})` : ""}`;
}

export function formatGoalVerifierSummary(run: GoalRun): string {
  if (run.verifier?.lastResult) return `verifier ${run.verifier.lastResult.status}`;
  if (run.verifier?.command) return "verifier command ready";
  if (run.verifier?.description) return "verifier described";
  return "no verifier";
}

export function getGoalReadinessText(run: GoalRun): string {
  if (goalHasBlockingPrerequisites(run)) return "needs user input";
  if (run.status === "running" || run.status === "verifying") return "work in progress";
  if (run.status === "passed") return "verified";
  if (run.verifier?.command) return "ready to verify";
  if (run.tasks.length > 0) return "ready to run";
  return "drafting plan";
}

export function formatGoalProgressText(run: GoalRun): string {
  const prereqTotal = run.prerequisites.length;
  const prereqMet = run.prerequisites.filter((item) => item.status === "met").length;
  const taskTotal = run.tasks.length;
  const taskDone = run.tasks.filter((item) => item.status === "done").length;
  const prereq = prereqTotal > 0 ? `prereqs ${prereqMet}/${prereqTotal}` : "no prereqs";
  const tasks = taskTotal > 0 ? `tasks ${taskDone}/${taskTotal}` : "no tasks";
  return `${prereq} · ${tasks}`;
}

export function getGoalStatusCountsText(runs: readonly GoalRun[]): string {
  const counts = summarizeGoalCountsFromRuns(runs);
  return `${counts.passed} passed · ${counts.running} running · ${counts.pending} pending · ${counts.blocked} blocked`;
}

export function clampGoalScrollOffset(
  offset: number,
  itemCount: number,
  viewportRows: number,
): number {
  const visibleRows = Math.max(1, Math.floor(viewportRows));
  const maxOffset = Math.max(0, itemCount - visibleRows);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), maxOffset);
}

export function getGoalOverlayViewportRows(terminalRows: number, reservedRows = 8): number {
  if (!Number.isFinite(terminalRows)) return 8;
  return Math.max(4, Math.floor(terminalRows) - reservedRows);
}

export function getGoalScrollOffsetForSelection({
  selectedIndex,
  currentOffset,
  itemCount,
  viewportRows,
}: {
  selectedIndex: number;
  currentOffset: number;
  itemCount: number;
  viewportRows: number;
}): number {
  const selected = clampGoalSelectedIndex(selectedIndex, itemCount);
  const offset = clampGoalScrollOffset(currentOffset, itemCount, viewportRows);
  const rows = Math.max(1, Math.floor(viewportRows));
  if (selected < offset) return selected;
  if (selected >= offset + rows) return clampGoalScrollOffset(selected - rows + 1, itemCount, rows);
  return offset;
}

export function getGoalCardExtraRowCount(run: GoalRun): number {
  let count = 0;
  if (goalHasBlockingPrerequisites(run)) count += 1;
  else if (run.status === "running" || run.status === "verifying") count += 1;
  if (run.blockers.length > 0) count += 1;
  return count;
}

export function getGoalListCardRowCount({ run }: { run: GoalRun }): number {
  const compactCardRows =
    1 + // title/status row
    2 + // compact summary rows
    getGoalCardExtraRowCount(run);
  const marginRows = 1;
  return compactCardRows + marginRows;
}

export interface GoalListWindow {
  start: number;
  end: number;
  hiddenBefore: number;
  hiddenAfter: number;
  rowsUsed: number;
}

function compareGoalListWindows({
  candidate,
  current,
  selectedIndex,
}: {
  candidate: GoalListWindow;
  current: GoalListWindow | null;
  selectedIndex: number;
}): GoalListWindow {
  if (!current) return candidate;
  const candidateCount = candidate.end - candidate.start;
  const currentCount = current.end - current.start;
  if (candidateCount !== currentCount) return candidateCount > currentCount ? candidate : current;
  if (candidate.rowsUsed !== current.rowsUsed)
    return candidate.rowsUsed > current.rowsUsed ? candidate : current;
  const candidateBalance = Math.abs(
    selectedIndex - candidate.start - (candidate.end - selectedIndex - 1),
  );
  const currentBalance = Math.abs(
    selectedIndex - current.start - (current.end - selectedIndex - 1),
  );
  if (candidateBalance !== currentBalance)
    return candidateBalance < currentBalance ? candidate : current;
  return candidate.start > current.start ? candidate : current;
}

export function getGoalListWindow({
  runs,
  selectedIndex,
  viewportRows,
}: {
  runs: readonly GoalRun[];
  selectedIndex: number;
  viewportRows: number;
}): GoalListWindow {
  const rows = Number.isFinite(viewportRows) ? Math.max(1, Math.floor(viewportRows)) : 8;
  const fixedRows = 1;
  if (runs.length === 0) {
    return { start: 0, end: 0, hiddenBefore: 0, hiddenAfter: 0, rowsUsed: fixedRows };
  }

  const selected = clampGoalSelectedIndex(selectedIndex, runs.length);
  let best: GoalListWindow | null = null;

  for (let start = 0; start <= selected; start++) {
    let cardRows = 0;
    for (let end = start + 1; end <= runs.length; end++) {
      const index = end - 1;
      const run = runs[index];
      if (!run) continue;
      cardRows += getGoalListCardRowCount({ run });
      if (end <= selected) continue;

      const hiddenBefore = start;
      const hiddenAfter = runs.length - end;
      const indicatorRows = (hiddenBefore > 0 ? 1 : 0) + (hiddenAfter > 0 ? 1 : 0);
      const rowsUsed = fixedRows + indicatorRows + cardRows;
      if (rowsUsed > rows) continue;

      best = compareGoalListWindows({
        candidate: { start, end, hiddenBefore, hiddenAfter, rowsUsed },
        current: best,
        selectedIndex: selected,
      });
    }
  }

  if (best) return best;

  const start = selected;
  const end = selected + 1;
  const hiddenBefore = start;
  const hiddenAfter = runs.length - end;
  const indicatorRows = (hiddenBefore > 0 ? 1 : 0) + (hiddenAfter > 0 ? 1 : 0);
  const run = runs[selected];
  const cardRows = run ? getGoalListCardRowCount({ run }) : 0;
  return {
    start,
    end,
    hiddenBefore,
    hiddenAfter,
    rowsUsed: fixedRows + indicatorRows + cardRows,
  };
}

export function sortGoalRunsForOverlay(runs: readonly GoalRun[]): GoalRun[] {
  return [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getGoalAutoExpandedState({
  autoExpandNewest,
  loaded,
  runs,
  alreadyExpanded,
}: {
  autoExpandNewest: boolean | undefined;
  loaded: boolean;
  runs: readonly GoalRun[];
  alreadyExpanded: boolean;
}): { selectedIndex: number; expandedRunId: string } | null {
  if (!autoExpandNewest || !loaded || runs.length === 0 || alreadyExpanded) return null;
  const newestRun = runs[0];
  if (!newestRun) return null;
  return { selectedIndex: 0, expandedRunId: newestRun.id };
}

export function shouldPersistGoalOverlayRuns(
  previousRuns: readonly GoalRun[],
  nextRuns: readonly GoalRun[],
): boolean {
  if (nextRuns.length > 0) return true;
  if (previousRuns.length === 0) return true;
  return !previousRuns.some(
    (run) =>
      run.status === "running" ||
      run.status === "verifying" ||
      run.activeWorkerId !== undefined ||
      run.tasks.some((task) => task.status === "running" || task.status === "verifying"),
  );
}

function GoalGradientText({ text }: { text: string }) {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[colorIdx % GRADIENT.length];
      chars.push(
        <Text key={i} color={color}>
          {ch}
        </Text>,
      );
      colorIdx++;
    }
  }
  return <Text>{chars}</Text>;
}

function formatDisplayPath(cwd: string): string {
  const home = process.env.HOME ?? "";
  return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

function statusColor(status: GoalRunStatus): string {
  switch (status) {
    case "passed":
      return GOAL_SUCCESS;
    case "running":
    case "verifying":
    case "blocked":
      return GOAL_ACTIVE;
    case "failed":
      return "red";
    case "paused":
    case "draft":
    case "ready":
      return "";
  }
}

export function getGoalCardStatusColor({
  status,
  selected,
  primaryColor,
  textColor,
}: {
  status: GoalRunStatus;
  selected: boolean;
  primaryColor: string;
  textColor: string;
}): string {
  return statusColor(status) || (selected ? primaryColor : textColor);
}

export function getGoalCardTitleColor({
  selected,
  primaryColor,
  textColor,
}: {
  selected: boolean;
  primaryColor: string;
  textColor: string;
}): string {
  return selected ? primaryColor : textColor;
}

function verifierSummaryColor(run: GoalRun, fallbackColor: string): string {
  if (run.verifier?.lastResult) return verifierStatusColor(run.verifier.lastResult.status);
  if (run.verifier?.command) return "cyan";
  if (run.verifier?.description) return "magenta";
  return fallbackColor;
}

function verifierStatusColor(
  status: NonNullable<NonNullable<GoalRun["verifier"]>["lastResult"]>["status"],
): string {
  switch (status) {
    case "pass":
      return "green";
    case "fail":
      return "red";
    case "unknown":
      return "yellow";
  }
}

function normalizeGoalPlanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function markdownListItem(text: string): string {
  const normalized = normalizeGoalPlanText(text);
  return `- ${normalized || "not recorded"}`;
}

function markdownCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``;
}

function appendGoalMetadataLine(lines: string[], label: string, value: string | undefined): void {
  if (!value) return;
  lines.push(`  - ${label}: ${value}`);
}

export function formatGoalPlanMarkdown(run: GoalRun): string {
  const lines: string[] = [
    `# ${run.title}`,
    "",
    `**Status:** ${run.status}`,
    `**Readiness:** ${getGoalReadinessText(run)}`,
    `**Progress:** ${formatGoalProgressText(run)}`,
    `**Verifier:** ${formatGoalVerifierSummary(run)}`,
    `**Goal ID:** ${run.id}`,
    `**Project:** ${run.projectPath}`,
    `**Updated:** ${run.updatedAt}`,
    "",
    "## Goal",
    "",
    run.goal || run.title,
    "",
    "## Success criteria",
    "",
  ];

  if (run.successCriteria.length === 0) {
    lines.push("- none recorded");
  } else {
    lines.push(...run.successCriteria.map(markdownListItem));
  }

  const finalSummarySections = buildGoalFinalSummarySections(run);
  if (finalSummarySections.length > 0) {
    lines.push("", "## Final summary", "");
    for (const section of finalSummarySections) {
      lines.push(`### ${section.title}`, "", ...section.lines.map(markdownListItem), "");
    }
  }

  lines.push("", "## User prerequisites", "");
  if (run.prerequisites.length === 0) {
    lines.push("- none recorded");
  } else {
    for (const prerequisite of run.prerequisites) {
      lines.push(`- **${prerequisite.status}** ${prerequisite.label}`);
      appendGoalMetadataLine(lines, "ID", markdownCode(prerequisite.id));
      appendGoalMetadataLine(
        lines,
        "Check",
        prerequisite.checkCommand ? markdownCode(prerequisite.checkCommand) : undefined,
      );
      appendGoalMetadataLine(lines, "Instructions", prerequisite.instructions);
      appendGoalMetadataLine(lines, "Evidence", prerequisite.evidence);
      if (isBlockingGoalPrerequisite(prerequisite)) {
        appendGoalMetadataLine(
          lines,
          "User action required",
          formatGoalPrerequisiteInstruction(prerequisite),
        );
      }
    }
  }

  lines.push("", "## Worker tasks", "");
  if (run.tasks.length === 0) {
    lines.push(
      goalHasBlockingPrerequisites(run)
        ? "- Waiting for prerequisites before workers can start."
        : "- No worker tasks yet — run the goal to generate focused work.",
    );
  } else {
    for (const task of run.tasks) {
      lines.push(`- **${task.status}** ${task.title}`);
      appendGoalMetadataLine(lines, "ID", markdownCode(task.id));
      appendGoalMetadataLine(lines, "Attempts", String(task.attempts));
      appendGoalMetadataLine(
        lines,
        "Worker",
        task.workerId ? markdownCode(task.workerId) : undefined,
      );
      appendGoalMetadataLine(lines, "Prompt", task.prompt);
      if (task.verification) {
        appendGoalMetadataLine(lines, "Verification", task.verification.status);
        appendGoalMetadataLine(lines, "Verification summary", task.verification.summary);
        appendGoalMetadataLine(
          lines,
          "Verification command",
          task.verification.command ? markdownCode(task.verification.command) : undefined,
        );
        appendGoalMetadataLine(lines, "Verification output", task.verification.outputPath);
      }
      appendGoalMetadataLine(lines, "Last summary", task.lastSummary);
    }
  }

  lines.push("", "## Harness", "");
  if (run.harness.length === 0) {
    lines.push("- none recorded");
  } else {
    for (const item of run.harness) {
      lines.push(`- ${item.label}`);
      appendGoalMetadataLine(lines, "ID", markdownCode(item.id));
      appendGoalMetadataLine(
        lines,
        "Command",
        item.command ? markdownCode(item.command) : undefined,
      );
      appendGoalMetadataLine(lines, "Path", item.path ? markdownCode(item.path) : undefined);
      appendGoalMetadataLine(lines, "Description", item.description);
    }
  }

  lines.push("", "## Evidence plan", "");
  if (run.evidencePlan.length === 0) {
    lines.push("- none recorded");
  } else {
    for (const item of run.evidencePlan) {
      lines.push(`- **${item.status}** ${item.label} (${item.mechanism})`);
      appendGoalMetadataLine(lines, "ID", markdownCode(item.id));
      appendGoalMetadataLine(lines, "Description", item.description);
      appendGoalMetadataLine(
        lines,
        "Command",
        item.command ? markdownCode(item.command) : undefined,
      );
      appendGoalMetadataLine(lines, "Path", item.path ? markdownCode(item.path) : undefined);
      appendGoalMetadataLine(lines, "Instructions", item.instructions);
      appendGoalMetadataLine(lines, "Evidence", item.evidence);
    }
  }

  lines.push("", "## Verifier", "");
  if (!run.verifier) {
    lines.push("- none recorded");
  } else {
    lines.push(markdownListItem(run.verifier.description));
    appendGoalMetadataLine(
      lines,
      "Command",
      run.verifier.command ? markdownCode(run.verifier.command) : undefined,
    );
    if (run.verifier.lastResult) {
      appendGoalMetadataLine(lines, "Last result", run.verifier.lastResult.status);
      appendGoalMetadataLine(lines, "Summary", run.verifier.lastResult.summary);
      appendGoalMetadataLine(lines, "Exit code", run.verifier.lastResult.exitCode?.toString());
      appendGoalMetadataLine(lines, "Output", run.verifier.lastResult.outputPath);
      appendGoalMetadataLine(lines, "Checked at", run.verifier.lastResult.checkedAt);
    }
  }

  lines.push("", "## Final audit", "");
  if (!run.completionAudit) {
    lines.push("- none recorded");
  } else {
    lines.push(`- **${run.completionAudit.status}** ${run.completionAudit.summary}`);
    appendGoalMetadataLine(lines, "Checked at", run.completionAudit.checkedAt);
    appendGoalMetadataLine(lines, "Verifier checked at", run.completionAudit.verifierCheckedAt);
    appendGoalMetadataLine(lines, "Output", run.completionAudit.outputPath);
  }

  lines.push("", "## Evidence", "");
  if (run.evidence.length === 0) {
    lines.push("- none recorded");
  } else {
    for (const item of run.evidence) {
      lines.push(`- **${item.kind}** ${item.label}`);
      appendGoalMetadataLine(lines, "ID", markdownCode(item.id));
      appendGoalMetadataLine(lines, "Path", item.path ? markdownCode(item.path) : undefined);
      appendGoalMetadataLine(lines, "Content", item.content);
      appendGoalMetadataLine(lines, "Created", item.createdAt);
    }
  }

  lines.push("", "## Blockers", "");
  if (run.blockers.length === 0) {
    lines.push("- none recorded");
  } else {
    lines.push(...run.blockers.map(markdownListItem));
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function GoalHeader({
  cwd,
  runs,
  agentRunning,
}: {
  cwd: string;
  runs: readonly GoalRun[];
  agentRunning?: boolean;
}) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const displayPath = formatDisplayPath(cwd);
  const counts = summarizeGoalCountsFromRuns(runs);

  if (columns < SIDE_BY_SIDE_MIN) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
        <GoalGradientText text={GOAL_LOGO[0]} />
        <GoalGradientText text={GOAL_LOGO[1]} />
        <GoalGradientText text={GOAL_LOGO[2]} />
        <Box marginTop={1}>
          <Text color={GOAL_SUCCESS} bold>
            Goal Pane
          </Text>
          {agentRunning && <Text color={GOAL_ACTIVE}> (agent running)</Text>}
          <Text color={theme.textDim}> · {basename(cwd)}</Text>
        </Box>
        <Text color={theme.textDim} wrap="truncate">
          {displayPath}
        </Text>
        <Text>
          <Text color={GOAL_SUCCESS}>{counts.passed} passed</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.running} active</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={theme.text}>{counts.pending} pending</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.blocked} blocked</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
      <Box>
        <GoalGradientText text={GOAL_LOGO[0]} />
        <Text>{GAP}</Text>
        <Text color={GOAL_SUCCESS} bold>
          Goal Pane
        </Text>
        {agentRunning && <Text color={GOAL_ACTIVE}> (agent running)</Text>}
      </Box>
      <Box>
        <GoalGradientText text={GOAL_LOGO[1]} />
        <Text>{GAP}</Text>
        <Text color={theme.textDim} wrap="truncate">
          {displayPath}
        </Text>
      </Box>
      <Box>
        <GoalGradientText text={GOAL_LOGO[2]} />
        <Text>{GAP}</Text>
        <Text>
          <Text color={GOAL_SUCCESS}>{counts.passed} passed</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.running} active</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={theme.text}>{counts.pending} pending</Text>
          <Text color={theme.textDim}> · </Text>
          <Text color={GOAL_ACTIVE}>{counts.blocked} blocked</Text>
        </Text>
      </Box>
    </Box>
  );
}

function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <Text color={color} bold>
      ◖ {label} ◗
    </Text>
  );
}

export interface GoalReviewSnapshot {
  id: string;
  run: GoalRun;
  content: string;
  markdownWidth: number;
}

export function createGoalReviewSnapshot({
  run,
  markdownWidth,
}: {
  run: GoalRun;
  markdownWidth: number;
}): GoalReviewSnapshot {
  const safeMarkdownWidth = Number.isFinite(markdownWidth)
    ? Math.max(40, Math.floor(markdownWidth))
    : 80;
  return {
    id: `${run.id}:${run.updatedAt}:${safeMarkdownWidth}`,
    run,
    content: formatGoalPlanMarkdown(run),
    markdownWidth: safeMarkdownWidth,
  };
}

export type GoalExpandedDetailViewModel = GoalReviewSnapshot;

export function getGoalExpandedDetailViewModel({
  run,
  markdownWidth,
}: {
  run: GoalRun;
  markdownWidth: number;
}): GoalExpandedDetailViewModel {
  return createGoalReviewSnapshot({ run, markdownWidth });
}

function GoalReviewDocument({ snapshot }: { snapshot: GoalReviewSnapshot }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" paddingRight={1}>
      <GoalHeader cwd={snapshot.run.projectPath} runs={[snapshot.run]} agentRunning={false} />
      <Box marginBottom={1}>
        <Text color={GOAL_SUCCESS} bold>
          {"◆ "}
          {snapshot.run.title}
        </Text>
        <Text color={theme.textDim}> · {snapshot.run.status}</Text>
      </Box>
      <Box flexDirection="row" marginTop={1} paddingRight={1}>
        <Box width={PREFIX_WIDTH} flexShrink={0}>
          <Text color={GOAL_SUCCESS}>{"◇ "}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} width={snapshot.markdownWidth}>
          <Markdown width={snapshot.markdownWidth}>{snapshot.content}</Markdown>
        </Box>
      </Box>
      <Box marginTop={1} marginBottom={1}>
        <Text color={theme.textDim}>
          Mouse-wheel scroll this terminal output to review the full Goal plan.
        </Text>
      </Box>
    </Box>
  );
}

export function GoalOverlay({
  cwd,
  onClose,
  onRunGoal,
  onVerifyGoal,
  onPauseGoal,
  onRefineGoal,
  agentRunning,
  autoExpandNewest,
}: GoalOverlayProps) {
  const theme = useTheme();
  const [runs, setRuns] = useState<GoalRun[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<GoalReviewSnapshot | null>(null);
  const [mode, setMode] = useState<"normal" | "confirmDelete" | "refine">("normal");
  const [refineFeedback, setRefineFeedback] = useState("");
  const [status, setStatus] = useState("");
  const autoExpandedRef = useRef(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedRunsRef = useRef<GoalRun[]>([]);
  const { stdout } = useStdout();
  const { rows, columns } = useTerminalSize();
  const markdownWidth = Math.max(40, columns - PREFIX_WIDTH);

  function expandGoal(run: GoalRun) {
    setExpandedRunId(run.id);
    setReviewSnapshot(createGoalReviewSnapshot({ run, markdownWidth }));
  }

  function collapseGoal() {
    stdout?.write("\x1b[2J\x1b[3J\x1b[H");
    setExpandedRunId(null);
    setReviewSnapshot(null);
    setMode("normal");
    setRefineFeedback("");
    autoExpandedRef.current = true;
  }

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(""), 2500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadGoalRuns(cwd).then((nextRuns) => {
        if (cancelled) return;
        setRuns((previousRuns) => {
          const sorted = sortGoalRunsForOverlay(nextRuns);
          if (!shouldPersistGoalOverlayRuns(previousRuns, sorted)) {
            showStatus(
              "Goal store reload looked empty while work is active; preserving local state.",
            );
            return previousRuns;
          }
          return JSON.stringify(previousRuns) === JSON.stringify(sorted) ? previousRuns : sorted;
        });
        setLoaded(true);
      });
    };
    load();
    const interval = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [cwd]);

  useEffect(() => {
    setSelectedIndex((index) => clampGoalSelectedIndex(index, runs.length));
    if (expandedRunId && !runs.some((run) => run.id === expandedRunId)) {
      setExpandedRunId(null);
      setReviewSnapshot(null);
    }
  }, [expandedRunId, runs]);

  useEffect(() => {
    const nextState = getGoalAutoExpandedState({
      autoExpandNewest,
      loaded,
      runs,
      alreadyExpanded: autoExpandedRef.current,
    });
    if (!nextState) return;
    const run = runs[nextState.selectedIndex];
    if (!run) return;
    autoExpandedRef.current = true;
    setSelectedIndex(nextState.selectedIndex);
    expandGoal(run);
  }, [autoExpandNewest, loaded, runs, markdownWidth]);

  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!shouldPersistGoalOverlayRuns(lastPersistedRunsRef.current, runs)) {
        showStatus("Refusing to save an empty Goal list while work is active.");
        return;
      }
      lastPersistedRunsRef.current = runs;
      void saveGoalRuns(cwd, runs);
    }, 100);
  }, [cwd, loaded, runs]);

  const viewportRows = getGoalOverlayViewportRows(rows);
  const selectedRun = runs[selectedIndex];
  const expandedRun = runs.find((run) => run.id === expandedRunId) ?? reviewSnapshot?.run ?? null;
  const listWindow = getGoalListWindow({
    runs,
    selectedIndex,
    viewportRows,
  });
  const scrollOffset = listWindow.start;
  const visibleRuns = runs.slice(listWindow.start, listWindow.end);
  const hiddenBefore = listWindow.hiddenBefore;
  const hiddenAfter = listWindow.hiddenAfter;

  useInput((input, key) => {
    if (mode === "refine") {
      if (key.return) {
        if (expandedRun) {
          onRefineGoal?.(expandedRun, refineFeedback || "Please refine this Goal setup.");
        }
        setMode("normal");
        setRefineFeedback("");
        return;
      }
      if (key.escape) {
        setMode("normal");
        setRefineFeedback("");
        return;
      }
      if (key.backspace || key.delete) {
        setRefineFeedback((previous) => previous.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setRefineFeedback((previous) => previous + input);
      }
      return;
    }

    if (mode === "confirmDelete") {
      if (key.escape || input === "n") {
        setMode("normal");
        showStatus("Archive cancelled");
        return;
      }
      if (input === "y" && selectedRun) {
        setRuns((previousRuns) => previousRuns.filter((run) => run.id !== selectedRun.id));
        setExpandedRunId(null);
        setReviewSnapshot(null);
        setMode("normal");
        showStatus("Goal archived");
      }
      return;
    }

    if (key.escape) {
      if (expandedRun) {
        collapseGoal();
      } else {
        onClose();
      }
      return;
    }
    if (expandedRun && (key.return || input === "a")) {
      onRunGoal(expandedRun);
      return;
    }
    if (expandedRun && input === "r") {
      setMode("refine");
      setRefineFeedback("");
      return;
    }
    if (expandedRun && input === "q") {
      collapseGoal();
      return;
    }
    if (expandedRun) return;
    if (key.upArrow || input === "k") {
      setSelectedIndex((index) => clampGoalSelectedIndex(index - 1, runs.length));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((index) => clampGoalSelectedIndex(index + 1, runs.length));
      return;
    }
    if (key.return && selectedRun) {
      onRunGoal(selectedRun);
      return;
    }
    if (input === "d" && selectedRun) {
      expandGoal(selectedRun);
      return;
    }
    if (input === "a" && selectedRun) {
      onRunGoal(selectedRun);
      return;
    }
    if (input === "r" && selectedRun) {
      if (expandedRun) {
        setMode("refine");
        setRefineFeedback("");
      } else {
        expandGoal(selectedRun);
      }
      return;
    }
    if (input === "v" && selectedRun) {
      onVerifyGoal(selectedRun);
      return;
    }
    if (input === "p" && selectedRun) {
      onPauseGoal(selectedRun);
      return;
    }
    if (input === "x" && selectedRun) {
      setMode("confirmDelete");
      showStatus("Archive goal? y/n");
    }
  });

  if (expandedRun && reviewSnapshot) {
    return (
      <Box flexDirection="column">
        <Static key={reviewSnapshot.id} items={[reviewSnapshot]} style={{ width: "100%" }}>
          {(snapshot) => <GoalReviewDocument key={snapshot.id} snapshot={snapshot} />}
        </Static>

        <Box marginTop={1}>
          {mode === "confirmDelete" ? (
            <Text color={theme.warning}>Confirm archive selected goal: y/n</Text>
          ) : mode === "refine" ? (
            <Box flexDirection="column">
              <Text color={theme.primary}>Feedback (Enter to submit, Esc to cancel):</Text>
              <Text color={theme.text}>
                {"> "}
                {refineFeedback}
                {"▍"}
              </Text>
            </Box>
          ) : (
            <Text color={theme.textDim}>
              <Text color={theme.success}>Enter/a</Text>
              {" approve/run · "}
              <Text color={theme.error}>r</Text>
              {" refine · "}
              <Text color={theme.primary}>q</Text>
              {" back · "}
              <Text color={theme.primary}>ESC</Text>
              {" close"}
            </Text>
          )}
        </Box>
        {status ? (
          <Box>
            <Text color={theme.secondary}>{status}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows} overflow="hidden">
      <GoalHeader cwd={cwd} runs={runs} agentRunning={agentRunning} />

      {agentRunning ? (
        <Box marginBottom={1}>
          <Text color={theme.textDim}>
            Agent is running; Goal pane stays available without resetting chat.
          </Text>
        </Box>
      ) : null}

      {!loaded ? (
        <Box borderStyle="round" borderColor={theme.textDim} paddingX={1}>
          <Text color={theme.textDim}>Loading goals…</Text>
        </Box>
      ) : runs.length === 0 ? (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor={theme.primary}
          paddingX={1}
          paddingY={1}
        >
          <Text color={theme.primary} bold>
            Start a durable Goal run
          </Text>
          <Text color={theme.textDim}>No goals yet. Ask the agent to start a durable Goal.</Text>
          <Text color={theme.textDim}>
            Prerequisites, worker tasks, evidence, and verifier results will appear in this pane.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" height={viewportRows} overflowY="hidden">
          <Text color={theme.textDim} bold>
            Goals
          </Text>
          {hiddenBefore > 0 ? (
            <Text color={theme.textDim}>
              ↑ {hiddenBefore} earlier goal{hiddenBefore === 1 ? "" : "s"}
            </Text>
          ) : null}
          {visibleRuns.map((run, visibleIndex) => {
            const index = scrollOffset + visibleIndex;
            const selected = index === selectedIndex;
            const blocked = goalHasBlockingPrerequisites(run);
            return (
              <Box key={run.id} flexDirection="column" marginBottom={1}>
                <Text wrap="truncate">
                  <Text color={selected ? theme.primary : theme.textDim}>
                    {selected ? "❯ " : "  "}
                  </Text>
                  <StatusChip
                    label={run.status}
                    color={getGoalCardStatusColor({
                      status: run.status,
                      selected,
                      primaryColor: theme.primary,
                      textColor: theme.text,
                    })}
                  />
                  <Text
                    color={getGoalCardTitleColor({
                      selected,
                      primaryColor: theme.primary,
                      textColor: theme.text,
                    })}
                    bold={selected}
                  >
                    {" "}
                    {run.title}
                  </Text>
                  <Text color={theme.textDim}> · {run.id.slice(0, 8)}</Text>
                </Text>
                <Text wrap="truncate">
                  <Text color={theme.textDim}>{selected ? "  " : "    "}</Text>
                  <Text color={statusColor(run.status) || theme.secondary}>
                    {getGoalReadinessText(run)}
                  </Text>
                  <Text color={theme.textDim}> · </Text>
                  <Text color={theme.text}>{formatGoalProgressText(run)}</Text>
                  <Text color={theme.textDim}> · </Text>
                  <Text color={verifierSummaryColor(run, theme.textDim)}>
                    {formatGoalVerifierSummary(run)}
                  </Text>
                </Text>
                <Text wrap="truncate">
                  <Text color={theme.textDim}>{selected ? "  " : "    "}</Text>
                  <Text color={goalHasBlockingPrerequisites(run) ? theme.warning : GOAL_SUCCESS}>
                    {formatGoalPrerequisiteSummary(run)}
                  </Text>
                  <Text color={theme.textDim}> · </Text>
                  <Text color={run.tasks.length > 0 ? GOAL_SUCCESS : theme.text}>
                    {formatGoalTaskSummary(run)}
                  </Text>
                </Text>
                {blocked ? (
                  <Text color={theme.warning} wrap="truncate">
                    {selected ? "  " : "    "}⚠ prerequisite needed before workers continue
                  </Text>
                ) : run.status === "running" || run.status === "verifying" ? (
                  <Text color={GOAL_ACTIVE} wrap="truncate">
                    {selected ? "  " : "    "}● active — watching worker/verifier progress
                  </Text>
                ) : null}
                {run.blockers.length > 0 ? (
                  <Text color={theme.warning} wrap="truncate">
                    {selected ? "  " : "    "}blocker: {run.blockers[0]}
                  </Text>
                ) : null}
              </Box>
            );
          })}
          {hiddenAfter > 0 ? (
            <Text color={theme.textDim}>
              ↓ {hiddenAfter} later goal{hiddenAfter === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Box>
      )}

      <Box marginTop={1}>
        {mode === "confirmDelete" ? (
          <Text color={theme.warning}>Confirm archive selected goal: y/n</Text>
        ) : mode === "refine" ? (
          <Box flexDirection="column">
            <Text color={theme.primary}>Feedback (Enter to submit, Esc to cancel):</Text>
            <Text color={theme.text}>
              {"> "}
              {refineFeedback}
              {"▍"}
            </Text>
          </Box>
        ) : (
          <Text color={theme.textDim}>
            <Text color={theme.primary}>↑↓/jk</Text>
            {" select · "}
            <Text color={theme.primary}>Enter/a</Text>
            {" run · "}
            <Text color={theme.primary}>d</Text>
            {" detail · "}
            <Text color={theme.primary}>v</Text>
            {" verify · "}
            <Text color={theme.primary}>p</Text>
            {" pause · "}
            <Text color={theme.primary}>x</Text>
            {" archive · "}
            <Text color={theme.primary}>Esc</Text>
            {" close"}
          </Text>
        )}
      </Box>
      {status ? (
        <Box>
          <Text color={theme.secondary}>{status}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
