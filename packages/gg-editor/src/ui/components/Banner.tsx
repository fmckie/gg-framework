import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "@kleio/coder/ui/theme";
import { useTerminalSize } from "@kleio/coder/ui/hooks/terminal-size";
import { getModel } from "@kleio/coder/models";
import type { Provider } from "@kleio/ai";

/**
 * Welcome banner for ggeditor. Static — printed once into terminal scrollback.
 * Live host connection state lives in the Footer (which polls and updates).
 */

interface BannerProps {
  version: string;
  model: string;
  provider: Provider;
}

const LOGO_LINES = [
  " \u2584\u2580\u2580\u2580 \u2584\u2580\u2580\u2580",
  " \u2588 \u2580\u2588 \u2588 \u2580\u2588",
  " \u2580\u2584\u2584\u2580 \u2580\u2584\u2584\u2580",
];

// Warm sunset gradient — amber → orange → red → magenta. Visually distinct
// from ggcoder's cool blue/purple so users instantly know which tool they're in.
const GRADIENT = [
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

const GAP = "   ";
const LOGO_WIDTH = 9;
const SIDE_BY_SIDE_MIN = LOGO_WIDTH + GAP.length + 20;

export function Banner({ version, model }: BannerProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const modelInfo = getModel(model);
  const modelName = modelInfo?.name ?? model;

  // Narrow layout — stacked
  if (columns < SIDE_BY_SIDE_MIN) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
        <GradientText text={LOGO_LINES[0]} />
        <GradientText text={LOGO_LINES[1]} />
        <GradientText text={LOGO_LINES[2]} />
        <Box marginTop={1}>
          <Text color={theme.primary} bold>
            GG Editor
          </Text>
          <Text color={theme.textDim}> v{version}</Text>
        </Box>
        <Box>
          <Text color={theme.secondary}>{modelName}</Text>
        </Box>
        <Box>
          <Text color={theme.textDim}>AI agent for DaVinci Resolve and Premiere Pro</Text>
        </Box>
      </Box>
    );
  }

  // Side-by-side — logo left, three info lines right
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
      <Box>
        <GradientText text={LOGO_LINES[0]} />
        <Text>{GAP}</Text>
        <Text color={theme.primary} bold>
          GG Editor
        </Text>
        <Text color={theme.textDim}> v{version}</Text>
        <Text color={theme.textDim}> · By </Text>
        <Text color={theme.text} bold>
          Ken Kai
        </Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[1]} />
        <Text>{GAP}</Text>
        <Text color={theme.secondary}>{modelName}</Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[2]} />
        <Text>{GAP}</Text>
        <Text color={theme.textDim}>AI agent for DaVinci Resolve and Premiere Pro</Text>
      </Box>
    </Box>
  );
}

function GradientText({ text }: { text: string }) {
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
