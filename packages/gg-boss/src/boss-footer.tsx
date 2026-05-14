import React from "react";
import { Text, Box } from "ink";
import { useTheme } from "@kenkaiiii/ggcoder/ui/theme";
import { useTerminalSize } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { getContextWindow } from "@kenkaiiii/ggcoder";
import { COLORS } from "./branding.js";

const PARTIAL_BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const LIGHT_SHADE = "░";

const SHORT_MODELS: Record<string, string> = {
  "claude-opus-4-7": "Opus",
  "claude-sonnet-4-6": "Sonnet",
  "claude-haiku-4-5": "Haiku",
  "claude-haiku-4-5-20251001": "Haiku",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
};

function shortModel(model: string): string {
  return SHORT_MODELS[model] ?? model;
}

function getContextPercent(model: string, tokensIn: number): number {
  const limit = getContextWindow(model);
  if (!limit || tokensIn === 0) return 0;
  return Math.round((tokensIn / limit) * 100);
}

interface BossFooterProps {
  bossModel: string;
  workerModel: string;
  /** Total input tokens of the boss's last turn — drives the context bar. */
  tokensIn: number;
  exitPending: boolean;
  /** Boss extended-thinking level. Falsy when thinking is off. */
  bossThinkingLevel?: string;
  /** Auto-updater has installed a newer @kenkaiiii/gg-boss in the background.
   *  Show a "restart to apply" hint at the end of the footer row. */
  updatePending?: boolean;
  /** id of the currently-playing radio station (from RADIO_STATIONS), or null
   *  when the radio is off. Renders as `♪ <short name>` between thinking and
   *  the update notice. */
  currentRadioStationId?: string | null;
}

// Short, recognisable station names for the footer slot. The picker shows the
// full name; here we just want enough to tell stations apart without eating
// column budget. Order matters: more-frequent first because pattern matching
// in the renderer is cheap-but-still-O(n).
const SHORT_RADIO: Record<string, string> = {
  "somafm-groove-salad": "Groove Salad",
  "somafm-drone-zone": "Drone Zone",
  "radio-paradise": "Radio Paradise",
  "george-fm": "George FM",
};

/**
 * Footer for gg-boss that mirrors ggcoder's Footer visual style — context bar
 * with partial-block precision, percent, then BOTH models displayed in the
 * same bold/coloured treatment so neither feels secondary.
 */
export function BossFooter({
  bossModel,
  workerModel,
  tokensIn,
  exitPending,
  bossThinkingLevel,
  updatePending,
  currentRadioStationId,
}: BossFooterProps): React.ReactElement {
  const theme = useTheme();
  const { columns } = useTerminalSize();

  if (exitPending) {
    return (
      <Box paddingX={1}>
        <Text color={theme.warning}>Press Ctrl+C again to exit</Text>
      </Box>
    );
  }

  const contextPct = getContextPercent(bossModel, tokensIn);
  const contextColor =
    contextPct >= 80 ? theme.error : contextPct >= 50 ? theme.warning : theme.success;

  const sep = <Text color={theme.border}>{" │ "}</Text>;

  // Context bar — same partial-block precision as ggcoder's Footer.
  const barWidth = 8;
  const fillFloat = Math.min((contextPct / 100) * barWidth, barWidth);
  const barChars: React.ReactElement[] = [];
  for (let i = 0; i < barWidth; i++) {
    const cellFill = Math.max(0, Math.min(1, fillFloat - i));
    const eighths = Math.round(cellFill * 8);
    if (eighths === 8) {
      barChars.push(
        <Text key={i} color={contextColor}>
          {PARTIAL_BLOCKS[8]}
        </Text>,
      );
    } else if (eighths > 0) {
      barChars.push(
        <Text key={i} color={contextColor}>
          {PARTIAL_BLOCKS[eighths]}
        </Text>,
      );
    } else {
      barChars.push(
        <Text key={i} color={theme.textDim}>
          {LIGHT_SHADE}
        </Text>,
      );
    }
  }

  // Priority-drop layout: when terminal is narrower than the full footer
  // would need, we shed lower-priority chrome to keep the row from wrapping.
  // Ranked highest-to-lowest priority:
  //   1. context bar + %         — always visible (essential)
  //   2. update notice           — actionable; user needs to know
  //   3. radio                   — visible state of an audio process they started
  //   4. boss/worker model names — frequent reference, but stable
  //   5. thinking indicator      — least chatty, easiest to hide first
  //   6. "boss "/"workers " text labels — pure decoration
  //
  // Approximate per-section widths (with separator " │ "):
  //   bar+% = ~12, model = ~5+name+3 sep, thinking = ~14, radio ≈ ♪+name+3,
  //   update = ~30. We compute and degrade in stages.
  const radioName = currentRadioStationId
    ? (SHORT_RADIO[currentRadioStationId] ?? currentRadioStationId)
    : null;
  const bossM = shortModel(bossModel);
  const wkrM = shortModel(workerModel);

  // Rough char estimate; padding=2, separators are " │ " (3 each).
  const estFull =
    2 +
    12 + // bar + " 99%"
    3 +
    5 +
    bossM.length + // " │ boss <model>"
    3 +
    8 +
    wkrM.length + // " │ workers <model>"
    3 +
    12 + // " │ Thinking off"
    (radioName ? 3 + 2 + radioName.length : 0) + // " │ ♪ Name"
    (updatePending ? 3 + 28 : 0); // " │ Update ready. Restart GG Boss."

  const dropLabels = estFull > columns; // stage 1: kill "boss "/"workers " words
  const dropThinking = estFull > columns + 14; // stage 2: kill thinking indicator
  const useShortUpdate = updatePending && estFull > columns + 6; // stage 3: shrink the update notice

  return (
    <Box paddingX={1} width={columns}>
      <Box flexGrow={1} />
      <Box flexShrink={0}>
        <Text>{barChars}</Text>
        <Text color={contextColor}> {contextPct}%</Text>
        {sep}
        {!dropLabels && <Text color={theme.textDim}>boss </Text>}
        <Text color={COLORS.primary} bold>
          {bossM}
        </Text>
        {sep}
        {!dropLabels && <Text color={theme.textDim}>workers </Text>}
        <Text color={COLORS.accent} bold>
          {wkrM}
        </Text>
        {!dropThinking && (
          <>
            {sep}
            <Text color={bossThinkingLevel ? theme.accent : theme.textDim}>
              {bossThinkingLevel ? "Thinking on" : "Thinking off"}
            </Text>
          </>
        )}
        {radioName && (
          <>
            {sep}
            <Text color={theme.secondary ?? theme.accent}>♪ {radioName}</Text>
          </>
        )}
        {updatePending && (
          <>
            {sep}
            <Text color={theme.success} bold wrap="truncate">
              {useShortUpdate ? "Update ready" : "Update ready. Restart GG Boss."}
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}
