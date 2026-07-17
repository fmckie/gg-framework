import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { buildEdl } from "../core/edl.js";
import {
  keepRangesFromFillers,
  keepRangesToFrameRanges,
  type FillerRange,
} from "../core/filler-words.js";
import { compact, err } from "../core/format.js";
import { probeMedia } from "../core/media/ffmpeg.js";
import { safeOutputPath } from "../core/safe-paths.js";

/**
 * text_based_cut — Descript's flagship feature, generalised. Given an
 * arbitrary list of (startSec, endSec) cut ranges, emit an EDL of KEEP
 * ranges using the same frame-aligned, padding-aware math as
 * cut_filler_words. The agent typically populates `cuts` after one of:
 *
 *   - The user marked sentences in the transcript they want removed.
 *   - An LLM diffed an "edited" transcript against the original and
 *     produced a delete-list.
 *   - A previous tool (e.g. cluster_takes) flagged ranges to drop.
 *
 * Distinct from cut_filler_words because the cut list is opinion-free
 * here — the caller decides what to remove. Distinct from write_edl
 * because this tool computes the *inverse* (keep ranges) for you.
 */

const TextBasedCutParams = z.object({
  sourceVideo: z.string().describe("The source media. Frame rate auto-detected via probe."),
  cuts: z
    .array(
      z.object({
        startSec: z.number().min(0),
        endSec: z.number().min(0),
        reason: z.string().optional().describe("Optional human-readable reason for this cut."),
      }),
    )
    .min(1)
    .describe(
      "Ranges to REMOVE. The tool emits the inverse (keep ranges) as an EDL. For multi-segment " +
        "removals, pass them all in one call; ranges may overlap (they're merged).",
    ),
  edlOutput: z.string().optional().describe("Where to write the EDL. Default: a tempfile."),
  reel: z
    .string()
    .optional()
    .describe("EDL reel name. Default = source basename without extension (truncated to 8 chars)."),
  frameRate: z
    .number()
    .positive()
    .optional()
    .describe("Override frame rate. Auto-detected from probe if omitted; 30 if probe fails."),
  paddingMs: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Optional padding extending each KEEP range outward, so cuts don't clip word edges. " +
        "Default 20ms.",
    ),
  dryRun: z
    .boolean()
    .optional()
    .describe(
      "If true (default), return the EDL path + stats without importing. The agent should " +
        "preview the diff before calling import_edl.",
    ),
});

export function createTextBasedCutTool(cwd: string): AgentTool<typeof TextBasedCutParams> {
  return {
    name: "text_based_cut",
    description:
      "Cut arbitrary ranges from a source via EDL. Pass `cuts: [{startSec, endSec}]` and the " +
      "tool emits the INVERSE (keep ranges) as an EDL ready for import_edl. The general-purpose " +
      "version of cut_filler_words — same frame-aligned math, but the caller picks what to drop. " +
      "Use this for transcript-driven 'delete this paragraph' edits (Descript-style text-based " +
      "editing) and for any LLM-derived removal list.",
    parameters: TextBasedCutParams,
    async execute(args) {
      try {
        const sourceAbs = resolvePath(cwd, args.sourceVideo);
        const probe = probeMedia(sourceAbs);
        const totalSec = probe?.durationSec;
        if (!totalSec || totalSec <= 0) {
          return err(
            `probe failed for ${sourceAbs}`,
            "verify the source file exists and is readable",
          );
        }
        const fps = args.frameRate ?? probe?.frameRate ?? 30;
        const padSec = (args.paddingMs ?? 20) / 1000;

        // Validate / clamp cut ranges, then translate them into the
        // FillerRange shape that keepRangesFromFillers expects (it only
        // reads startSec / endSec — the word-index fields are unused).
        const validatedCuts: Array<{ startSec: number; endSec: number; reason?: string }> = [];
        for (const c of args.cuts) {
          if (c.endSec <= c.startSec) {
            return err(
              `invalid cut: endSec (${c.endSec}) must be > startSec (${c.startSec})`,
              "fix the cut list",
            );
          }
          if (c.startSec >= totalSec) continue; // out of range — silently skip
          validatedCuts.push({
            startSec: Math.max(0, c.startSec),
            endSec: Math.min(totalSec, c.endSec),
            reason: c.reason,
          });
        }
        if (validatedCuts.length === 0) {
          return err("no valid cuts in range", "verify cut times are within the source duration");
        }
        // Sort + merge overlapping cuts so the keep computation is clean.
        validatedCuts.sort((a, b) => a.startSec - b.startSec);
        const merged: typeof validatedCuts = [];
        for (const c of validatedCuts) {
          const prev = merged[merged.length - 1];
          if (prev && c.startSec <= prev.endSec) {
            prev.endSec = Math.max(prev.endSec, c.endSec);
            if (c.reason && prev.reason && !prev.reason.includes(c.reason)) {
              prev.reason = `${prev.reason}; ${c.reason}`;
            }
          } else {
            merged.push({ ...c });
          }
        }

        const fillers: FillerRange[] = merged.map((c) => ({
          startSec: c.startSec,
          endSec: c.endSec,
          text: c.reason ?? "cut",
          startWordIndex: 0,
          endWordIndex: 0,
        }));
        // Negative padSec collapses keep ranges; a positive value extends
        // them. keepRangesFromFillers does inward padding by virtue of the
        // way it carves keeps; we widen by relaxing both endpoints.
        const keeps = keepRangesFromFillers(fillers, totalSec, 0).map((k) => ({
          startSec: Math.max(0, k.startSec - padSec),
          endSec: Math.min(totalSec, k.endSec + padSec),
        }));
        const frameKeeps = keepRangesToFrameRanges(keeps, fps);
        if (frameKeeps.length === 0) {
          return err("no keep ranges produced — the cut list covers the entire source");
        }

        const reelName =
          args.reel ??
          basename(sourceAbs, extname(sourceAbs))
            .replace(/[^A-Za-z0-9_]/g, "_")
            .slice(0, 8);
        const edl = buildEdl({
          title: `${basename(sourceAbs)} (text-based cut)`,
          frameRate: fps,
          events: frameKeeps.map((k) => ({
            reel: reelName,
            track: "B",
            sourceInFrame: k.startFrame,
            sourceOutFrame: k.endFrame,
            clipName: basename(sourceAbs),
          })),
        });
        const outAbs = args.edlOutput
          ? safeOutputPath(cwd, args.edlOutput)
          : join(mkdtempSync(join(tmpdir(), "gg-textcut-")), "cuts.edl");
        if (args.edlOutput) mkdirSync(dirname(outAbs), { recursive: true });
        writeFileSync(outAbs, edl, "utf8");

        const removedSec = +merged.reduce((s, c) => s + (c.endSec - c.startSec), 0).toFixed(3);
        return compact({
          path: outAbs,
          dryRun: args.dryRun ?? true,
          fps,
          totalSec,
          cuts: merged.length,
          keeps: keeps.length,
          removedSec,
          sample: merged.slice(0, 10).map((c) => ({
            startSec: +c.startSec.toFixed(2),
            endSec: +c.endSec.toFixed(2),
            reason: c.reason,
          })),
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
