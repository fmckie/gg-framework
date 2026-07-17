import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";

/**
 * search_tools — meta-tool. With ~85+ named tools the agent can wind up
 * scanning the system prompt to remember a tool's exact name; this is
 * a token-cheap shortcut: pass a query, get back the top matches with
 * their one-line descriptions.
 *
 * The factory receives a *getter* so we can reflect over the live tool
 * registry as it stands at agent-construction time. We avoid a circular
 * import by accepting the tool list directly.
 */

const SearchToolsParams = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "What you're looking for. Free text — matches against tool names AND descriptions. " +
        "E.g. 'silence', 'youtube metadata', 'caption emoji'.",
    ),
  limit: z.number().int().min(1).max(20).optional().describe("Max results. Default 8."),
});

export interface SearchableTool {
  name: string;
  description: string;
}

/**
 * Score a tool against a query. Higher = better match. Pure function so the
 * algorithm can be tuned + tested without booting the agent.
 *
 * Heuristic:
 *   +5 per query word that appears in the tool name
 *   +1 per query word that appears in the description
 *   +3 if the query is a substring of the name
 *   normalize: lowercase, strip non-alphanumerics
 */
export function scoreToolMatch(query: string, tool: SearchableTool): number {
  const q = query.toLowerCase().trim();
  if (q.length === 0) return 0;
  const nameLc = tool.name.toLowerCase();
  const descLc = tool.description.toLowerCase();
  let score = 0;
  if (nameLc.includes(q.replace(/\s+/g, "_"))) score += 3;
  if (nameLc.includes(q)) score += 3;

  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  for (const w of words) {
    if (nameLc.includes(w)) score += 5;
    if (descLc.includes(w)) score += 1;
  }
  return score;
}

export function createSearchToolsTool(
  getTools: () => SearchableTool[],
): AgentTool<typeof SearchToolsParams> {
  return {
    name: "search_tools",
    description:
      "Find tools by query — fuzzy-matches against names and descriptions. Use when you need a " +
      "capability and aren't sure which tool exposes it. Returns top matches with their one-line " +
      "descriptions. Cheap (no LLM, no I/O). Token-savvy alternative to re-scanning the system " +
      "prompt.",
    parameters: SearchToolsParams,
    async execute({ query, limit }) {
      try {
        const tools = getTools().filter((t) => t.name !== "search_tools");
        const max = Math.min(limit ?? 8, 20);
        const scored = tools
          .map((t) => ({ tool: t, score: scoreToolMatch(query, t) }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, max);
        if (scored.length === 0) {
          return compact({ matches: [], note: "no tools matched — try a broader query" });
        }
        return compact({
          matches: scored.map((s) => ({
            name: s.tool.name,
            description: s.tool.description,
            score: s.score,
          })),
          total: scored.length,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
