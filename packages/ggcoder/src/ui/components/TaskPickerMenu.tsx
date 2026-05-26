import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";
import type { TaskRecord } from "../../core/tasks-store.js";

interface TaskPickerMenuProps {
  tasks: readonly TaskRecord[];
  selectedIndex: number;
  width: number;
}

const MAX_TASKS_TO_SHOW = 8;

function statusGlyph(status: TaskRecord["status"]): string {
  if (status === "done") return "✓";
  if (status === "in-progress") return "~";
  return " ";
}

export function TaskPickerMenu({ tasks, selectedIndex, width }: TaskPickerMenuProps) {
  const theme = useTheme();

  const runnableTasks = tasks.filter((task) => task.status !== "done");
  if (runnableTasks.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} width={width}>
        <Text color={theme.textDim}>-- tasks --</Text>
        <Text color={theme.textDim}>No pending tasks.</Text>
      </Box>
    );
  }

  const total = runnableTasks.length;
  const idx = Math.min(Math.max(selectedIndex, 0), total - 1);
  const start =
    total <= MAX_TASKS_TO_SHOW
      ? 0
      : Math.max(0, Math.min(idx - Math.floor(MAX_TASKS_TO_SHOW / 2), total - MAX_TASKS_TO_SHOW));
  const end = Math.min(start + MAX_TASKS_TO_SHOW, total);
  const visible = runnableTasks.slice(start, end);

  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      {start > 0 && <Text color={theme.text}>▲</Text>}
      <Text color={theme.textDim}>-- tasks --</Text>
      {visible.map((task, i) => {
        const actualIndex = start + i;
        const isSelected = actualIndex === idx;
        const textColor = isSelected ? theme.commandColor : theme.textDim;
        return (
          <Box
            key={task.id}
            flexDirection="row"
            backgroundColor={isSelected ? theme.border : undefined}
          >
            <Box width={4} flexShrink={0}>
              <Text color={textColor}>[{statusGlyph(task.status)}]</Text>
            </Box>
            <Box flexGrow={1} paddingLeft={1}>
              <Text color={textColor} wrap="truncate">
                {task.title}
              </Text>
            </Box>
          </Box>
        );
      })}
      {end < total && <Text color={theme.textDim}>▼</Text>}
      <Text color={theme.textDim}>
        <Text color={theme.primary}>↑↓</Text>
        {" select · "}
        <Text color={theme.primary}>Enter</Text>
        {" start · "}
        <Text color={theme.primary}>d</Text>
        {" delete · "}
        <Text color={theme.primary}>r</Text>
        {" run all · "}
        <Text color={theme.primary}>Esc</Text>
        {" close"}
      </Text>
    </Box>
  );
}
