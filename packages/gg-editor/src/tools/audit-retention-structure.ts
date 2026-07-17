import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { runRetentionAudit } from "../core/retention-structure.js";
import { parseTranscript } from "../core/whisper.js";
import type { Transcript } from "../core/whisper.js";

const AuditRetentionStructureParams = z.object({
  transcript: z
    .string()
    .describe("Path to a transcript JSON written by `transcribe`. Segments required."),
  durationSec: z
    .number()
    .positive()
    .optional()
    .describe(
      "Override transcript.durationSec — useful when you trust the ffprobe duration over the " +
        "transcript's reported one.",
    ),
  checkpoints: z
    .array(z.number().positive())
    .optional()
    .describe(
      "Checkpoints to audit (seconds). Default [180, 360] — the 3-min and 6-min " +
        "re-engagement marks. For a 12+ min video pass [180, 360, 540, 720]. Each becomes a " +
        "60s window centred on the timestamp.",
    ),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
});

/**
 * audit_retention_structure — long-form retention checkpoint auditor.
 *
 * Per MrBeast's documented manual, every ~3 minutes a re-engagement is
 * required to keep retention from collapsing. This tool builds a 60s
 * window around each requested checkpoint, asks the LLM to score
 * whether re-engagement is happening, and reports the weakest one so
 * the agent knows where to insert b-roll, punch-ins, or a recut.
 */
export function createAuditRetentionStructureTool(
  cwd: string,
): AgentTool<typeof AuditRetentionStructureParams> {
  return {
    name: "audit_retention_structure",
    description:
      "Audit a long-form video transcript for retention checkpoints (3-min, 6-min " +
      "re-engagements per MrBeast's documented method) and overall escalation pattern. Each " +
      "checkpoint scored 0-1 with a one-line suggestion when weak. Pair with the " +
      "youtube-algorithm-primer skill — viewers drop hardest at flat stretches between " +
      "minutes 1-7. Returns checkpoints[], escalationScore, and weakestCheckpoint so the " +
      "agent knows where to insert b-roll, punch-ins, or re-cut. Requires `transcribe` first.",
    parameters: AuditRetentionStructureParams,
    async execute(args, ctx) {
      try {
        if (!process.env.OPENAI_API_KEY) {
          return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
        }

        const transcriptAbs = resolvePath(cwd, args.transcript);
        let raw: string;
        try {
          raw = readFileSync(transcriptAbs, "utf8");
        } catch (e) {
          return err(
            `cannot read transcript ${transcriptAbs}: ${(e as Error).message}`,
            "verify the transcript JSON exists",
          );
        }
        let t: Transcript;
        try {
          t = parseTranscript(raw);
        } catch (e) {
          return err((e as Error).message);
        }
        if (t.segments.length === 0) {
          return err("transcript has no segments", "rerun transcribe(...)");
        }

        const totalSec = args.durationSec ?? t.durationSec;
        if (!totalSec || totalSec <= 0) {
          return err("transcript has zero duration", "pass durationSec explicitly");
        }

        const result = await runRetentionAudit(t, {
          model: args.model,
          checkpoints: args.checkpoints,
          durationSec: totalSec,
          signal: ctx.signal,
        });

        return compact({
          checkpoints: result.checkpoints.map((c) => ({
            atSec: c.atSec,
            score: +c.score.toFixed(2),
            summary: c.summary,
            ...(c.suggestion ? { suggestion: c.suggestion } : {}),
          })),
          escalationScore: +result.escalationScore.toFixed(2),
          overallSummary: result.overallSummary,
          weakestCheckpoint: result.weakestCheckpoint,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
