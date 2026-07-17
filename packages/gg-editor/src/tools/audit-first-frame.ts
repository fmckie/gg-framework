import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { resolveApiKey } from "../core/auth/api-keys.js";
import { compact, err } from "../core/format.js";
import { extractAtTimes } from "../core/frames.js";
import { checkFfmpeg, probeMedia } from "../core/media/ffmpeg.js";

const AuditFirstFrameParams = z.object({
  input: z.string().describe("Source video (relative resolves to cwd)."),
  detail: z.enum(["low", "high"]).optional().describe("Vision detail. Default low."),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
});

const VISION_SYSTEM = `You score a SINGLE FRAME (the first frame of a YouTube video) AS IF it were the thumbnail at 100x56 mobile-feed scale. Autoplay shows this frame BEFORE audio loads — if it looks like a logo slate, a black hold, or a mid-blink face, the viewer scrolls.

Output a JSON object with these EXACT keys:
{
  "score":           <0..100 integer>,
  "hasFace":         <bool>,
  "faceProminent":   <bool>,         // face fills ≥ ~20% of frame area
  "hasReadableText": <bool>,         // any large legible text (hook line, label)
  "hasClearSubject": <bool>,         // a single obvious focal point
  "hasMotion":       <bool>,         // not strictly possible from one frame; mark true only when blur / streak / mid-action implies motion
  "mode":            "static-logo"|"cold-open-load"|"face-blink"|"usable"|"strong",
  "findings":        [<string>, ...] // 1-4 short findings (≤120 chars each)
}

Scoring rubric:
  85-100: STRONG — clear subject, expressive face, color contrast, readable text, no logo slate.
  60-84:  USABLE — subject present, decent contrast, no obvious blockers.
  30-59:  WEAK — abstract pattern, small subject, soft contrast, mid-blink, or pre-roll filler.
  0-29:   FAIL — black slate, plain logo card, glitch frame, mid-blink face, totally unreadable.

Modes:
  static-logo    = a logo card / channel branding slate
  cold-open-load = a near-black or solid-color frame (intro hasn't started)
  face-blink     = a face mid-blink / mid-word / awkward expression
  usable         = nothing wrong but nothing exceptional either
  strong         = thumbnail-ready opening frame

Be honest — this rubric exists so the creator knows when to recut their first frame.`;

interface FirstFrameVisionResponse {
  score: number;
  hasFace: boolean;
  faceProminent: boolean;
  hasReadableText: boolean;
  hasClearSubject: boolean;
  hasMotion: boolean;
  mode: "static-logo" | "cold-open-load" | "face-blink" | "usable" | "strong";
  findings: string[];
}

/**
 * audit_first_frame — score t=0.0s as if it were the thumbnail.
 *
 * Per Hoyos / Galloway: "treat the first frame like a thumbnail."
 * Autoplay surfaces the first frame BEFORE audio loads, so a logo slate
 * or cold-open hold tanks retention before viewers ever hear the hook.
 */
export function createAuditFirstFrameTool(cwd: string): AgentTool<typeof AuditFirstFrameParams> {
  return {
    name: "audit_first_frame",
    description:
      "Score the first frame of a video as if it were the thumbnail at 100×56 mobile-feed " +
      "scale. Per Galloway / Hoyos: 'treat your intro like a thumbnail' — autoplay shows the " +
      "first frame BEFORE audio loads, so logo slates and cold-open holds tank retention. " +
      "Penalises static-logo, cold-open-load, face-blink modes; rewards a clear subject + " +
      "expressive face + readable hook text. Pair with `audit_retention_structure` and " +
      "`analyze_hook` as the three short-form pre-render checks. Returns score 0-100 + " +
      "findings + mode.",
    parameters: AuditFirstFrameParams,
    async execute(args, ctx) {
      if (!checkFfmpeg()) return err("ffmpeg not on PATH", "install ffmpeg");
      const apiKey = resolveApiKey("OPENAI_API_KEY", "openai");
      if (!apiKey) return err("OPENAI_API_KEY not set", "export OPENAI_API_KEY=...");
      try {
        const inAbs = resolvePath(cwd, args.input);
        const probe = probeMedia(inAbs);
        if (!probe) return err(`probe failed for ${inAbs}`, "verify file exists and is media");

        const frames = await extractAtTimes(inAbs, [0], {
          maxWidth: 768,
          signal: ctx.signal,
        });
        if (frames.length === 0) {
          return err("could not extract first frame", "verify the input is a readable video");
        }

        const vision = await runFirstFrameVision(frames[0].path, {
          apiKey,
          model: args.model,
          detail: args.detail,
          signal: ctx.signal,
        });

        return compact({
          score: vision.score,
          mode: vision.mode,
          hasFace: vision.hasFace,
          faceProminent: vision.faceProminent,
          hasReadableText: vision.hasReadableText,
          hasClearSubject: vision.hasClearSubject,
          hasMotion: vision.hasMotion,
          findings: vision.findings,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

interface VisionOpts {
  apiKey: string;
  model?: string;
  detail?: "low" | "high";
  signal?: AbortSignal;
}

async function runFirstFrameVision(
  framePath: string,
  opts: VisionOpts,
): Promise<FirstFrameVisionResponse> {
  const b64 = readFileSync(framePath).toString("base64");
  const detail = opts.detail ?? "low";
  const model = opts.model ?? "gpt-4o-mini";

  const body = {
    model,
    messages: [
      { role: "system", content: VISION_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "FIRST FRAME (t=0):" },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${b64}`, detail },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 2000,
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
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("audit_first_frame: empty model response");
  return parseFirstFrameResponse(content);
}

/**
 * Parse the model's JSON response. Robust to missing keys / weird types
 * — never throws as long as the JSON itself is valid. Pure — exported
 * for testing.
 */
export function parseFirstFrameResponse(content: string): FirstFrameVisionResponse {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("audit_first_frame: no JSON object in response");
  }
  const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  const modeRaw = String(parsed.mode ?? "usable");
  const mode: FirstFrameVisionResponse["mode"] = (
    ["static-logo", "cold-open-load", "face-blink", "usable", "strong"].includes(modeRaw)
      ? modeRaw
      : "usable"
  ) as FirstFrameVisionResponse["mode"];
  const findings = Array.isArray(parsed.findings)
    ? (parsed.findings as unknown[])
        .map((v) => String(v ?? "").slice(0, 200))
        .filter((v) => v.length > 0)
        .slice(0, 8)
    : [];
  return {
    score: clampScore(parsed.score),
    hasFace: Boolean(parsed.hasFace),
    faceProminent: Boolean(parsed.faceProminent),
    hasReadableText: Boolean(parsed.hasReadableText),
    hasClearSubject: Boolean(parsed.hasClearSubject),
    hasMotion: Boolean(parsed.hasMotion),
    mode,
    findings,
  };
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
