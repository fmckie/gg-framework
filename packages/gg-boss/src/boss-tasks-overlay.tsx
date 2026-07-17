import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "@kleio/coder/ui/theme";
import { useTasksState, tasksStore, type BossTask, type TaskStatus } from "./tasks-store.js";
import { bossStore } from "./boss-store.js";
import { projectColor } from "./colors.js";
import { COLORS } from "./branding.js";
import type { GGBoss } from "./orchestrator.js";
import type { WorkerView } from "./boss-store.js";

function statusGlyph(status: TaskStatus): string {
  switch (status) {
    case "done":
      return "✓";
    case "in_progress":
      return "~";
    case "blocked":
      return "✗";
    case "skipped":
      return "—";
    default:
      return " ";
  }
}

interface BossTasksOverlayProps {
  boss: GGBoss;
  workers: WorkerView[];
  onClose: () => void;
}

/**
 * Multi-project task overlay for gg-boss. Read-mostly: tasks are added by the
 * boss agent (via add_task tool), so the overlay is just a backlog viewer with
 * two actions — delete a stuck task, or run all pending across idle workers.
 *
 * Keybinds (all the user actually needs):
 *  ↑↓ / k j   navigate
 *  d          delete selected task
 *  r          dispatch_pending across all idle workers (parallel fan-out)
 *  Esc        close
 */
export function BossTasksOverlay({
  boss,
  workers,
  onClose,
}: BossTasksOverlayProps): React.ReactElement {
  const theme = useTheme();
  const tasksState = useTasksState();
  const tasks = tasksState.tasks;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatusMsg] = useState("");
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback((msg: string): void => {
    setStatusMsg(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatusMsg(""), 2500);
  }, []);

  // Group tasks by project (in worker order).
  const groupedTasks: { project: string; tasks: BossTask[] }[] = workers.map((w) => ({
    project: w.name,
    tasks: tasks
      .filter((t) => t.project === w.name)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  const flatTasks: BossTask[] = groupedTasks.flatMap((g) => g.tasks);

  // Clamp selection.
  useEffect(() => {
    if (flatTasks.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= flatTasks.length) {
      setSelectedIndex(flatTasks.length - 1);
    }
  }, [flatTasks.length, selectedIndex]);

  const selected = flatTasks[selectedIndex];

  // Cap how many tasks render at once so the live-area height stays bounded.
  // Ink's log-update mispositions the cursor when the live area is much
  // larger than the next frame — going from a 30-line tasks pane back to a
  // 5-line chat chrome was clipping the user's scrollback above on close.
  // Mirrors ggcoder's `maxVisible = 15` cap. Selection stays visible by
  // scrolling the window when the cursor reaches the bottom.
  const MAX_VISIBLE = 12;
  const startIdx = Math.max(
    0,
    Math.min(flatTasks.length - MAX_VISIBLE, selectedIndex - MAX_VISIBLE + 1, selectedIndex),
  );
  const endIdx = Math.min(flatTasks.length, startIdx + MAX_VISIBLE);
  const visibleIdSet = new Set(flatTasks.slice(startIdx, endIdx).map((t) => t.id));
  const showingTop = startIdx > 0;
  const showingBottom = endIdx < flatTasks.length;

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(flatTasks.length - 1, i + 1));
      return;
    }
    if (input === "d" && selected) {
      void tasksStore.remove(selected.id).then(() => showStatus("Deleted"));
      return;
    }
    if (input === "r") {
      // Close immediately so the user lands back in the chat view and can
      // watch worker activity stream in. Dispatch fires in the background;
      // worker_turn_complete events flow into history as normal.
      onClose();
      void (async (): Promise<void> => {
        const dispatched: { project: string; title: string }[] = [];
        for (const w of workers) {
          // nextDispatchable picks pending OR blocked — so blocked tasks get
          // retried alongside fresh pending ones. Pending is preferred.
          const next = tasksStore.nextDispatchable(w.name);
          if (!next) continue;
          // Reset blocked → pending so the dispatch path's in_progress flip
          // lands on a clean state and not "blocked → in_progress" (which
          // looks like a status going backwards in the overlay).
          if (next.status === "blocked") {
            await tasksStore.update(next.id, { status: "pending", notes: undefined });
          }
          const res = await boss.dispatchTaskById(next.id);
          if (res.ok) dispatched.push({ project: w.name, title: next.title });
        }
        if (dispatched.length === 0) {
          bossStore.appendInfo("No pending or blocked tasks to run.", "info");
        } else {
          bossStore.appendTaskDispatch(dispatched);
        }
      })();
      return;
    }
  });

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const pendingCount = tasks.filter((t) => t.status === "pending").length;
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {/* Single header line — the Kleio Manager banner already sits in scrollback.
          A second BossBanner here would duplicate it after overlay toggles. */}
      <Box>
        <Text color={COLORS.primary} bold>
          Tasks
        </Text>
        <Text color={theme.textDim}>{`  ·  ${tasks.length} total  ·  `}</Text>
        <CountsRow
          theme={theme}
          done={doneCount}
          active={inProgressCount}
          pending={pendingCount}
          blocked={blockedCount}
        />
      </Box>

      {flatTasks.length === 0 && (
        <Box marginTop={1}>
          <Text color={theme.textDim}>
            {"  No tasks yet. Ask Kleio Manager to plan some — e.g. "}
            <Text color={theme.text}>"plan some work"</Text>
            {"."}
          </Text>
        </Box>
      )}

      {showingTop && <Text color={theme.textDim}>{`  ↑ ${startIdx} more above`}</Text>}

      {/* Per-project sections — only tasks in the visible window are rendered.
          Sections with no visible tasks are hidden entirely so the layout
          stays compact across scroll. */}
      {groupedTasks.map((group, gIdx) => {
        const startInFlat = groupedTasks.slice(0, gIdx).reduce((acc, g) => acc + g.tasks.length, 0);
        const visibleInSection = group.tasks.filter((t) => visibleIdSet.has(t.id));
        if (visibleInSection.length === 0) return null;
        return (
          <Box key={group.project} flexDirection="column" marginTop={1}>
            <Text>
              <Text color={projectColor(group.project)} bold>
                {group.project}
              </Text>
              <Text color={theme.textDim}>{` · ${group.tasks.length}`}</Text>
            </Text>
            {visibleInSection.map((task) => {
              const realIdx = startInFlat + group.tasks.indexOf(task);
              const isSelected = realIdx === selectedIndex;
              const prefix = isSelected ? "❯ " : "  ";
              const glyph = statusGlyph(task.status);
              const color = isSelected
                ? theme.primary
                : task.status === "done"
                  ? theme.success
                  : task.status === "in_progress"
                    ? theme.warning
                    : task.status === "blocked"
                      ? theme.error
                      : theme.text;
              return (
                <Text key={task.id} color={color} bold={isSelected}>
                  {prefix}[{glyph}] {task.title}
                </Text>
              );
            })}
          </Box>
        );
      })}

      {showingBottom && (
        <Text color={theme.textDim}>{`  ↓ ${flatTasks.length - endIdx} more below`}</Text>
      )}

      {status && (
        <Box marginTop={1}>
          <Text color={theme.success}>{" " + status}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.textDim}>
          <Text color={theme.primary}>↑↓</Text>
          {" move · ("}
          <Text color={theme.primary}>d</Text>
          {")elete · ("}
          <Text color={theme.primary}>r</Text>
          {")un pending · "}
          <Text color={theme.primary}>ESC</Text>
          {" close"}
        </Text>
      </Box>
    </Box>
  );
}

function CountsRow({
  theme,
  done,
  active,
  pending,
  blocked,
}: {
  theme: ReturnType<typeof useTheme>;
  done: number;
  active: number;
  pending: number;
  blocked: number;
}): React.ReactElement {
  return (
    <Text>
      <Text color={theme.success}>{done} done</Text>
      <Text color={theme.textDim}> · </Text>
      <Text color={theme.warning}>{active} active</Text>
      <Text color={theme.textDim}> · </Text>
      <Text color={theme.text}>{pending} pending</Text>
      {blocked > 0 && (
        <>
          <Text color={theme.textDim}> · </Text>
          <Text color={theme.error}>{blocked} blocked</Text>
        </>
      )}
    </Text>
  );
}
