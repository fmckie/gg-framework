import { mkdirSync } from "node:fs";
import { basename, extname, join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfmpeg, probeMedia, runFfmpeg } from "../core/media/ffmpeg.js";
import type { FfmpegResult, MediaProbe } from "../core/media/ffmpeg.js";
import {
  buildRenderFilter,
  MULTI_FORMATS,
  multiFormatSpec,
  type MultiFormat,
} from "../core/multi-format.js";
import { safeOutputPath } from "../core/safe-paths.js";

const FormatEnum = z.enum([
  "youtube-1080p",
  "shorts-9x16",
  "reels-9x16",
  "tiktok-9x16",
  "square-1x1",
  "instagram-4x5",
  "twitter-16x9",
]);

const RenderMultiFormatParams = z.object({
  input: z.string().describe("Source video file. Resolved relative to cwd."),
  outputDir: z
    .string()
    .describe(
      "Directory where renders are written; created if missing. Each output is named " +
        "`<input-basename>.<preset>.mp4`.",
    ),
  formats: z
    .array(FormatEnum)
    .min(1)
    .describe(
      "Platform presets to render. Pick any subset of: youtube-1080p (1920x1080, scale+pad), " +
        "shorts-9x16 / reels-9x16 / tiktok-9x16 (1080x1920, centre-crop), square-1x1 (1080x1080), " +
        "instagram-4x5 (1080x1350), twitter-16x9 (1280x720). Aliases (reels/tiktok/shorts) are " +
        "kept distinct so output filenames match the platform you're shipping to.",
    ),
  videoCodec: z
    .string()
    .optional()
    .describe("Output video codec. Default 'libx264'. Use 'libx265' for HEVC delivery."),
  crf: z
    .number()
    .int()
    .min(0)
    .max(51)
    .optional()
    .describe(
      "x264/x265 quality (lower=better). Default 20. 18=visually lossless, 23=broadcast default.",
    ),
  audioBitrate: z
    .string()
    .optional()
    .describe("AAC bitrate, e.g. '192k' (default), '128k', '256k'."),
  parallel: z
    .boolean()
    .optional()
    .describe(
      "If true (default), run up to 3 ffmpeg processes concurrently. Disable on " +
        "underpowered hosts where ffmpeg saturates a single core's worth of throughput anyway.",
    ),
  faceTracked: z
    .boolean()
    .optional()
    .describe(
      "Set true ONLY when the input was already cropped to the target aspect (e.g. by " +
        "face_reframe or Resolve smart_reframe). Disables this tool's dumb centre-crop and " +
        "uses scale+pad instead, preserving the upstream framing.",
    ),
});

/**
 * Internal factory — exposed for tests so they can inject mock ffmpeg
 * runners without touching the global module. Production code should use
 * `createRenderMultiFormatTool(cwd)` which wires the real implementations.
 */
export interface RenderMultiFormatDeps {
  runFfmpeg: typeof runFfmpeg;
  probeMedia: typeof probeMedia;
  checkFfmpeg: typeof checkFfmpeg;
}

const MAX_PARALLEL = 3;

export function createRenderMultiFormatTool(
  cwd: string,
  deps?: Partial<RenderMultiFormatDeps>,
): AgentTool<typeof RenderMultiFormatParams> {
  const ff: RenderMultiFormatDeps = {
    runFfmpeg: deps?.runFfmpeg ?? runFfmpeg,
    probeMedia: deps?.probeMedia ?? probeMedia,
    checkFfmpeg: deps?.checkFfmpeg ?? checkFfmpeg,
  };

  return {
    name: "render_multi_format",
    description:
      "Render one source video into multiple platform aspects (YouTube 16:9, " +
      "Shorts/Reels/TikTok 9:16, Instagram 4:5, square 1:1, Twitter) in one call. " +
      "Each output is a separate file in `outputDir`. Vertical formats use a centre-crop " +
      "by default — pass `faceTracked=true` after running `face_reframe` or `smart_reframe` " +
      "to disable the dumb crop. The 'render every platform at once' button every creator " +
      "wishes their NLE had.",
    parameters: RenderMultiFormatParams,
    async execute(args, ctx) {
      if (!ff.checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      try {
        const inAbs = resolvePath(cwd, args.input);
        // outputDir is a write target; gate it through safeOutputPath so the
        // agent can't escape the allowed roots (cwd, tempdir, ~/Documents).
        const outDirAbs = safeOutputPath(cwd, args.outputDir);
        mkdirSync(outDirAbs, { recursive: true });

        const probe: MediaProbe | null = ff.probeMedia(inAbs);
        if (!probe) {
          return err(
            `probe failed for ${inAbs}`,
            "verify the input file exists and is a valid media file",
          );
        }
        if (!probe.width || !probe.height) {
          return err(
            "input has no video stream dimensions",
            "input must be a video file with a decodable video stream",
          );
        }

        // Dedupe formats while preserving caller-specified order (alias
        // outputs to distinct files but skip duplicate work if caller
        // accidentally passes the same key twice).
        const seen = new Set<MultiFormat>();
        const formats: MultiFormat[] = [];
        for (const f of args.formats) {
          if (!seen.has(f)) {
            seen.add(f);
            formats.push(f);
          }
        }

        const codec = args.videoCodec ?? "libx264";
        const crf = args.crf ?? 20;
        const audioBitrate = args.audioBitrate ?? "192k";
        const parallel = args.parallel ?? true;
        const faceTracked = args.faceTracked ?? false;

        const baseName = basename(inAbs, extname(inAbs));
        const tasks = formats.map((format) => {
          const spec = multiFormatSpec(format);
          const filter = buildRenderFilter(probe.width!, probe.height!, format, { faceTracked });
          const outPath = join(outDirAbs, `${baseName}.${format}.mp4`);
          return { format, spec, filter, outPath };
        });

        const start = Date.now();

        const runOne = async (task: (typeof tasks)[number]) => {
          const t0 = Date.now();
          const ffArgs = [
            "-i",
            inAbs,
            "-vf",
            task.filter.vf,
            "-c:v",
            codec,
            "-crf",
            String(crf),
            "-preset",
            "medium",
            "-c:a",
            "aac",
            "-b:a",
            audioBitrate,
            task.outPath,
          ];
          let result: FfmpegResult;
          try {
            result = await ff.runFfmpeg(ffArgs, { signal: ctx.signal });
          } catch (e) {
            return {
              format: task.format,
              path: task.outPath,
              ok: false as const,
              error: (e as Error).message,
              ms: Date.now() - t0,
            };
          }
          if (result.code !== 0) {
            return {
              format: task.format,
              path: task.outPath,
              ok: false as const,
              error: `ffmpeg exited ${result.code}`,
              ms: Date.now() - t0,
            };
          }
          return {
            format: task.format,
            path: task.outPath,
            widthxheight: `${task.filter.targetW}x${task.filter.targetH}`,
            transform: task.filter.transform,
            ok: true as const,
            ms: Date.now() - t0,
          };
        };

        type Outcome = Awaited<ReturnType<typeof runOne>>;
        const outputs: Outcome[] = [];
        if (parallel) {
          // Cap concurrency at MAX_PARALLEL — ffmpeg is heavy enough that
          // unbounded fan-out tanks throughput on the average creator laptop.
          for (let i = 0; i < tasks.length; i += MAX_PARALLEL) {
            if (ctx.signal.aborted) break;
            const chunk = tasks.slice(i, i + MAX_PARALLEL);
            const results = await Promise.all(chunk.map(runOne));
            outputs.push(...results);
          }
        } else {
          for (const task of tasks) {
            if (ctx.signal.aborted) break;
            outputs.push(await runOne(task));
          }
        }

        const totalMs = Date.now() - start;
        const okCount = outputs.filter((o) => o.ok).length;
        if (outputs.length > 0 && okCount === 0) {
          return err(
            "all renders failed",
            "see outputs[].error for per-format reasons; common causes: bad codec, write-permission, signal aborted",
          );
        }

        const warning = faceTracked
          ? "faceTracked=true — assuming source is pre-reframed via face_reframe or smart_reframe"
          : undefined;

        return compact({
          count: outputs.length,
          outputs,
          totalMs,
          warning,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

// Re-export so `index.ts` can list registered formats if it wants to surface
// them in tool docs without reaching into core/.
export { MULTI_FORMATS };
