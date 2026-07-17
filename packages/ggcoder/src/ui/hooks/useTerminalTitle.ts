import { useEffect, useRef } from "react";
import { useStdout } from "ink";
import { KLEIO_PRODUCT_PROFILE } from "@kleio/core";

export interface TerminalTitleOptions {
  isRunning: boolean;
  /** LLM-generated session title (shown as the terminal window title). */
  sessionTitle?: string;
}

export function useTerminalTitle({ isRunning, sessionTitle }: TerminalTitleOptions): void {
  const { stdout } = useStdout();

  // Track previous title to avoid redundant writes
  const prevTitleRef = useRef("");

  // Write terminal title
  useEffect(() => {
    if (!stdout) return;
    let title: string;
    if (sessionTitle) {
      title = isRunning ? `● ${sessionTitle}` : sessionTitle;
    } else {
      title = KLEIO_PRODUCT_PROFILE.coder.displayName;
    }
    if (title !== prevTitleRef.current) {
      prevTitleRef.current = title;
      stdout.write(`\x1b]0;${title}\x1b\\`);
    }
  }, [stdout, isRunning, sessionTitle]);

  // Reset title on unmount
  useEffect(() => {
    return () => {
      stdout?.write(`\x1b]0;${KLEIO_PRODUCT_PROFILE.coder.displayName}\x1b\\`);
    };
  }, [stdout]);
}
