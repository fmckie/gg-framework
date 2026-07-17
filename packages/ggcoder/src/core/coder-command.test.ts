import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCoderCommand } from "./coder-command.js";

const executable = (paths: readonly string[]) => {
  const known = new Set(paths);
  return (filePath: string): boolean => known.has(filePath);
};

describe("resolveCoderCommand", () => {
  it("reuses the current Coder script before PATH aliases and preserves Node flags", () => {
    const currentScript = "/workspace/packages/ggcoder/dist/cli.js";

    expect(
      resolveCoderCommand({
        currentScript,
        nodeExecutable: "/runtime/node",
        nodeArgs: ["--max-old-space-size=8192", "--expose-gc"],
        pathEnv: "/preferred:/legacy",
        isExecutable: executable([
          path.join("/preferred", "kleio-coder"),
          path.join("/legacy", "ggcoder"),
        ]),
      }),
    ).toEqual({
      command: "/runtime/node",
      argsPrefix: ["--max-old-space-size=8192", "--expose-gc", currentScript],
      source: "current",
    });
  });

  it("prefers kleio-coder over the legacy bin on PATH", () => {
    const preferred = path.join("/tools", "kleio-coder");
    const legacy = path.join("/tools", "ggcoder");

    expect(
      resolveCoderCommand({
        currentScript: null,
        pathEnv: "/tools",
        isExecutable: executable([preferred, legacy]),
      }),
    ).toEqual({ command: preferred, argsPrefix: [], source: "preferred" });
  });

  it("falls back to the installed ggcoder alias", () => {
    const legacy = path.join("/legacy", "ggcoder");

    expect(
      resolveCoderCommand({
        currentScript: null,
        pathEnv: "/legacy",
        isExecutable: executable([legacy]),
      }),
    ).toEqual({ command: legacy, argsPrefix: [], source: "legacy" });
  });

  it("returns the preferred command name when no installed bin resolves", () => {
    expect(
      resolveCoderCommand({ currentScript: null, pathEnv: "", isExecutable: () => false }),
    ).toEqual({ command: "kleio-coder", argsPrefix: [], source: "default" });
  });
});
