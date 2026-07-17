import React from "react";
import { Box, Text } from "ink";
import { BRAND, COLORS, GRADIENT, LOGO_GAP, LOGO_LINES, VERSION } from "./branding.js";

interface BossBannerProps {
  /** Second line text (e.g. "Link projects", "Orchestrator"). */
  subtitle: string;
  /** Third line text (e.g. "↑↓ navigate · enter save"). */
  hint?: string;
  /**
   * If true, show the standard chat-mode shortcut row (Ctrl+T tasks). Mirrors
   * Kleio Coder's banner where the third row advertises ^T / ^S / ^P. Override
   * with `hint` for non-chat banners (link picker, task overlay).
   */
  showShortcuts?: boolean;
}

/** Ink banner — for use inside Ink-rendered screens. */
export function BossBanner({ subtitle, hint, showShortcuts }: BossBannerProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <GradientText text={LOGO_LINES[0]!} />
        <Text>{LOGO_GAP}</Text>
        <Text color={COLORS.primary} bold>
          {BRAND}
        </Text>
        <Text color={COLORS.textDim}> v{VERSION}</Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[1]!} />
        <Text>{LOGO_GAP}</Text>
        <Text color={COLORS.accent}>{subtitle}</Text>
      </Box>
      <Box>
        <GradientText text={LOGO_LINES[2]!} />
        <Text>{LOGO_GAP}</Text>
        {showShortcuts ? (
          <Text>
            <Text color={COLORS.primary}>^T</Text>
            <Text color={COLORS.textDim}> tasks</Text>
            <Text color={COLORS.textDim}>{"  "}</Text>
            <Text color={COLORS.primary}>Tab</Text>
            <Text color={COLORS.textDim}> scope</Text>
            <Text color={COLORS.textDim}>{"  "}</Text>
            <Text color={COLORS.primary}>⇧Tab</Text>
            <Text color={COLORS.textDim}> thinking</Text>
            <Text color={COLORS.textDim}>{"  "}</Text>
            <Text color={COLORS.primary}>ESC</Text>
            <Text color={COLORS.textDim}> interrupt</Text>
          </Text>
        ) : (
          <Text color={COLORS.textDim}>{hint ?? ""}</Text>
        )}
      </Box>
    </Box>
  );
}

function GradientText({ text }: { text: string }): React.ReactElement {
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
