import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";
import type { GoalRun } from "../../core/goal-store.js";
import { formatGoalProgressText, getGoalReadinessText } from "./GoalOverlay.js";

interface GoalPickerMenuProps {
  goals: readonly GoalRun[];
  selectedIndex: number;
  width: number;
}

const MAX_GOALS_TO_SHOW = 8;

function statusGlyph(status: GoalRun["status"]): string {
  if (status === "passed") return "✓";
  if (status === "running" || status === "verifying") return "~";
  if (status === "failed" || status === "blocked") return "!";
  if (status === "paused") return "Ⅱ";
  return " ";
}

export function GoalPickerMenu({ goals, selectedIndex, width }: GoalPickerMenuProps) {
  const theme = useTheme();

  if (goals.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} width={width}>
        <Text color={theme.textDim}>-- goals --</Text>
        <Text color={theme.textDim}>No goals. Type /goal &lt;objective&gt; to create one.</Text>
      </Box>
    );
  }

  const total = goals.length;
  const idx = Math.min(Math.max(selectedIndex, 0), total - 1);
  const start =
    total <= MAX_GOALS_TO_SHOW
      ? 0
      : Math.max(0, Math.min(idx - Math.floor(MAX_GOALS_TO_SHOW / 2), total - MAX_GOALS_TO_SHOW));
  const end = Math.min(start + MAX_GOALS_TO_SHOW, total);
  const visible = goals.slice(start, end);

  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      {start > 0 && <Text color={theme.text}>▲</Text>}
      <Text color={theme.textDim}>-- goals --</Text>
      {visible.map((goal, i) => {
        const actualIndex = start + i;
        const isSelected = actualIndex === idx;
        const textColor = isSelected ? theme.commandColor : theme.textDim;
        return (
          <Box
            key={goal.id}
            flexDirection="row"
            backgroundColor={isSelected ? theme.border : undefined}
          >
            <Box width={4} flexShrink={0}>
              <Text color={textColor}>[{statusGlyph(goal.status)}]</Text>
            </Box>
            <Box flexGrow={1} paddingLeft={1}>
              <Text color={textColor} wrap="truncate">
                {goal.title} · {getGoalReadinessText(goal)} · {formatGoalProgressText(goal)}
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
        {" run/continue · "}
        <Text color={theme.primary}>d</Text>
        {" delete · "}
        <Text color={theme.primary}>p</Text>
        {" pause · "}
        <Text color={theme.primary}>Esc</Text>
        {" close"}
      </Text>
    </Box>
  );
}
