import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { bundledSfxDescriptionList, listBundledSfxNames, resolveSfx } from "../core/bundled-sfx.js";
import { compact, err } from "../core/format.js";
import type { VideoHost } from "../core/hosts/types.js";
import { checkFfmpeg } from "../core/media/ffmpeg.js";

/**
 * add_sfx_to_timeline — drop SFX clips DIRECTLY onto the active timeline's
 * audio track at each cut point. Sibling of `add_sfx_at_cuts` but operates
 * on the live host (Resolve / Premiere) instead of producing a new mp4.
 *
 * Why this exists: `add_sfx_at_cuts` is file-only — it bakes SFX into a
 * rendered mp4. That's right for "ship the final file" workflows but wrong
 * when the user wants the SFX in the timeline so they can keep editing,
 * tune levels in Fairlight, or hear it on playback in Resolve.
 *
 * Mechanics:
 *   1. Resolve the SFX (bundled name → synthesise via ffmpeg / cache;
 *      file path → pass through).
 *   2. Get the timeline frame rate (needed to convert seconds → record frames).
 *   3. For each cut point: place the SFX wav at that record frame on the
 *      target audio track via `host.insertClipOnTrack(mediaKind="audio")`.
 *
 * Volume / ducking: the inserted clips land at unity gain. Use Fairlight
 * (Resolve) or Audio Mixer (Premiere) to adjust per-clip levels — Fairlight
 * isn't scriptable so we don't try.
 */

const AddSfxToTimelineParams = z.object({
  sfx: z
    .string()
    .describe(
      `SFX. Pass a bundled name (synthesised on demand at ~/.gg/sfx-cache/) OR a file path. ` +
        `Bundled names: ${listBundledSfxNames().join(", ")}.`,
    ),
  cutPoints: z
    .array(z.number().min(0))
    .min(1)
    .describe(
      "TIMELINE-space timestamps (seconds) where the SFX should fire. ⚠️ These must be " +
        "timeline-relative — NOT source-video timestamps from the transcript. After " +
        "`cut_filler_words` runs, use the `timelineCutPoints` field from its result; passing " +
        "source-space transcript timestamps causes the SFX to drift further out of sync after " +
        "every cut (fine for the first ~30 s, off by 20+ s by the end). Closer-than-" +
        "minSpacingSec hits are deduped.",
    ),
  track: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Target audio track (1-indexed). Default 3 — keeps A1 (dialogue) and A2 (music) free. " +
        "If the track doesn't exist, run add_track(kind='audio') first.",
    ),
  frameRate: z
    .number()
    .positive()
    .optional()
    .describe(
      "Override timeline frame rate. Auto-detected via get_timeline; pass when host_info " +
        "shows an unusual project fps and the agent has it cached.",
    ),
  minSpacingSec: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Min spacing between hits. Closer cuts are dropped (avoids 8 stacked whooshes on " +
        "machine-gun edits). Default 0.25 s.",
    ),
});

export function createAddSfxToTimelineTool(
  host: VideoHost,
  cwd: string,
): AgentTool<typeof AddSfxToTimelineParams> {
  return {
    name: "add_sfx_to_timeline",
    description:
      `Insert a SFX clip directly onto the active timeline's audio track at each cut point. ` +
      `LIVE host operation \u2014 unlike add_sfx_at_cuts which bakes SFX into a rendered mp4, ` +
      `this drops actual audio clips into Resolve/Premiere so the user hears them on ` +
      `playback and can tune levels in Fairlight. Bundled SFX (synthesised on demand): ` +
      `${bundledSfxDescriptionList()}. Defaults to track A3 (keeps A1 dialogue / A2 music free); ` +
      `pass track= to override. Pair with cut_filler_words / detect_silence cut-point lists.`,
    parameters: AddSfxToTimelineParams,
    async execute(args, ctx) {
      // ffmpeg only required if the user passed a bundled SFX name (we synthesise).
      // For a literal file path, no ffmpeg dep here \u2014 Resolve/Premiere handles import.
      try {
        // Resolve SFX to an absolute path (synthesise bundled name if cache miss).
        let sfxAbs: string;
        let sfxInfo: { bundled: boolean; name?: string };
        try {
          const r = await resolveSfx(args.sfx, cwd, ctx.signal);
          sfxAbs = r.path;
          sfxInfo = { bundled: r.bundled, name: r.name };
        } catch (e) {
          // Bundled-name failures often surface via ffmpeg synthesis errors;
          // surface ffmpeg presence in the fix hint when relevant.
          const msg = (e as Error).message;
          const hint =
            msg.includes("ffmpeg") || msg.includes("Bundled:")
              ? checkFfmpeg()
                ? "use a bundled SFX name or supply a real file path"
                : "ffmpeg not on PATH \u2014 install ffmpeg or use a literal file path"
              : "use a bundled SFX name or supply a real file path";
          return err(msg, hint);
        }

        // Determine timeline frame rate.
        let fps = args.frameRate;
        if (fps === undefined) {
          try {
            const tl = await host.getTimeline();
            fps = (tl as { frameRate?: number }).frameRate;
          } catch (e) {
            return err(
              `cannot read timeline framerate: ${(e as Error).message}`,
              "open Resolve/Premiere with an active timeline OR pass frameRate=...",
            );
          }
        }
        if (!fps || fps <= 0) {
          return err(
            "could not determine timeline frame rate",
            "pass frameRate=24/25/30/60 explicitly",
          );
        }

        // Sort + dedup cut points by minSpacingSec.
        const minSpacing = args.minSpacingSec ?? 0.25;
        const sortedCuts = [...args.cutPoints].sort((a, b) => a - b);
        const filtered: number[] = [];
        for (const c of sortedCuts) {
          if (c < 0) continue;
          if (filtered.length === 0 || c - filtered[filtered.length - 1] >= minSpacing) {
            filtered.push(c);
          }
        }
        if (filtered.length === 0) {
          return err("no usable cut points after filtering");
        }

        // Insert each SFX. Track failures per-cut so a single bad insertion
        // doesn't kill the whole batch.
        const track = args.track ?? 3;
        const inserted: Array<{ atSec: number; recordFrame: number; clipId: string }> = [];
        const failed: Array<{ atSec: number; error: string }> = [];

        for (const atSec of filtered) {
          if (ctx.signal?.aborted) {
            return err("aborted");
          }
          const recordFrame = Math.round(atSec * fps);
          try {
            const r = await host.insertClipOnTrack({
              mediaPath: sfxAbs,
              track,
              recordFrame,
              mediaKind: "audio",
            });
            inserted.push({ atSec: +atSec.toFixed(3), recordFrame, clipId: r.id });
          } catch (e) {
            failed.push({ atSec: +atSec.toFixed(3), error: (e as Error).message });
          }
        }

        if (inserted.length === 0) {
          // Surface the first error so the user sees what went wrong (likely
          // missing audio track \u2014 the agent should add_track('audio') first).
          const firstErr = failed[0]?.error ?? "no clips inserted";
          return err(
            `no SFX clips inserted on track A${track}: ${firstErr}`,
            `track A${track} may not exist \u2014 run add_track(kind='audio') first, or pick a lower track`,
          );
        }

        return compact({
          ok: true,
          inserted: inserted.length,
          failed: failed.length || undefined,
          track,
          fps,
          sfx: sfxInfo.bundled ? `bundled:${sfxInfo.name}` : sfxAbs,
          // Sample of inserted clips so the agent can quote what landed where.
          sample: inserted.slice(0, 5),
          // Per-failure detail for the agent to retry / diagnose.
          failures: failed.length ? failed.slice(0, 5) : undefined,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}
