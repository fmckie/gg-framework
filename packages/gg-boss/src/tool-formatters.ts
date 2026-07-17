import type { ToolExecutionFormatters } from "@kleio/coder/ui";
import { projectColor } from "./colors.js";

function truncate(s: string, max: number): string {
  if (max <= 1) return "…";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Compute how many chars of the prompt-worker message detail can fit on a
 * single line of the current terminal. Header chrome ≈ "⏺ Prompt Worker(<proj>
 *  · …) <inline>" — we subtract the fixed pieces so the message gets whatever
 * room remains.
 */
function promptWorkerDetailLen(project: string): number {
  const cols = process.stdout.columns ?? 80;
  // Fixed overhead estimate: dot(2) + label "Prompt Worker"(13) + "("(1)
  // + project + " · "(3) + ")"(1) + " "(1) + " dispatched"(11) + safety(6).
  const fixed = 2 + 13 + 1 + project.length + 3 + 1 + 1 + 11 + 6;
  return Math.max(20, cols - fixed);
}

/**
 * Custom label / detail / inline-summary rendering for the boss's own tools.
 * Falls through to ggcoder's defaults for anything else.
 */
export const bossToolFormatters: ToolExecutionFormatters = {
  formatLabel(name) {
    switch (name) {
      case "list_workers":
        return "List Workers";
      case "get_worker_status":
        return "Worker Status";
      case "prompt_worker":
        return "Prompt Worker";
      case "get_worker_summary":
        return "Worker Summary";
      default:
        return undefined;
    }
  },

  formatDetail(name, args) {
    switch (name) {
      case "list_workers":
        return "";
      case "get_worker_status":
      case "get_worker_summary":
        return truncate(String(args.project ?? ""), 40);
      case "prompt_worker": {
        const project = String(args.project ?? "");
        const message = String(args.message ?? "").replace(/\s+/g, " ");
        const fresh = args.fresh === true;
        const maxMsg = promptWorkerDetailLen(project) - (fresh ? 8 : 0); // "fresh · " is 8 chars
        const truncMsg = truncate(message, Math.max(15, maxMsg));
        const head = fresh ? "fresh · " : "";
        return project ? `${head}${project} · ${truncMsg}` : `${head}${truncMsg}`;
      }
      default:
        return undefined;
    }
  },

  formatInline(name, result, isError) {
    if (isError) return undefined;
    switch (name) {
      case "list_workers": {
        const lines = result.split("\n").filter((l) => l.startsWith("-"));
        return `${lines.length} worker${lines.length === 1 ? "" : "s"}`;
      }
      case "prompt_worker": {
        if (result.includes("currently working")) {
          return { text: "busy — skipped", color: "#fbbf24" };
        }
        if (result.includes("Unknown project")) {
          return { text: "unknown project", color: "#f87171" };
        }
        // Color the badge by project — same project always reads as the same
        // hue across scrollback so the user can scan dispatches at a glance.
        // (When fresh: true, the "fresh ·" prefix is already in the detail
        // parens — no need to double up here, was causing line wraps.)
        const project = String(result.match(/"([^"]+)"/)?.[1] ?? "");
        const color = project ? projectColor(project) : "#e11d48";
        return { text: "dispatched", color };
      }
      case "get_worker_status": {
        const parts = result.split(":");
        if (parts.length < 2) return undefined;
        const status = parts.slice(1).join(":").trim();
        const project = parts[0]!.trim();
        return { text: status, color: projectColor(project) };
      }
      case "get_worker_summary": {
        const turnMatch = result.match(/Turn:\s*(\d+)/);
        const projectMatch = result.match(/Project:\s*(.+)/);
        const toolsMatch = result.match(/Tools used:\s*(.+)/);
        const tools = toolsMatch ? toolsMatch[1] : "";
        const toolCount = tools && tools !== "(no tools used)" ? tools.split(",").length : 0;
        const turn = turnMatch ? `turn ${turnMatch[1]}` : undefined;
        const tCount = toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : undefined;
        const summary = [turn, tCount].filter(Boolean).join(" · ");
        if (!summary) return undefined;
        const project = projectMatch ? projectMatch[1].trim() : "";
        return project
          ? { text: summary, color: projectColor(project) }
          : { text: summary, color: "#9ca3af" };
      }
      default:
        return undefined;
    }
  },
};
