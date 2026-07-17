import React from "react";
import { render } from "ink";
import { AnimationProvider } from "@kleio/coder/ui";
import {
  ThemeContext,
  SetThemeContext,
  loadTheme,
  type ThemeName,
} from "@kleio/coder/ui/theme";
import { detectTheme } from "@kleio/coder/ui/theme/detect";
import { TerminalSizeProvider } from "@kleio/coder/ui/hooks/terminal-size";
import { App, type AppProps } from "./App.js";

/**
 * Editor brand palette. Warm orange/red so it's visually distinct from
 * ggcoder's blue/purple — same theme structure (so all shared components
 * still work), just different accent colors.
 */
const EDITOR_PALETTE = {
  primary: "#f97316", // orange-500 — used by spinner, input arrow, footer model name
  secondary: "#fb7185", // rose-400 — secondary text accents
  accent: "#ec4899", // pink-500 — secondary highlights
  spinnerColor: "#f97316",
  inputPrompt: "#f97316",
  toolName: "#f97316",
  command: "#ec4899",
  link: "#f97316",
  // Plan/thinking accents (we don't use plan, but keep coherent)
  planPrimary: "#fb923c",
  planBorder: "#9a3412",
} as const;

/**
 * Mount the editor TUI. Wraps with the same provider stack ggcoder uses so
 * shared components (Footer, ToolExecution, AssistantMessage, ActivityIndicator,
 * etc.) work with their context dependencies satisfied — but injects the
 * editor's warm palette over the loaded base theme.
 */
export async function renderEditorTui(props: AppProps): Promise<void> {
  const themeName = await detectTheme();

  // Clear screen so old terminal output doesn't appear above the TUI.
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");

  function ThemeProvider({ initial, children }: React.PropsWithChildren<{ initial: ThemeName }>) {
    const [name, setName] = React.useState(initial);
    const theme = React.useMemo(() => {
      const base = loadTheme(name);
      // Merge base theme with editor brand overrides — keeps success/warning/
      // error/text/border tokens from the base, swaps accent/primary tokens.
      return { ...base, ...EDITOR_PALETTE };
    }, [name]);
    const setTheme = React.useCallback((n: ThemeName) => setName(n), []);
    return React.createElement(
      SetThemeContext.Provider,
      { value: setTheme },
      React.createElement(ThemeContext.Provider, { value: theme }, children),
    );
  }

  const instance = render(
    React.createElement(
      ThemeProvider,
      { initial: themeName },
      React.createElement(
        TerminalSizeProvider,
        null,
        React.createElement(AnimationProvider, null, React.createElement(App, props)),
      ),
    ),
    {
      exitOnCtrlC: false,
      kittyKeyboard: {
        mode: "enabled",
        flags: ["disambiguateEscapeCodes"],
      },
    },
  );
  await instance.waitUntilExit();
}
