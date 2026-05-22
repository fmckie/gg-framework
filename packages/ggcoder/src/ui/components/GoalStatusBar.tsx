import React from "react";
import { Box, Text } from "ink";
import type { GoalRun } from "../../core/goal-store.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useTheme } from "../theme/theme.js";
import { useAnimationTick, useAnimationActive } from "./AnimationContext.js";

export type GoalStatusPhase = "worker" | "verifier" | "reviewing" | "orchestrating" | "failed";

export interface GoalStatusEntry {
  runId: string;
  label: string;
  phase: GoalStatusPhase;
  startedAt: number;
  detail?: string;
  workerId?: string;
  goalNumber?: number;
}

const SHIMMER_WIDTH = 3;
const PHASE_LABELS: Record<GoalStatusPhase, string> = {
  worker: "working",
  verifier: "verifying",
  reviewing: "reviewing",
  orchestrating: "orchestrating",
  failed: "failed",
};

export function formatGoalElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function truncateLabel(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  if (maxLength <= 1) return "…";
  return `${label.slice(0, maxLength - 1)}…`;
}

function GoalAnimationSentinel(): null {
  useAnimationActive();
  return null;
}

function ShimmerText({ text, color, tick }: { text: string; color: string; tick: number }) {
  const cycle = text.length + SHIMMER_WIDTH * 2;
  const shimmerPos = (tick % cycle) - SHIMMER_WIDTH;
  return (
    <Text>
      {text.split("").map((character, index) => {
        const isBright = Math.abs(index - shimmerPos) <= SHIMMER_WIDTH;
        return (
          <Text key={index} color={color} bold={isBright} dimColor={!isBright}>
            {character}
          </Text>
        );
      })}
    </Text>
  );
}

function getPhaseColor(phase: GoalStatusPhase, theme: ReturnType<typeof useTheme>): string {
  switch (phase) {
    case "worker":
      return theme.primary;
    case "verifier":
      return theme.accent;
    case "reviewing":
    case "orchestrating":
      return theme.secondary;
    case "failed":
      return theme.warning;
  }
}

export function formatGoalStatusActiveText(entry: GoalStatusEntry): string {
  return `Goal ${PHASE_LABELS[entry.phase]} · ${truncateLabel(entry.label, 42)}`;
}

export function syncGoalStatusEntries(
  previous: readonly GoalStatusEntry[],
  entry: GoalStatusEntry,
): GoalStatusEntry[] {
  const withoutRun = previous.filter((item) => item.runId !== entry.runId);
  const existingGoalNumber = previous.findIndex((item) => item.runId === entry.runId) + 1;
  const goalNumber = entry.goalNumber ?? (existingGoalNumber || withoutRun.length + 1);
  return [...withoutRun, { ...entry, goalNumber }];
}

export function removeGoalStatusEntry(
  previous: readonly GoalStatusEntry[],
  runId: string,
): GoalStatusEntry[] {
  return previous.filter((entry) => entry.runId !== runId);
}

export interface ReconcileGoalStatusEntriesOptions {
  isWorkerActive?: (workerId: string, run: GoalRun) => boolean;
  isVerifierActive?: (run: GoalRun) => boolean;
}

function hasActiveGoalProcess(
  entry: GoalStatusEntry,
  run: GoalRun,
  options: ReconcileGoalStatusEntriesOptions,
): boolean {
  if (entry.phase === "worker") {
    if (entry.workerId && options.isWorkerActive?.(entry.workerId, run)) return true;
    if (run.activeWorkerId && options.isWorkerActive?.(run.activeWorkerId, run)) return true;
    return run.tasks.some(
      (task) =>
        (task.status === "running" || task.status === "verifying") &&
        task.workerId !== undefined &&
        options.isWorkerActive?.(task.workerId, run) === true,
    );
  }
  if (entry.phase === "verifier") return options.isVerifierActive?.(run) === true;
  return false;
}

export function reconcileGoalStatusEntriesWithRuns(
  previous: readonly GoalStatusEntry[],
  runs: readonly GoalRun[],
  options: ReconcileGoalStatusEntriesOptions = {},
): GoalStatusEntry[] {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const next = previous.filter((entry) => {
    const run = runsById.get(entry.runId);
    if (!run) return false;
    if (hasActiveGoalProcess(entry, run, options)) return true;
    return run.status === "running" || run.status === "verifying";
  });
  return next.length === previous.length ? (previous as GoalStatusEntry[]) : next;
}

function GoalStatusSlot({ entry, tick }: { entry: GoalStatusEntry; tick: number }) {
  const theme = useTheme();
  const phaseColor = getPhaseColor(entry.phase, theme);
  const phaseLabel = PHASE_LABELS[entry.phase];
  const elapsed = formatGoalElapsed(Date.now() - entry.startedAt);
  const label = truncateLabel(entry.label, 42);

  if (entry.phase === "failed") {
    return (
      <Text>
        <Text color={phaseColor}>✗ Goal {phaseLabel}</Text>
        <Text color={theme.textDim}> · {label}</Text>
        <Text color={theme.textDim}> {elapsed}</Text>
      </Text>
    );
  }

  return (
    <Text>
      <ShimmerText text={`Goal ${phaseLabel}`} color={phaseColor} tick={tick} />
      <Text color={theme.textDim}> · </Text>
      <Text color={theme.text}>{label}</Text>
      <Text color={theme.textDim}> {elapsed}</Text>
    </Text>
  );
}

export function GoalStatusBar({ entries }: { entries: readonly GoalStatusEntry[] }) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const tick = useAnimationTick(entries.some((entry) => entry.phase !== "failed"));

  if (entries.length === 0) return null;

  const activeEntries = entries.filter((entry) => entry.phase !== "failed");
  const failedEntries = entries.filter((entry) => entry.phase === "failed");
  const visibleEntries = [...activeEntries, ...failedEntries].slice(0, 3);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <Box paddingX={1} width={columns} flexShrink={1}>
      {activeEntries.length > 0 && <GoalAnimationSentinel />}
      <Text wrap="truncate">
        {visibleEntries.map((entry, index) => (
          <React.Fragment key={entry.runId}>
            {index > 0 ? <Text color={theme.border}>{" │ "}</Text> : null}
            <GoalStatusSlot entry={entry} tick={tick} />
          </React.Fragment>
        ))}
        {hiddenCount > 0 ? <Text color={theme.textDim}> │ +{hiddenCount} more</Text> : null}
      </Text>
    </Box>
  );
}
