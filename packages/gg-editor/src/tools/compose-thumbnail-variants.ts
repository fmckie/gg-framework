import { resolve as resolvePath, join } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { resolveApiKey } from "../core/auth/api-keys.js";
import { loadBrandKit } from "../core/brand-kit.js";
import { compact, err } from "../core/format.js";
import { extractAtInterval, type ExtractedFrame } from "../core/frames.js";
import { checkFfmpeg, probeMedia } from "../core/media/ffmpeg.js";
import { composeThumbnailFrame } from "../core/thumbnail-compose.js";
import { scoreFrames, type ShotScore } from "../core/vision.js";
import { pickBrandFont } from "./compose-thumbnail.js";

const ComposeThumbnailVariantsParams = z.object({
  input: z.string().describe("Source video (relative resolves to cwd)."),
  outputDir: z.string().describe("Directory for the variant images. Created if missing."),
  text: z.string().min(1).describe("Headline burned on each variant."),
  count: z.number().int().min(1).max(5).optional().describe("How many variants. Default 3."),
  intervalSec: z
    .number()
    .positive()
    .optional()
    .describe("Sampling interval. Default = totalSec/40 (≈40 candidates over the video)."),
  minSpacingSec: z
    .number()
    .min(0)
    .optional()
    .describe("Minimum seconds between picked variants. Default 10."),
  strategy: z
    .enum(["expression", "label", "mixed"])
    .optional()
    .describe(
      "Variant generation strategy. 'mixed' (default) = 3 distinct frames + same label. " +
        "'expression' = 3 best frames, all same label (vary expression only — face-driven " +
        "content). 'label' = ONE best frame + 3 LLM-generated label variations (use when the " +
        "source has only one usable face / product / screen).",
    ),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
  detail: z.enum(["low", "high"]).optional().describe("Vision detail. Default low."),
  fontFile: z.string().optional(),
  fontSize: z.number().int().positive().optional(),
  fontColor: z.string().optional(),
  outlineColor: z.string().optional(),
  position: z.enum(["top", "center", "bottom"]).optional(),
  width: z.number().int().positive().optional(),
});

interface VariantPick {
  frame: ExtractedFrame;
  score: ShotScore;
}

/**
 * compose_thumbnail_variants — generate N thumbnails for A/B testing.
 *
 * Samples frames at `intervalSec`, scores via vision rubric, picks the
 * top-N spaced ≥ minSpacingSec apart, burns the headline. YouTube
 * native A/B is now standard — variants beat single guesses.
 *
 * Strategies:
 *   - "mixed"      (default): 3 distinct frames, same label.
 *   - "expression": same as mixed — picked separately for face-driven
 *     content where the agent wants to emphasise expression variation.
 *   - "label":     ONE best frame, 3 LLM-generated label variations.
 *     Use when the source only has one usable visual.
 */
export function createComposeThumbnailVariantsTool(
  cwd: string,
): AgentTool<typeof ComposeThumbnailVariantsParams> {
  return {
    name: "compose_thumbnail_variants",
    description:
      "Generate N thumbnail variants for A/B testing. Samples frames across the video, scores " +
      "each via vision LLM, picks top-N distinct frames (≥minSpacingSec apart), burns the " +
      "headline. `strategy` controls what varies: 'expression' (default for face-driven " +
      "content) picks 3 frames with the SAME label; 'label' picks ONE frame + generates 3 " +
      "distinct labels via LLM (use when only one usable face / product / screen exists); " +
      "'mixed' = current behaviour (3 frames + same label). Output ordered best-first. " +
      "Auto-applies brand kit (fonts.heading, colors.primary). YouTube native A/B is now " +
      "standard — ship variants, not a single guess. Requires OPENAI_API_KEY + ffmpeg. Pair " +
      "with `generate_youtube_metadata` before publish.",
    parameters: ComposeThumbnailVariantsParams,
    async execute(args, ctx) {
      try {
        if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
        if (!process.env.OPENAI_API_KEY) {
          return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
        }
        const inAbs = resolvePath(cwd, args.input);
        const outDir = resolvePath(cwd, args.outputDir);
        const probe = probeMedia(inAbs);
        if (!probe) return err(`probe failed for ${inAbs}`, "verify file exists and is media");
        if (probe.durationSec <= 0) return err("source has zero duration");

        const count = Math.min(5, Math.max(1, args.count ?? 3));
        const minSpacing = Math.max(0, args.minSpacingSec ?? 10);
        const interval =
          args.intervalSec && args.intervalSec > 0
            ? args.intervalSec
            : Math.max(1, probe.durationSec / 40);
        const strategy = args.strategy ?? "mixed";

        // Brand-kit fallback: only fill in fontFile / outlineColor when the
        // caller didn't pass an explicit value.
        const brand = loadBrandKit(cwd);
        const brandFont = pickBrandFont(cwd, brand?.fonts?.heading);
        const fontFile = args.fontFile ?? brandFont;
        const outlineColor = args.outlineColor ?? brand?.colors?.primary;
        const brandKitLoaded = brand !== null;

        // Sample frames across the whole video.
        const frames = await extractAtInterval(inAbs, interval, probe.durationSec, {
          maxWidth: 1280,
          signal: ctx.signal,
        });
        if (frames.length === 0) return err("no frames extracted", "lower intervalSec");

        // Score each frame.
        const scores = await scoreFrames(frames, {
          model: args.model,
          detail: args.detail,
          signal: ctx.signal,
        });

        // Pair scores with their source frames + pick top-N respecting
        // minSpacingSec.
        const paired: VariantPick[] = scores.map((s, i) => ({ frame: frames[i], score: s }));

        // ── label strategy: 1 frame, 3 LLM-generated labels ────────────
        if (strategy === "label") {
          const top = paired.sort((a, b) => b.score.score - a.score.score)[0];
          if (!top) return err("no variants survived spacing constraint", "lower minSpacingSec");
          const labels = await generateLabelVariations(args.text, count, {
            model: args.model,
            signal: ctx.signal,
          });
          const variants: Array<{
            path: string;
            atSec: number;
            score: number;
            why: string;
            label: string;
          }> = [];
          for (let i = 0; i < labels.length; i++) {
            const outPath = join(outDir, `variant-${i + 1}.jpg`);
            await composeThumbnailFrame(
              {
                input: inAbs,
                output: outPath,
                atSec: top.frame.atSec,
                text: labels[i],
                fontFile,
                fontSize: args.fontSize,
                fontColor: args.fontColor,
                outlineColor,
                position: args.position,
                width: args.width,
                signal: ctx.signal,
              },
              cwd,
            );
            variants.push({
              path: outPath,
              atSec: +top.frame.atSec.toFixed(2),
              score: top.score.score,
              why: top.score.why,
              label: labels[i],
            });
          }
          return compact({
            variants,
            count: variants.length,
            totalScored: paired.length,
            strategy,
            brandKitLoaded,
          });
        }

        // ── mixed / expression strategies: N frames, same label ────────
        const picks = pickTopSpaced(paired, count, minSpacing);
        if (picks.length === 0) {
          return err("no variants survived spacing constraint", "lower minSpacingSec");
        }

        // Burn the headline on each pick.
        const variants: Array<{ path: string; atSec: number; score: number; why: string }> = [];
        for (let i = 0; i < picks.length; i++) {
          const p = picks[i];
          const outPath = join(outDir, `variant-${i + 1}.jpg`);
          await composeThumbnailFrame(
            {
              input: inAbs,
              output: outPath,
              atSec: p.frame.atSec,
              text: args.text,
              fontFile,
              fontSize: args.fontSize,
              fontColor: args.fontColor,
              outlineColor,
              position: args.position,
              width: args.width,
              signal: ctx.signal,
            },
            cwd,
          );
          variants.push({
            path: outPath,
            atSec: +p.frame.atSec.toFixed(2),
            score: p.score.score,
            why: p.score.why,
          });
        }

        return compact({
          variants,
          count: variants.length,
          totalScored: paired.length,
          strategy,
          brandKitLoaded,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Greedy top-N selection with minimum spacing. Sort by score desc, walk
 * the list, accept a candidate only if it's ≥ minSpacingSec away from
 * every already-accepted pick. Stable — ties preserve input order.
 *
 * Pure — exported for testing.
 */
export function pickTopSpaced(
  paired: VariantPick[],
  count: number,
  minSpacingSec: number,
): VariantPick[] {
  const sorted = [...paired].sort((a, b) => {
    if (b.score.score !== a.score.score) return b.score.score - a.score.score;
    return a.frame.atSec - b.frame.atSec;
  });
  const kept: VariantPick[] = [];
  for (const p of sorted) {
    if (kept.length >= count) break;
    const tooClose = kept.some((k) => Math.abs(k.frame.atSec - p.frame.atSec) < minSpacingSec);
    if (tooClose) continue;
    kept.push(p);
  }
  return kept;
}

const LABEL_SYSTEM = `You distill a YouTube headline into thumbnail labels. Given an input headline, output exactly N distinct 2-4-word labels. Each label should attack the same headline from a DIFFERENT angle (e.g. one curiosity-driven, one outcome-driven, one number-driven). Labels render large on a 100x56 mobile-feed thumbnail — no punctuation, no quotes, ALL CAPS preferred when it fits.

Output JSON with this EXACT shape:
{ "labels": ["...", "...", "..."] }

No prose, no extra keys.`;

/**
 * Ask the LLM for N label variations. Pure-ish (network call) — exported
 * for testing under a mocked fetch.
 */
export async function generateLabelVariations(
  headline: string,
  n: number,
  opts: { apiKey?: string; model?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
  const apiKey = opts.apiKey ?? resolveApiKey("OPENAI_API_KEY", "openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY required for compose_thumbnail_variants.");
  const model = opts.model ?? "gpt-4o-mini";

  const body = {
    model,
    messages: [
      { role: "system", content: LABEL_SYSTEM },
      { role: "user", content: `HEADLINE:\n${headline}\n\nN: ${n}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("compose_thumbnail_variants: empty model response");
  const parsed = JSON.parse(content) as { labels?: unknown };
  const arr = Array.isArray(parsed.labels) ? parsed.labels : [];
  const labels: string[] = arr
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 0)
    .slice(0, n);
  // Pad with the headline itself if the model under-delivers, so caller
  // always gets N entries.
  while (labels.length < n) labels.push(headline);
  return labels;
}
