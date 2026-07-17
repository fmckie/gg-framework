import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { loadBrandKit } from "../core/brand-kit.js";
import { compact, err } from "../core/format.js";
import { generateMetadata } from "../core/youtube-metadata.js";
import { parseTranscript } from "../core/whisper.js";
import type { Transcript } from "../core/whisper.js";

const GenerateYouTubeMetadataParams = z.object({
  transcript: z
    .string()
    .describe("Path to a transcript JSON written by `transcribe`. Segments required."),
  channelStyle: z
    .string()
    .optional()
    .describe(
      "One-paragraph description of the channel's voice (e.g. 'sharp tech opinion, 1st-person, " +
        "no fluff'). Helps the LLM match tone in titles + description.",
    ),
  videoTopic: z
    .string()
    .optional()
    .describe("Optional human hint, e.g. 'this is part 2 of the GPU shortage series'."),
  model: z.string().optional().describe("OpenAI model. Default gpt-4o-mini."),
});

export function createGenerateYouTubeMetadataTool(
  cwd: string,
): AgentTool<typeof GenerateYouTubeMetadataParams> {
  return {
    name: "generate_youtube_metadata",
    description:
      "Generate complete YouTube metadata from a transcript: 3 candidate titles (hook-driven, " +
      "≤70 chars), description with timestamps, 15 tags, chapter markers from real topic " +
      "shifts (5-15, first at 00:00, ≥30s apart), and 3-5 hashtags. ONE LLM call. ALWAYS run " +
      "before declaring a YouTube long-form done — uploads without metadata don't rank. " +
      "Requires `transcribe` first.",
    parameters: GenerateYouTubeMetadataParams,
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

        // Brand-kit fallback: when channelStyle isn't passed, build a minimal
        // "<Channel> (channel)" hint plus the subscribeUrl so the LLM has
        // some channel context to lean on.
        const brand = loadBrandKit(cwd);
        const brandStyle = buildChannelStyleFromBrand(brand);
        const channelStyle = args.channelStyle ?? brandStyle;
        const brandKitLoaded = brand !== null;

        const m = await generateMetadata(t, {
          model: args.model,
          channelStyle,
          videoTopic: args.videoTopic,
          signal: ctx.signal,
        });

        return compact({
          titles: m.titles,
          description: m.description,
          tags: m.tags,
          chapters: m.chapters.map((c) => ({ atSec: +c.atSec.toFixed(2), title: c.title })),
          hashtags: m.hashtags,
          brandKitLoaded,
        });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  };
}

/**
 * Build a channel-style hint from the brand kit when the caller didn't
 * pass `channelStyle` explicitly. Returns undefined when the kit is
 * missing the bare minimum (no channelName) so the LLM falls back to
 * inferring tone purely from the transcript.
 *
 * Pure — exported for testing.
 */
export function buildChannelStyleFromBrand(
  brand: { channelName?: string; subscribeUrl?: string } | null,
): string | undefined {
  if (!brand) return undefined;
  const name = brand.channelName?.trim();
  if (!name) return undefined;
  const parts = [`${name} (channel)`];
  if (brand.subscribeUrl?.trim()) {
    parts.push(`Subscribe link: ${brand.subscribeUrl.trim()}`);
  }
  return parts.join(" — ");
}
