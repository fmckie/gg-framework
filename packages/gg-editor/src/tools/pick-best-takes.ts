import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { clusterSegments } from "../core/clustering.js";
import { compact, err, summarizeList } from "../core/format.js";
import { extractAtTimes } from "../core/frames.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";
import { parseTranscript } from "../core/whisper.js";
import { scoreFrames } from "../core/vision.js";

const PickBestTakesParams = z.object({
  transcriptPath: z.string().describe("Transcript JSON file from `transcribe`."),
  videoPath: z
    .string()
    .optional()
    .describe(
      "Video file. Required if strategy uses vision. Optional if strategy='last' or 'first'.",
    ),
  strategy: z
    .enum(["last", "first", "vision"])
    .optional()
    .describe(
      "How to pick within a cluster. " +
        "'last' (default) — pick the latest take (speakers warm up). " +
        "'first' — pick the earliest take. " +
        "'vision' — score frames via score_shot, pick highest visual quality.",
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Cluster similarity threshold. Default 0.6."),
  visionDetail: z.enum(["low", "high"]).optional(),
  maxClusters: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Cap clusters processed (default 30)."),
});

interface PickResult {
  cluster: number;
  pickedIndex: number;
  pickedTake: { start: number; end: number; text: string };
  droppedIndexes: number[];
  reason: string;
  score?: number;
}

export function createPickBestTakesTool(cwd: string): AgentTool<typeof PickBestTakesParams> {
  return {
    name: "pick_best_takes",
    description:
      "Composite: cluster transcript re-takes, then pick the best take per cluster using a " +
      "configurable strategy ('last', 'first', or 'vision'). Returns picks + dropped segments " +
      "with reasoning, ready to feed into write_edl/write_fcpxml. " +
      "Replaces manual orchestration of cluster_takes -> score_shot -> winner-picking.",
    parameters: PickBestTakesParams,
    async execute(args, ctx) {
      try {
        const {
          transcriptPath,
          videoPath,
          strategy = "last",
          threshold = 0.6,
          visionDetail,
          maxClusters = 30,
        } = args;

        // Load transcript
        const tAbs = resolvePath(cwd, transcriptPath);
        const t = parseTranscript(readFileSync(tAbs, "utf8"));
        if (!t.segments || t.segments.length === 0) {
          return err("transcript has no segments");
        }

        // Cluster
        const clusters = clusterSegments(t.segments, { threshold });
        const limited = clusters.slice(0, maxClusters);
        if (limited.length === 0) {
          return compact({
            clustersFound: 0,
            picks: [],
            note: "no multi-take clusters detected; nothing to pick",
          });
        }

        // Apply strategy
        const picks: PickResult[] = [];

        if (strategy === "last" || strategy === "first") {
          for (const c of limited) {
            const indexes = c.memberIndexes;
            const pickedIndex = strategy === "last" ? indexes[indexes.length - 1] : indexes[0];
            const pickedTake = c.members[strategy === "last" ? indexes.length - 1 : 0];
            picks.push({
              cluster: c.id,
              pickedIndex,
              pickedTake: round3(pickedTake),
              droppedIndexes: indexes.filter((i) => i !== pickedIndex),
              reason: strategy === "last" ? "latest take (speaker warmed up)" : "earliest take",
            });
          }
        } else {
          // strategy === "vision"
          if (!videoPath) return err("videoPath required for strategy='vision'");
          if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
          if (!process.env.OPENAI_API_KEY) return err("OPENAI_API_KEY not set");

          // Build a flat list of (clusterIdx, memberIdx, midSec) to score in one batch
          const flat: Array<{ clusterIdx: number; memberIdx: number; midSec: number }> = [];
          for (let ci = 0; ci < limited.length; ci++) {
            const c = limited[ci];
            for (let mi = 0; mi < c.members.length; mi++) {
              const m = c.members[mi];
              flat.push({
                clusterIdx: ci,
                memberIdx: mi,
                midSec: (m.start + m.end) / 2,
              });
            }
          }

          const vAbs = resolvePath(cwd, videoPath);
          const frames = await extractAtTimes(
            vAbs,
            flat.map((f) => f.midSec),
            { maxWidth: 1280, signal: ctx.signal },
          );
          const scores = await scoreFrames(frames, {
            detail: visionDetail,
            signal: ctx.signal,
          });

          // Group scores by cluster, pick max
          for (let ci = 0; ci < limited.length; ci++) {
            const c = limited[ci];
            const clusterScores = flat
              .map((f, i) => ({ ...f, score: scores[i].score, why: scores[i].why }))
              .filter((x) => x.clusterIdx === ci);
            const winner = clusterScores.reduce((best, cur) =>
              cur.score > best.score ? cur : best,
            );
            const pickedIndex = c.memberIndexes[winner.memberIdx];
            picks.push({
              cluster: c.id,
              pickedIndex,
              pickedTake: round3(c.members[winner.memberIdx]),
              droppedIndexes: c.memberIndexes.filter((i) => i !== pickedIndex),
              reason: `vision: ${winner.why}`,
              score: winner.score,
            });
          }
        }

        // Compact output
        const summary = summarizeList(picks, 30);
        return compact({
          clustersFound: clusters.length,
          processed: limited.length,
          strategy,
          picks: summary.omitted > 0 ? summary.head.concat(summary.tail) : picks,
          ...(summary.omitted > 0 ? { omitted: summary.omitted } : {}),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

function round3(seg: { start: number; end: number; text: string }): {
  start: number;
  end: number;
  text: string;
} {
  return {
    start: +seg.start.toFixed(2),
    end: +seg.end.toFixed(2),
    text: seg.text.length > 80 ? seg.text.slice(0, 79) + "…" : seg.text,
  };
}
