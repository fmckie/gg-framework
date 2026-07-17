import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { clip, compact, err, summarizeList } from "../core/format.js";
import { clusterSegments } from "../core/clustering.js";
import { parseTranscript } from "../core/whisper.js";

const ClusterTakesParams = z.object({
  path: z.string().describe("Transcript JSON file written by `transcribe`."),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Jaccard similarity 0-1 to count as same take. Default 0.6 (loose); 0.8 = strict."),
  window: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Only compare segments within N positions of each other. Default 100."),
  minTokens: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Skip segments with fewer than N meaningful tokens. Default 4."),
});

export function createClusterTakesTool(cwd: string): AgentTool<typeof ClusterTakesParams> {
  return {
    name: "cluster_takes",
    description:
      "Find repeated takes in a transcript — groups of segments that are likely the same line " +
      "said multiple times (re-takes). Use to pick the BEST take per cluster: read each cluster's " +
      "members, then call score_shot at their timestamps to evaluate visual quality, then write_edl " +
      "with the winners. Token-based similarity (free, deterministic, no API call).",
    parameters: ClusterTakesParams,
    async execute({ path, threshold, window, minTokens }) {
      try {
        const abs = resolvePath(cwd, path);
        const t = parseTranscript(readFileSync(abs, "utf8"));
        if (!t.segments || t.segments.length === 0) {
          return err("transcript has no segments", "verify the file is from `transcribe`");
        }

        const clusters = clusterSegments(t.segments, { threshold, window, minTokens });

        // Compact view: one entry per cluster with size + member timestamps + truncated text.
        // Cap members per cluster to 5 so context stays predictable.
        const compactClusters = clusters.map((c) => ({
          id: c.id,
          size: c.members.length,
          members: c.members.slice(0, 5).map((m) => ({
            start: +m.start.toFixed(2),
            end: +m.end.toFixed(2),
            text: clip(m.text, 80),
          })),
          ...(c.members.length > 5 ? { truncated: c.members.length - 5 } : {}),
        }));

        const summary = summarizeList(compactClusters, 30);

        return compact({
          totalSegments: t.segments.length,
          clustersFound: clusters.length,
          totalRetakes: clusters.reduce((sum, c) => sum + c.members.length, 0),
          ...(summary.omitted > 0
            ? { omitted: summary.omitted, head: summary.head, tail: summary.tail }
            : { clusters: compactClusters }),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
