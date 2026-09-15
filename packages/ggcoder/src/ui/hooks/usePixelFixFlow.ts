import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Message, Provider } from "@kleio/ai";
import type { AgentTool } from "@kleio/agent";
import { log } from "../../core/logger.js";
import { detectLanguages, type LanguageId } from "../../core/language-detector.js";
import type { PreparedPixelFix } from "../../core/pixel-fix.js";
import type { SessionManager, TurnMetricPayload } from "../../core/session-manager.js";
import type { PreparedProjectRuntime } from "../project-runtime.js";
import { createSessionStats, type SessionStats } from "../session-summary.js";
import type { UseAgentLoopReturn } from "./useAgentLoop.js";
import type { RebuildSystemPromptOptions } from "./useModeState.js";
import type { CompletedItem, TaskItem } from "../app-items.js";
import type { DoneStatus } from "../layout-decisions.js";
import { toErrorItem } from "../error-item.js";

/** Minimal session-store surface the pixel run-all flag mirrors into. */
interface PixelSessionStore {
  runAllPixel?: boolean;
  sessionPath?: string;
  sessionId?: string;
  messages?: Message[];
  turnMetrics?: TurnMetricPayload[];
}

interface UsePixelFixFlowOptions {
  agentLoop: Pick<UseAgentLoopReturn, "run" | "reset" | "isRunning" | "suspendForProjectSwitch">;
  cwd: string;
  currentProvider: Provider;
  currentModel: string;
  rebuildToolsForCwd?: (cwd: string) => AgentTool[] | Promise<AgentTool[]>;
  prepareProjectRuntime?: (cwd: string, sessionId: string) => Promise<PreparedProjectRuntime>;
  flushPendingWrites?: () => Promise<void>;
  sessionStatsRef?: MutableRefObject<SessionStats>;
  turnMetricsRef?: MutableRefObject<TurnMetricPayload[]>;
  sessionStore?: PixelSessionStore;
  // Refs declared in App (created before useAgentLoop so its callbacks can read them).
  currentPixelFixRef: MutableRefObject<PreparedPixelFix | null>;
  runAllPixelRef: MutableRefObject<boolean>;
  startPixelFixRef: MutableRefObject<(errorId: string) => void>;
  cwdRef: MutableRefObject<string>;
  currentToolsRef: MutableRefObject<AgentTool[]>;
  injectedLanguagesRef: MutableRefObject<Set<LanguageId>>;
  setupHintShownRef?: MutableRefObject<boolean>;
  approvedPlanPathRef?: MutableRefObject<string | undefined>;
  rewindTurnRef?: MutableRefObject<number>;
  messagesRef: MutableRefObject<Message[]>;
  persistedIndexRef: MutableRefObject<number>;
  sessionManagerRef: MutableRefObject<SessionManager | null>;
  sessionPathRef: MutableRefObject<string | undefined>;
  // Setters / helpers owned by App.
  setDisplayedCwd: Dispatch<SetStateAction<string>>;
  setCurrentTools: Dispatch<SetStateAction<AgentTool[]>>;
  setHistory: Dispatch<SetStateAction<CompletedItem[]>>;
  setLiveItems: Dispatch<SetStateAction<CompletedItem[]>>;
  setLastUserMessage: Dispatch<SetStateAction<string>>;
  setDoneStatus: Dispatch<SetStateAction<DoneStatus | null>>;
  rebuildSystemPrompt: (options?: RebuildSystemPromptOptions) => Promise<string>;
  clearPendingHistory: () => void;
  getId: () => string;
  initialRunAllPixel: boolean;
}

export interface PixelFixFlow {
  startPixelFix: (errorId: string) => void;
  runAllPixel: boolean;
  setRunAllPixel: Dispatch<SetStateAction<boolean>>;
}

/**
 * Owns the in-Ink pixel-fix flow: swapping cwd/tools/system-prompt/banner in
 * lockstep, resetting chat state, kicking off the agent run, and the "fix all"
 * run-all flag. Extracted verbatim from `App.tsx`; see CLAUDE.md for the
 * four-things-in-lockstep contract.
 */
export function usePixelFixFlow({
  agentLoop,
  cwd,
  currentProvider,
  currentModel,
  rebuildToolsForCwd,
  prepareProjectRuntime,
  flushPendingWrites,
  sessionStatsRef,
  turnMetricsRef,
  sessionStore,
  currentPixelFixRef,
  runAllPixelRef,
  startPixelFixRef,
  cwdRef,
  currentToolsRef,
  injectedLanguagesRef,
  setupHintShownRef,
  approvedPlanPathRef,
  rewindTurnRef,
  messagesRef,
  persistedIndexRef,
  sessionManagerRef,
  sessionPathRef,
  setDisplayedCwd,
  setCurrentTools,
  setHistory,
  setLiveItems,
  setLastUserMessage,
  setDoneStatus,
  rebuildSystemPrompt,
  clearPendingHistory,
  getId,
  initialRunAllPixel,
}: UsePixelFixFlowOptions): PixelFixFlow {
  const [runAllPixel, setRunAllPixel] = useState(initialRunAllPixel);
  const switchingRef = useRef(false);

  const startPixelFix = useCallback(
    (errorId: string) => {
      if (switchingRef.current) return;
      switchingRef.current = true;
      void (async () => {
        let prepared: PreparedProjectRuntime | undefined;
        let resume: (() => void) | undefined;
        let previousProcessCwd: string | undefined;
        let committed = false;
        try {
          if (agentLoop.suspendForProjectSwitch) {
            resume = await agentLoop.suspendForProjectSwitch();
          } else if (agentLoop.isRunning) {
            throw new Error("Wait for the current run to finish before switching projects.");
          }
          await flushPendingWrites?.();

          // Preparation can check out a branch in the current project. It must
          // wait for both the old run and its saves, not just runtime replacement.
          const { preparePixelFix } = await import("../../core/pixel-fix.js");
          const prep = await preparePixelFix(errorId);
          const sm = sessionManagerRef.current;
          const session = await sm?.create(prep.projectPath, currentProvider, currentModel);
          let toolsForPixelFix = currentToolsRef.current;
          if (prepareProjectRuntime) {
            if (!session)
              throw new Error("A session is required to prepare the Pixel project runtime.");
            prepared = await prepareProjectRuntime(prep.projectPath, session.id);
            toolsForPixelFix = prepared.runtime.tools;
          } else if (rebuildToolsForCwd) {
            toolsForPixelFix = await rebuildToolsForCwd(prep.projectPath);
          }
          const detectedForPixelFix = detectLanguages(prep.projectPath);
          const newSystemPrompt = await rebuildSystemPrompt({
            cwd: prep.projectPath,
            clearApprovedPlan: true,
            activeLanguages: detectedForPixelFix,
            tools: toolsForPixelFix,
            skills: prepared?.runtime.skills,
          });

          await prepared?.runtime.checkpointStore?.openCheckpoint({
            turnIndex: 1,
            messageIndex: 1,
          });

          // All fallible preparation happens before the live session is replaced.
          // A failed chdir is fatal to this transition, never a reason to proceed
          // with tools and UI pointing at a different root than process.cwd().
          previousProcessCwd = process.cwd();
          process.chdir(prep.projectPath);
          await prepared?.commit();
          committed = true;
          currentPixelFixRef.current = prep;
          cwdRef.current = prep.projectPath;
          currentToolsRef.current = toolsForPixelFix;
          injectedLanguagesRef.current = detectedForPixelFix;
          if (setupHintShownRef) setupHintShownRef.current = false;
          if (approvedPlanPathRef) approvedPlanPathRef.current = undefined;
          if (rewindTurnRef && prepared?.runtime.checkpointStore) rewindTurnRef.current = 1;
          setDisplayedCwd(prep.projectPath);
          setCurrentTools(toolsForPixelFix);
          clearPendingHistory();
          setHistory([{ kind: "banner", id: "banner" }]);
          setLiveItems([]);
          messagesRef.current = [{ role: "system", content: newSystemPrompt }];
          agentLoop.reset();
          persistedIndexRef.current = messagesRef.current.length;
          if (session) {
            sessionPathRef.current = session.path;
            if (sessionStatsRef)
              sessionStatsRef.current = createSessionStats({ sessionId: session.id });
            if (turnMetricsRef) turnMetricsRef.current = [];
            if (sessionStore) {
              sessionStore.sessionPath = session.path;
              sessionStore.sessionId = session.id;
              sessionStore.messages = [...messagesRef.current];
              sessionStore.turnMetrics = [];
            }
            log("INFO", "pixel", "New session for pixel fix", { path: session.path });
          }

          const title = `Fix ${errorId.slice(0, 12)}… in ${prep.projectName}`;
          const taskItem: TaskItem = { kind: "task", title, id: getId() };
          setLastUserMessage(title);
          setDoneStatus(null);
          setLiveItems([taskItem]);
          resume?.();
          resume = undefined;
          // Keep ownership through this run: its finalizer must not release a
          // newer switch's lock or overwrite the newer fix's error state.
          await agentLoop.run(prep.prompt);
        } catch (err) {
          if (!committed && previousProcessCwd !== undefined) {
            try {
              process.chdir(previousProcessCwd);
            } catch {
              log("ERROR", "pixel", "Could not restore the previous working directory.");
            }
          }
          await prepared?.dispose().catch(() => {
            log("ERROR", "pixel", "Could not close the prepared project runtime.");
          });
          const msg = err instanceof Error ? err.message : String(err);
          log("ERROR", "pixel", msg);
          currentPixelFixRef.current = null;
          setRunAllPixel(false);
          setLiveItems((prev) => [...prev, toErrorItem(err, getId())]);
        } finally {
          resume?.();
          switchingRef.current = false;
        }
      })();
    },
    [cwd, agentLoop, currentProvider, currentModel],
  );
  startPixelFixRef.current = startPixelFix;

  // Seed from sessionStore so "Fix All" chaining survives a deferred
  // resetUI() if it fires between pixel fixes (e.g. user toggled a pane).
  useEffect(() => {
    runAllPixelRef.current = runAllPixel;
    if (sessionStore) sessionStore.runAllPixel = runAllPixel;
  }, [runAllPixel, sessionStore, runAllPixelRef]);

  return { startPixelFix, runAllPixel, setRunAllPixel };
}
