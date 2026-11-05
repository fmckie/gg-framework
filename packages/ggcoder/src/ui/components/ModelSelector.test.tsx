import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink";
import { Writable } from "node:stream";
import { ModelSelector } from "./ModelSelector.js";
import { ThemeContext, loadTheme } from "../theme/theme.js";

const inputHandlers: Array<(input: string, key: Record<string, boolean>) => void> = [];

vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<{ render: typeof render }>();
  return {
    ...actual,
    useInput: (handler: (input: string, key: Record<string, boolean>) => void) => {
      inputHandlers.push(handler);
    },
  };
});

vi.mock("../hooks/useTerminalSize.js", () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30 }),
}));

function stripAnsi(value: string): string {
  return value.replace(new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g"), "");
}

function renderSelector() {
  inputHandlers.length = 0;
  let output = "";
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as NodeJS.WriteStream;
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  const onSelect = vi.fn();
  const result = render(
    <ThemeContext.Provider value={loadTheme("dark")}>
      <ModelSelector
        onSelect={onSelect}
        onCancel={vi.fn()}
        loggedInProviders={["anthropic"]}
        currentModel="claude-opus-5-5"
        currentProvider="anthropic"
      />
    </ThemeContext.Provider>,
    // debug: write every frame immediately instead of throttling.
    { stdout, patchConsole: false, debug: true },
  );
  return { ...result, onSelect, output: () => stripAnsi(output) };
}

/** Send a key to the most recently rendered list and let Ink re-render. */
async function press(key: Record<string, boolean>): Promise<void> {
  inputHandlers.at(-1)?.("", key);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ModelSelector — a model that spends real money", () => {
  it("asks first, defaults to Cancel, and switches only on the explicit yes", async () => {
    const view = renderSelector();
    try {
      // From Claude Opus 5.5, one step down is Claude Opus 5.5 Fast.
      await press({ downArrow: true });
      await press({ return: true });
      expect(view.onSelect).not.toHaveBeenCalled();
      expect(view.output()).toContain("Claude Opus 5.5 Fast spends real money.");

      // Enter on the default answer (Cancel) backs out without switching.
      await press({ return: true });
      expect(view.onSelect).not.toHaveBeenCalled();

      // Back in the list: pick it again, then explicitly choose to pay.
      await press({ downArrow: true });
      await press({ return: true });
      await press({ downArrow: true });
      await press({ return: true });
      expect(view.onSelect).toHaveBeenCalledWith("anthropic:claude-opus-5-5-fast");
    } finally {
      view.unmount();
    }
  });

  it("backs out of the confirmation on Escape", async () => {
    const view = renderSelector();
    try {
      await press({ downArrow: true });
      await press({ return: true });
      await press({ escape: true });
      expect(view.onSelect).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });
});
