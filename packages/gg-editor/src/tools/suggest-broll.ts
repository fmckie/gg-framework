import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { resolveApiKey } from "../core/auth/api-keys.js";
import { compact, err } from "../core/format.js";
import { safeOutputPath } from "../core/safe-paths.js";
import { parseTranscript } from "../core/whisper.js";
import type { Transcript, TranscriptSegment } from "../core/whisper.js";

/**
 * suggest_broll — extract visually-searchable concepts from a transcript
 * window via ONE LLM call, then query Pexels' free stock-video library
 * and (optionally) download the top match per concept. The output shape
 * is shaped to feed `insert_broll` directly:
 *
 *   for (const it of items) {
 *     await insert_broll({
 *       mediaPath: it.mediaPath,
 *       recordFrame: Math.round(it.atSec * fps),
 *     });
 *   }
 */

const SuggestBrollParams = z.object({
  transcript: z
    .string()
    .describe(
      "Path to a transcript JSON written by `transcribe`. Word-level timings not required — " +
        "segment-level start/end is enough to place each B-roll suggestion.",
    ),
  startSec: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Window start (seconds). Default 0. The LLM only sees text inside [startSec, endSec).",
    ),
  endSec: z
    .number()
    .min(0)
    .optional()
    .describe("Window end (seconds). Default = transcript.durationSec."),
  topN: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Maximum B-roll suggestions to return. Default 5. Hard cap 20 — more than that bloats " +
        "downloads and Pexels' free tier.",
    ),
  orientation: z
    .enum(["landscape", "portrait", "square"])
    .optional()
    .describe(
      "Pexels orientation filter. Default 'landscape'. Use 'portrait' for Shorts/Reels/TikTok.",
    ),
  minDurationSec: z
    .number()
    .min(1)
    .optional()
    .describe(
      "Discard Pexels clips shorter than this (seconds). Default 5. Stops the tool from picking " +
        "tiny stings that won't cover even one filler-cut.",
    ),
  outDir: z
    .string()
    .optional()
    .describe(
      "Directory to download chosen videos into (relative resolves to cwd). Default '.gg/broll-cache'. " +
        "Ignored when download=false.",
    ),
  model: z
    .string()
    .optional()
    .describe("OpenAI chat model used for the noun-phrase extraction step. Default 'gpt-4o-mini'."),
  download: z
    .boolean()
    .optional()
    .describe(
      "When true (default), fetch each chosen video file to outDir and return its local path. " +
        "When false, return only the Pexels CDN URL — useful for previewing before committing bandwidth.",
    ),
});

interface PexelsVideoFile {
  link: string;
  quality: string; // "hd" | "sd" | "uhd" | …
  width: number;
  height: number;
  file_type: string; // "video/mp4" | "video/webm" | …
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number; // seconds
  url: string;
  user: { name: string };
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

interface LlmQuery {
  atSec: number;
  query: string;
  why: string;
}

const LLM_SYSTEM = `You extract visually-searchable B-roll concepts from a video transcript.

Return JSON: {"queries":[{"atSec": number, "query": string, "why": string}, ...]}

Each query must be 2-4 words describing a CONCRETE visual that stock-footage libraries actually have:
  GOOD: "coffee shop morning", "highway sunset driving", "woman typing laptop", "city skyline timelapse".
  BAD : "the importance of focus", "feeling productive", "thinking about life".
Avoid abstract concepts, emotions, and named people/brands.

\`atSec\` is the timeline second nearest where the concept is mentioned in the transcript.
\`why\` is a ≤80-char rationale ("speaker mentions morning routine").

Return up to N queries, ordered by importance (most cover-worthy first).`;

export function createSuggestBrollTool(cwd: string): AgentTool<typeof SuggestBrollParams> {
  return {
    name: "suggest_broll",
    description:
      "Find B-roll for a transcript window: extracts visual concepts from the transcript via ONE " +
      "LLM call, queries Pexels' free video library, downloads the top match per concept. REQUIRES " +
      "PEXELS_API_KEY (free at pexels.com/api) and OPENAI_API_KEY (for the extraction step). " +
      "Returns {count, items: [{atSec, mediaPath, query, durationSec, sourceUrl, photographer, ...}]} " +
      "ready to feed `insert_broll(mediaPath, recordFrame=atSec*fps)`. The biggest creator multiplier — " +
      "turns 'cover up these ums' into one tool call.",
    parameters: SuggestBrollParams,
    async execute(args, ctx) {
      try {
        const pexelsKey = resolveApiKey("PEXELS_API_KEY", "pexels");
        if (!pexelsKey) {
          return err(
            "PEXELS_API_KEY not set",
            "free at https://www.pexels.com/api/ — set env or run ggeditor with the key in ~/.gg/api-keys.json",
          );
        }
        const openaiKey = resolveApiKey("OPENAI_API_KEY", "openai");
        if (!openaiKey) {
          return err(
            "OPENAI_API_KEY not set",
            "needed for the noun-phrase extraction step — set env or store via the onboarding flow",
          );
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

        let transcript: Transcript;
        try {
          transcript = parseTranscript(raw);
        } catch (e) {
          return err((e as Error).message, "regenerate via transcribe()");
        }

        const startSec = args.startSec ?? 0;
        const endSec = args.endSec ?? transcript.durationSec ?? Infinity;
        if (endSec <= startSec) {
          return err(
            `empty window: endSec (${endSec}) <= startSec (${startSec})`,
            "widen the [startSec, endSec) interval",
          );
        }
        const topN = args.topN ?? 5;
        const orientation = args.orientation ?? "landscape";
        const minDurationSec = args.minDurationSec ?? 5;
        const model = args.model ?? "gpt-4o-mini";
        const download = args.download ?? true;

        const windowText = buildWindowText(transcript.segments, startSec, endSec, 6000);
        if (windowText.trim().length === 0) {
          return err(
            "no transcript text in window",
            "widen [startSec, endSec) or check the transcript",
          );
        }

        // ── 1. LLM extraction ───────────────────────────────────
        let queries: LlmQuery[];
        try {
          queries = await runQueryExtraction({
            apiKey: openaiKey,
            model,
            text: windowText,
            n: topN,
            startSec,
            endSec,
            signal: ctx?.signal,
          });
        } catch (e) {
          return err(`LLM extraction failed: ${(e as Error).message}`);
        }
        if (queries.length === 0) {
          return err(
            "LLM returned zero queries",
            "the window may be too short or too abstract — widen it or try a different model",
          );
        }

        // ── 2. Resolve outDir (only if downloading) ─────────────
        let outDirAbs: string | undefined;
        if (download) {
          outDirAbs = args.outDir
            ? safeOutputPath(cwd, args.outDir)
            : safeOutputPath(cwd, join(".gg", "broll-cache"));
          mkdirSync(outDirAbs, { recursive: true });
        }

        // ── 3. Pexels per query ─────────────────────────────────
        const items: Array<{
          atSec: number;
          durationSec: number;
          mediaPath?: string;
          query: string;
          why: string;
          sourceUrl: string;
          photographer: string;
          pexelsId: number;
        }> = [];
        const skipped: Array<{ query: string; reason: string }> = [];

        for (const q of queries.slice(0, topN)) {
          try {
            const search = await searchPexels({
              apiKey: pexelsKey,
              query: q.query,
              orientation,
              perPage: 3,
              signal: ctx?.signal,
            });
            const candidate = pickFirstAcceptable(search.videos, minDurationSec);
            if (!candidate) {
              skipped.push({ query: q.query, reason: "no Pexels match" });
              continue;
            }
            const file = pickBestFile(candidate.video.video_files);
            if (!file) {
              skipped.push({ query: q.query, reason: "no playable video_file" });
              continue;
            }

            let mediaPath: string | undefined;
            if (download && outDirAbs) {
              try {
                mediaPath = await downloadVideo({
                  url: file.link,
                  fileType: file.file_type,
                  pexelsId: candidate.video.id,
                  outDir: outDirAbs,
                  signal: ctx?.signal,
                });
              } catch (e) {
                skipped.push({
                  query: q.query,
                  reason: `download failed: ${(e as Error).message}`,
                });
                continue;
              }
            }

            items.push({
              atSec: clampSec(q.atSec, startSec, endSec),
              durationSec: candidate.video.duration,
              mediaPath,
              query: q.query,
              why: q.why,
              sourceUrl: candidate.video.url,
              photographer: candidate.video.user?.name ?? "unknown",
              pexelsId: candidate.video.id,
            });
          } catch (e) {
            // Per-query Pexels failures: surface 401 / 429 with actionable
            // fixes; everything else lands in skipped[] so partial success
            // is still useful.
            const msg = (e as Error).message;
            if (msg.startsWith("PEXELS_401")) {
              return err("Pexels 401 unauthorized", "verify PEXELS_API_KEY");
            }
            if (msg.startsWith("PEXELS_429")) {
              return err("Pexels rate-limited", "wait ~1h or upgrade plan");
            }
            skipped.push({ query: q.query, reason: msg.slice(0, 200) });
          }
        }

        return compact({
          count: items.length,
          items,
          skipped: skipped.length > 0 ? skipped : undefined,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────

function buildWindowText(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
  maxChars: number,
): string {
  const parts: string[] = [];
  let total = 0;
  for (const s of segments) {
    if (s.end <= startSec) continue;
    if (s.start >= endSec) break;
    const stamped = `[${s.start.toFixed(1)}s] ${s.text.trim()}`;
    if (total + stamped.length + 1 > maxChars) break;
    parts.push(stamped);
    total += stamped.length + 1;
  }
  return parts.join("\n");
}

function clampSec(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v >= hi) return Math.max(lo, hi - 0.001);
  return +v.toFixed(2);
}

interface ExtractOpts {
  apiKey: string;
  model: string;
  text: string;
  n: number;
  startSec: number;
  endSec: number;
  signal?: AbortSignal;
}

async function runQueryExtraction(opts: ExtractOpts): Promise<LlmQuery[]> {
  const userMsg =
    `Window: [${opts.startSec.toFixed(1)}s, ${opts.endSec.toFixed(1)}s). Return up to ${opts.n} queries.\n\n` +
    `TRANSCRIPT:\n${opts.text}`;

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: LLM_SYSTEM },
      { role: "user", content: userMsg },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
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
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty model response");

  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in response");
  const parsed = JSON.parse(content.slice(start, end + 1)) as { queries?: unknown };
  if (!Array.isArray(parsed.queries)) throw new Error("response missing queries[]");

  const out: LlmQuery[] = [];
  for (const raw of parsed.queries) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const query = String(r.query ?? "").trim();
    if (!query) continue;
    const atSecRaw = Number(r.atSec);
    const atSec = Number.isFinite(atSecRaw) ? atSecRaw : opts.startSec;
    const why = String(r.why ?? "").slice(0, 200);
    out.push({ atSec, query, why });
  }
  return out;
}

interface SearchOpts {
  apiKey: string;
  query: string;
  orientation: "landscape" | "portrait" | "square";
  perPage: number;
  signal?: AbortSignal;
}

async function searchPexels(opts: SearchOpts): Promise<PexelsSearchResponse> {
  const url =
    `https://api.pexels.com/videos/search` +
    `?query=${encodeURIComponent(opts.query)}` +
    `&per_page=${opts.perPage}` +
    `&orientation=${opts.orientation}`;
  const res = await fetch(url, {
    headers: { Authorization: opts.apiKey },
    signal: opts.signal,
  });
  if (res.status === 401) throw new Error("PEXELS_401");
  if (res.status === 429) throw new Error("PEXELS_429");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Pexels HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as PexelsSearchResponse;
}

function pickFirstAcceptable(
  videos: PexelsVideo[] | undefined,
  minDurationSec: number,
): { video: PexelsVideo } | undefined {
  if (!Array.isArray(videos)) return undefined;
  for (const v of videos) {
    if ((v.duration ?? 0) >= minDurationSec) return { video: v };
  }
  return undefined;
}

/**
 * Pick the best `video_files` entry: prefer mp4, prefer hd over sd, avoid
 * uhd (multi-GB downloads on free tier are not creator-friendly).
 */
function pickBestFile(files: PexelsVideoFile[] | undefined): PexelsVideoFile | undefined {
  if (!Array.isArray(files) || files.length === 0) return undefined;
  const mp4 = files.filter((f) => f.file_type === "video/mp4");
  const pool = mp4.length > 0 ? mp4 : files;
  return pool.find((f) => f.quality === "hd") ?? pool.find((f) => f.quality === "sd") ?? pool[0];
}

interface DownloadOpts {
  url: string;
  fileType: string;
  pexelsId: number;
  outDir: string;
  signal?: AbortSignal;
}

async function downloadVideo(opts: DownloadOpts): Promise<string> {
  const res = await fetch(opts.url, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = opts.fileType.endsWith("/webm") ? "webm" : "mp4";
  const out = join(opts.outDir, `pexels-${opts.pexelsId}.${ext}`);
  writeFileSync(out, buf);
  return out;
}

// Re-export for tests that want to seed a tempdir without poking the cwd.
export function _tempBrollDir(): string {
  return mkdtempSync(join(tmpdir(), "gg-broll-"));
}
