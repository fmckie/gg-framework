import React, { useEffect, useState } from "react";
import { Box, Text, render } from "ink";
import { BRAND, COLORS, GRADIENT, VERSION } from "./branding.js";
import { getSplashAudioDurationMs, playSplashAudio } from "./audio.js";

/**
 * Big Kleio wordmark rendered for the Manager splash. Whitespace is
 * significant — every line is the same width so the gradient aligns.
 */
const SPLASH_LINES: readonly string[] = [
  "██╗  ██╗██╗     ███████╗██╗ ██████╗ ",
  "██║ ██╔╝██║     ██╔════╝██║██╔═══██╗",
  "█████╔╝ ██║     █████╗  ██║██║   ██║",
  "██╔═██╗ ██║     ██╔══╝  ██║██║   ██║",
  "██║  ██╗███████╗███████╗██║╚██████╔╝",
  "╚═╝  ╚═╝╚══════╝╚══════╝╚═╝ ╚═════╝ ",
];

const SPLASH_WIDTH = SPLASH_LINES[0]!.length;

/**
 * Vertical gradient stripe — assigns each line a colour from the brand
 * gradient so the logo gets a soft top→bottom hue transition. Filled glyphs
 * (`█`) take the line's hue at full brightness; shadow glyphs (`░`) inherit
 * the same hue but render at lower intensity (via `dimColor`) so they read
 * as a drop-shadow rather than fighting for visual weight with the fill.
 */
function colorForLine(lineIdx: number, totalLines: number, offset: number): string {
  const t = totalLines <= 1 ? 0 : (lineIdx + offset) % totalLines;
  const idx = Math.floor((t / totalLines) * GRADIENT.length) % GRADIENT.length;
  return GRADIENT[idx]!;
}

interface SplashProps {
  /** Pulse offset — bumping this on a timer rotates the gradient through the
   *  logo for a subtle "shimmer" while the splash is mounted. */
  offset: number;
}

function SplashLogo({ offset }: SplashProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {SPLASH_LINES.map((line, i) => {
        const hue = colorForLine(i, SPLASH_LINES.length, offset);
        // Split into runs so we can dim the shadow glyphs (░) without breaking
        // the line into one Text per char (which Ink would happily handle but
        // is wasteful at this scale).
        const segments: { text: string; dim: boolean }[] = [];
        let buf = "";
        let bufDim = false;
        for (const ch of line) {
          const dim = ch === "░";
          if (segments.length === 0 && buf.length === 0) {
            buf = ch;
            bufDim = dim;
            continue;
          }
          if (dim === bufDim) {
            buf += ch;
          } else {
            segments.push({ text: buf, dim: bufDim });
            buf = ch;
            bufDim = dim;
          }
        }
        if (buf) segments.push({ text: buf, dim: bufDim });

        return (
          <Text key={i}>
            {segments.map((seg, j) => (
              <Text key={j} color={hue} dimColor={seg.dim}>
                {seg.text}
              </Text>
            ))}
          </Text>
        );
      })}
    </Box>
  );
}

interface SplashScreenProps {
  /** Optional caption shown under the logo — defaults to a "Loading…" line. */
  caption?: string;
}

export function SplashScreen({ caption }: SplashScreenProps): React.ReactElement {
  const [offset, setOffset] = useState(0);
  // Soft shimmer — rotates the gradient through the logo every 120ms. Stops
  // when the component unmounts (the cli swaps the splash out as soon as the
  // Manager has finished initialising).
  useEffect(() => {
    const timer = setInterval(() => {
      setOffset((o) => o + 1);
    }, 120);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Re-center on terminal resize. process.stdout.columns/rows are read live
  // each render and a "resize" event re-renders us so the centring stays
  // accurate even if the user resizes their window mid-splash.
  const [size, setSize] = useState(() => ({
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  }));
  useEffect(() => {
    const handler = (): void =>
      setSize({
        columns: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
      });
    process.stdout.on("resize", handler);
    return () => {
      process.stdout.off("resize", handler);
    };
  }, []);

  // Splash height: 8 logo rows + 1 spacer + 1 brand line + 1 caption line ≈ 11.
  // We pad the top with empty rows to push the logo to the vertical centre,
  // and use Ink's flex `alignItems` for horizontal centring (works even when
  // the logo is wider than the terminal — flex just clips, no crash).
  const SPLASH_BLOCK_HEIGHT = SPLASH_LINES.length + 3;
  const verticalPad = Math.max(0, Math.floor((size.rows - SPLASH_BLOCK_HEIGHT) / 2));

  return (
    <Box flexDirection="column" width={size.columns} height={size.rows} alignItems="center">
      {/* Top spacer fills the available vertical space above the centred block. */}
      <Box height={verticalPad} flexShrink={0} />
      <Box flexDirection="column" alignItems="flex-start" flexShrink={0}>
        <SplashLogo offset={offset} />
        <Box width={SPLASH_WIDTH} marginTop={1} justifyContent="center">
          <Text>
            <Text color={COLORS.text} bold>
              {BRAND}
            </Text>
            <Text color={COLORS.textDim}> v{VERSION}</Text>
          </Text>
        </Box>
        <Box width={SPLASH_WIDTH} justifyContent="center">
          <Text color={COLORS.textDim}>{caption ?? "Starting Kleio Manager…"}</Text>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Render the splash to stdout. Returns a `dismiss()` that holds the splash
 * for at least `minMs` total visible time (so even fast inits get a real
 * flash of branding) before unmounting, and resolves only after the unmount
 * has actually completed — so the caller can safely render the main app
 * next without two Ink trees coexisting on screen.
 */
export function showSplash(opts: { minMs?: number; caption?: string }): {
  dismiss: () => Promise<void>;
} {
  const start = Date.now();
  // Fire-and-forget — never await. If the platform has no working player or
  // the bundled mp3 is missing, this resolves to nothing and the splash just
  // plays silently. Errors are swallowed inside playSplashAudio so the user
  // never sees an audio-related crash on launch.
  void playSplashAudio();
  const instance = render(<SplashScreen caption={opts.caption} />);
  // Default the minimum visible time to the audio duration so the user
  // doesn't get dumped into the chat mid-jingle. A small +200ms tail keeps
  // the last beat from being clipped by terminal-app sound shutdown.
  const audioDurationMs = getSplashAudioDurationMs();
  const defaultMinMs = audioDurationMs + 200;
  return {
    dismiss: async () => {
      const minMs = opts.minMs ?? defaultMinMs;
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, minMs - elapsed);
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      instance.unmount();
      // Give Ink one tick to flush the unmount writes before the caller
      // starts mounting the next tree.
      await new Promise((r) => setImmediate(r));
    },
  };
}
