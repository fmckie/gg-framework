import React, { useState } from "react";
import { Box, Text, useApp, useInput, render } from "ink";
import chalk from "chalk";
import { KLEIO_PRODUCT_PROFILE } from "@kleio/core";
import { discoverProjects, type DiscoveredProject, type ProjectSource } from "./discover.js";
import { loadLinks, saveLinks, type LinkedProject } from "./links.js";
import { BossBanner } from "./banner.js";
import { COLORS, clearScreen } from "./branding.js";

interface LinkScreenProps {
  projects: DiscoveredProject[];
  initialSelected: Set<string>;
  onDone: (selectedPaths: string[], cancelled: boolean) => void;
}

const VISIBLE_ROWS = 12;
const CODER_COMMAND = KLEIO_PRODUCT_PROFILE.coder.preferredCommand;
const MANAGER_COMMAND = KLEIO_PRODUCT_PROFILE.manager.preferredCommand;

function sourceBadge(sources: ProjectSource[]): { label: string; color: string } {
  // Fixed-width 5-char badges so names stay aligned across rows.
  if (sources.length > 1) return { label: "[mix]", color: COLORS.success };
  const only = sources[0];
  if (only === "ggcoder") return { label: "[kl ]", color: COLORS.accent };
  if (only === "claude-code") return { label: "[cc ]", color: COLORS.warning };
  if (only === "codex") return { label: "[cx ]", color: COLORS.primary };
  return { label: "[?? ]", color: COLORS.textDim };
}

function LinkScreen({ projects, initialSelected, onDone }: LinkScreenProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [scrollOffset, setScrollOffset] = useState(0);

  const visible = projects.slice(scrollOffset, scrollOffset + VISIBLE_ROWS);

  useInput((input, key) => {
    // Ctrl+C — cancel cleanly.
    if (key.ctrl && input === "c") {
      onDone([], true);
      return;
    }

    if (projects.length === 0) {
      if (key.return || key.escape || input === "q") onDone([], true);
      return;
    }

    if (key.upArrow) {
      const next = Math.max(0, cursor - 1);
      setCursor(next);
      if (next < scrollOffset) setScrollOffset(next);
    } else if (key.downArrow) {
      const next = Math.min(projects.length - 1, cursor + 1);
      setCursor(next);
      if (next >= scrollOffset + VISIBLE_ROWS) setScrollOffset(next - VISIBLE_ROWS + 1);
    } else if (input === " ") {
      const p = projects[cursor];
      if (!p) return;
      const nextSet = new Set(selected);
      if (nextSet.has(p.path)) nextSet.delete(p.path);
      else nextSet.add(p.path);
      setSelected(nextSet);
    } else if (input === "a") {
      const allSelected = projects.every((p) => selected.has(p.path));
      setSelected(allSelected ? new Set() : new Set(projects.map((p) => p.path)));
    } else if (key.return) {
      onDone(
        projects.filter((p) => selected.has(p.path)).map((p) => p.path),
        false,
      );
    } else if (key.escape || input === "q") {
      onDone([], true);
    }
  });

  const subtitle =
    projects.length === 0
      ? "Link projects"
      : `Link projects · ${projects.length} discovered · ${selected.size} selected`;
  const hint = "↑↓ navigate · space toggle · a all · enter save · esc cancel";

  if (projects.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <BossBanner subtitle="Link projects" hint="No projects yet" />
        <Box flexDirection="column" marginLeft={2}>
          <Text color={COLORS.textDim}>No Kleio Coder projects found in ~/.gg/sessions/.</Text>
          <Text color={COLORS.textDim}>
            Run {CODER_COMMAND} in a project at least once, then re-run{" "}
            <Text color={COLORS.accent}>{MANAGER_COMMAND} link</Text>.
          </Text>
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Press any key to exit.</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  const showingTop = scrollOffset > 0;
  const showingBottom = scrollOffset + VISIBLE_ROWS < projects.length;

  return (
    <Box flexDirection="column" paddingX={2}>
      <BossBanner subtitle={subtitle} hint={hint} />
      <Box flexDirection="column" marginLeft={2}>
        {showingTop && <Text color={COLORS.textDim}>{"  ↑ more above"}</Text>}
        {visible.map((p, i) => {
          const realIndex = scrollOffset + i;
          const isCursor = realIndex === cursor;
          const isSelected = selected.has(p.path);
          const checkbox = isSelected ? "[✓]" : "[ ]";
          const arrow = isCursor ? "❯" : " ";
          const nameColor = isCursor ? COLORS.primary : isSelected ? COLORS.success : COLORS.text;
          const checkboxColor = isSelected ? COLORS.success : COLORS.textDim;
          const badge = sourceBadge(p.sources);
          return (
            <Box key={p.path}>
              <Text color={COLORS.primary}>{arrow}</Text>
              <Text> </Text>
              <Text color={checkboxColor}>{checkbox}</Text>
              <Text> </Text>
              <Text color={badge.color}>{badge.label}</Text>
              <Text> </Text>
              <Text color={nameColor} bold={isCursor}>
                {p.name}
              </Text>
              <Text color={COLORS.textDim}>{"  "}</Text>
              <Text color={COLORS.textDim}>{p.lastActiveDisplay}</Text>
            </Box>
          );
        })}
        {showingBottom && <Text color={COLORS.textDim}>{"  ↓ more below"}</Text>}
      </Box>
    </Box>
  );
}

interface LinkAppProps {
  projects: DiscoveredProject[];
  initialSelected: Set<string>;
  resolve: (result: { selected: string[]; cancelled: boolean }) => void;
}

function LinkApp({ projects, initialSelected, resolve }: LinkAppProps): React.ReactElement {
  const { exit } = useApp();
  return (
    <LinkScreen
      projects={projects}
      initialSelected={initialSelected}
      onDone={(selected, cancelled) => {
        resolve({ selected, cancelled });
        exit();
      }}
    />
  );
}

export async function runLinkCommand(): Promise<void> {
  const projects = await discoverProjects();
  const links = await loadLinks();
  const initialSelected = new Set(links.projects.map((p) => p.cwd));

  clearScreen();

  const result = await new Promise<{ selected: string[]; cancelled: boolean }>((resolve) => {
    const { waitUntilExit } = render(
      <LinkApp projects={projects} initialSelected={initialSelected} resolve={resolve} />,
    );
    void waitUntilExit();
  });

  if (result.cancelled) {
    process.stdout.write(chalk.hex(COLORS.textDim)("\nCancelled. No changes saved.\n"));
    return;
  }

  const linked: LinkedProject[] = result.selected
    .map((path) => projects.find((p) => p.path === path))
    .filter((p): p is DiscoveredProject => Boolean(p))
    .map((p) => ({ name: p.name, cwd: p.path }));

  await saveLinks({ projects: linked });

  process.stdout.write("\n");
  if (linked.length === 0) {
    process.stdout.write(chalk.hex(COLORS.warning)("Cleared linked projects.\n"));
  } else {
    process.stdout.write(
      chalk.hex(COLORS.success)(
        `Linked ${linked.length} project${linked.length === 1 ? "" : "s"}:\n`,
      ),
    );
    for (const p of linked) {
      process.stdout.write(
        "  " + chalk.hex(COLORS.primary)("·") + " " + chalk.hex(COLORS.text)(p.name) + "\n",
      );
    }
    process.stdout.write("\n");
    process.stdout.write(
      chalk.hex(COLORS.textDim)(`Run `) +
        chalk.hex(COLORS.accent)(MANAGER_COMMAND) +
        chalk.hex(COLORS.textDim)(` to start Kleio Manager.\n`),
    );
  }
}
