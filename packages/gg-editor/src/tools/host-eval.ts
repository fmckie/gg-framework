import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";

const HostEvalParams = z.object({
  code: z
    .string()
    .min(1, "code must be a non-empty snippet of host-native scripting code.")
    .describe(
      "Host-native scripting code. Resolve = Python (DaVinciResolveScript module pre-loaded). " +
        "Premiere = ExtendScript (Premiere DOM pre-loaded). One snippet per call.",
    ),
});

/**
 * Escape hatch — runs arbitrary host-native scripting code with the live NLE
 * objects pre-bound. Routes to whichever adapter is connected:
 *
 *   - Resolve  → Python via the long-lived bridge sidecar
 *   - Premiere → ExtendScript via the JSX bridge
 *   - none     → returns `error: not_supported` (no host attached)
 *
 * **Use this only when no named tool covers what you need.** The named tools
 * have validation, output shaping, capability fallbacks, and EDL/FCPXML
 * bulk-paths this raw eval skips entirely. If a named tool exists for what
 * you're doing, use the named tool.
 *
 * Pre-bound globals on Resolve (Python):
 *   - `resolve`, `project`, `projectManager`, `mediaPool`, `mediaStorage`
 *   - `timeline`, `fusion`, `dvr` (the DaVinciResolveScript module)
 *   - `set_result(value)` — return JSON-serialisable data to the agent
 *   - `result` — alternative: assign at top level
 *   - `print(...)` — captured to `stdout`
 *
 * Pre-bound globals on Premiere (ExtendScript):
 *   - `app`, `project`, `sequence`, `qe` (Quality Engineering DOM, undocumented)
 *   - `setResult(value)` — return JSON-serialisable data
 *   - `result` — alternative: assign at top level
 *   - `print(...)` — captured to `stdout`
 */
export function createHostEvalTool(host: VideoHost): AgentTool<typeof HostEvalParams> {
  return {
    name: "host_eval",
    description:
      "Escape hatch: run host-native scripting code (Python on Resolve, ExtendScript on " +
      "Premiere) with the NLE DOM pre-bound. Returns {result, stdout?}. ONLY use when no " +
      "named tool fits — named tools have validation, summarised output, and EDL fallbacks " +
      "this raw path skips. Prefer set_result(value) (Resolve: Python; Premiere: setResult) " +
      "to return data; print()/stdout is captured. Resolve scope: resolve, project, " +
      "projectManager, mediaPool, mediaStorage, timeline, fusion, dvr. Premiere scope: app, " +
      "project, sequence, qe. Returns error: not_supported when no NLE is attached " +
      "(host=none) — call host_info first if unsure.",
    parameters: HostEvalParams,
    async execute({ code }) {
      try {
        if (typeof host.executeCode !== "function") {
          return err(
            "not_supported",
            `host=${host.name} has no scripting bridge. Open Resolve or Premiere, then retry.`,
          );
        }
        const out = await host.executeCode(code);
        // Compact output: omit empty stdout, omit null result if stdout exists.
        const payload: Record<string, unknown> = {};
        if (out.result !== null && out.result !== undefined) payload.result = out.result;
        if (out.stdout) payload.stdout = out.stdout;
        if (Object.keys(payload).length === 0) return "ok";
        return compact(payload);
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
