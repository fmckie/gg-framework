import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { CODEX_CLIENT_VERSION } from "@kleio/ai";
import type { AgentTool, StructuredToolResult, ToolContext } from "@kleio/agent";
import { resolvePath } from "./path-utils.js";
import {
  IMAGE_MEDIA_TYPES,
  convertImageFormat,
  downscaleForPreview,
  shrinkToFit,
} from "../utils/image.js";

/**
 * Structural subset of AuthStorage the tool needs at execute time. Using a
 * structural type avoids importing the full class (and its gg-core dependency
 * chain) into the tool module — the caller satisfies this with its real
 * AuthStorage instance.
 */
export type GenerateImageAuth = {
  resolveCredentials(provider: string): Promise<{
    accessToken: string;
    accountId?: string;
  }>;
};

/**
 * Codex's own image endpoints, called the way the Codex CLI's image extension
 * calls them (openai/codex `ext/image-generation/src/tool.rs` +
 * `codex-api/src/endpoint/images.rs`, checked 2026-10-17 at 592964c0): a plain
 * JSON POST to `images/generations` or `images/edits` under the ChatGPT Codex
 * backend with `{ prompt, background, model, quality, size }` (edits add
 * `images: [{ image_url }]`), answered with `data[].b64_json` PNG. ChatGPT OAuth tokens (auth.openai.com PKCE)
 * are rejected by api.openai.com/v1/images/* (missing the
 * `api.model.images.request` scope), but they work here.
 *
 * This used to go through `codex/responses` with a chat model driving the
 * hosted `image_generation` tool. That broke twice over: the driving model
 * (`gpt-5.5`) was retired, and the current Codex models are code-mode only,
 * so they ignore the hosted tool and answer in text.
 */
const CODEX_IMAGES_BASE = "https://chatgpt.com/backend-api/codex/images";
/** The endpoint always answers in PNG; other formats are re-encoded locally. */
const RESPONSE_FORMAT = "png";
/**
 * Codex's `IMAGE_MODEL`. Codex sends this fixed id on every request; the
 * backend picks the generator, so there is no model choice to offer.
 */
const IMAGE_MODEL = "gpt-image-2";
/** Codex's `MAX_EDIT_IMAGES`: an edit takes one to five reference images. */
const MAX_EDIT_IMAGES = 5;

const GenerateImageParams = z.object({
  prompt: z.string().describe("Text description of the image to generate or the edit to apply"),
  image: z
    .string()
    .optional()
    .describe(
      "Path to an existing image file to edit (use the path returned by a previous " +
        "generate_image call, or a user-attached image path). When omitted, a new " +
        "image is generated from scratch. Use `images` instead for several references.",
    ),
  images: z
    .array(z.string())
    .min(1)
    .max(MAX_EDIT_IMAGES)
    .optional()
    .describe(
      `Up to ${MAX_EDIT_IMAGES} image paths to edit from or combine (for example a subject ` +
        "and a style reference). Do not pass both `image` and `images`.",
    ),
  size: z
    .string()
    .optional()
    .describe(
      "Output resolution: `auto` (default) or WIDTHxHEIGHT with both edges multiples of " +
        "16px, max edge 3840px, long:short ratio at most 3:1, and 655,360 to 8,294,400 " +
        "total pixels. Popular: 1024x1024, 1536x1024, 1024x1536, 2048x2048.",
    ),
  quality: z
    .enum(["low", "medium", "high", "auto"])
    .optional()
    .describe(
      "Rendering quality. Use 'low' for fast drafts, 'high' for final assets. Default: auto.",
    ),
  n: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("Number of images to generate (1–4, default 1)"),
  out_path: z
    .string()
    .optional()
    .describe(
      "Where to save the generated image (relative to cwd or absolute). " +
        "Defaults to .gg/generated/<timestamp>.png",
    ),
  output_format: z
    .enum(["png", "jpeg", "webp"])
    .optional()
    .describe("Output file format (default png)"),
  background: z
    .enum(["opaque", "transparent"])
    .optional()
    .describe(
      "Use 'transparent' when the request calls for a transparent background, including " +
        "background removal or a cutout (png or webp output). Default: opaque. For edits, " +
        "keep existing transparency unless the user asks to change it.",
    ),
});

type GenerateImageArgs = z.infer<typeof GenerateImageParams>;

function defaultOutPath(cwd: string, format: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = format === "png" ? "png" : format === "jpeg" ? "jpg" : "webp";
  return path.join(cwd, ".gg", "generated", `${stamp}.${ext}`);
}

/** Format → media type for StructuredToolResult. */
function mediaTypeFor(format: string): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

export function createGenerateImageTool(
  cwd: string,
  auth: GenerateImageAuth,
): AgentTool<typeof GenerateImageParams> {
  return {
    name: "generate_image",
    description:
      "Generate or edit images with OpenAI's image generation, the same service Codex uses " +
      "with a ChatGPT login. Works even when a different chat provider is active; only " +
      "requires OpenAI to be connected. Only use this tool when the user explicitly asks to " +
      "create, generate, or edit an image. Pass `image` (or up to five `images`) to edit " +
      "existing files, such as a previous result or a user attachment. Set `background` to " +
      "'transparent' for cutouts and transparent artwork. Generation can take a minute or " +
      "more. Use `out_path` to save to a specific location (defaults to .gg/generated/).",
    parameters: GenerateImageParams,
    async execute(
      args: GenerateImageArgs,
      context: ToolContext,
    ): Promise<string | StructuredToolResult> {
      if (context.signal.aborted) return "Image generation aborted before start.";
      // JPEG has no alpha channel: a transparent result saved as JPEG would
      // silently come back opaque, after spending the user's image quota.
      if (args.background === "transparent" && args.output_format === "jpeg") {
        return (
          "Transparent backgrounds need png or webp output; JPEG cannot store transparency. " +
          "No request was sent. Use output_format png or webp."
        );
      }
      if (args.image && args.images) {
        return "Pass either `image` or `images`, not both. No request was sent.";
      }

      // Resolve OpenAI credentials at execution time (lazy — token refresh
      // happens on use, not at registration).
      let token: string;
      let accountId: string | undefined;
      try {
        const creds = await auth.resolveCredentials("openai");
        token = creds.accessToken;
        accountId = creds.accountId;
      } catch {
        return (
          "OpenAI is not connected. The user needs to connect their OpenAI account " +
          "to use image generation."
        );
      }

      const outputFormat = args.output_format ?? "png";
      const mediaType = mediaTypeFor(outputFormat);
      const outPath = args.out_path
        ? resolvePath(cwd, args.out_path)
        : defaultOutPath(cwd, outputFormat);

      try {
        // Every field Codex sends, always: it pins quality and size to "auto"
        // and background to opaque unless transparency is asked for.
        const request: Record<string, unknown> = {
          prompt: args.prompt,
          background: args.background ?? "opaque",
          model: IMAGE_MODEL,
          quality: args.quality ?? "auto",
          size: args.size ?? "auto",
        };

        const referencePaths = args.images ?? (args.image ? [args.image] : []);
        if (referencePaths.length > 0) {
          // Edit mode: each reference travels inline as a data URL of the
          // original bytes, as Codex sends them (PromptImageMode::Original).
          const references: Array<{ image_url: string }> = [];
          for (const reference of referencePaths) {
            const imagePath = resolvePath(cwd, reference);
            const refMediaType = IMAGE_MEDIA_TYPES[path.extname(imagePath).toLowerCase()];
            if (!refMediaType) {
              return `Cannot edit ${reference}: only PNG, JPEG, GIF, WebP and BMP images are supported.`;
            }
            let fileBuffer: Buffer;
            try {
              fileBuffer = await readFile(imagePath);
            } catch {
              return `Could not read the image at ${reference}. Check the path is correct.`;
            }
            references.push({
              image_url: `data:${refMediaType};base64,${fileBuffer.toString("base64")}`,
            });
          }
          request.images = references;
        }
        const endpoint = `${CODEX_IMAGES_BASE}/${request.images ? "edits" : "generations"}`;
        // One id for the whole tool call, like Codex's per-turn
        // `x-codex-image-turn-id`, so every image of an `n` batch is grouped.
        const turnId = randomUUID();

        // One request per image, like the Codex CLI: each output is its own
        // generation, and a later failure keeps the earlier ones.
        const requestedCount = args.n ?? 1;
        const imageBuffers: Buffer[] = [];
        for (
          let index = 0;
          index < requestedCount && imageBuffers.length < requestedCount;
          index++
        ) {
          const generated = await callImageEndpoint(
            endpoint,
            request,
            { token, accountId, turnId },
            context.signal,
          );
          for (const png of generated.slice(0, requestedCount - imageBuffers.length)) {
            imageBuffers.push(
              outputFormat === RESPONSE_FORMAT ? png : await convertImageFormat(png, outputFormat),
            );
          }
          if (generated.length === 0) break;
        }

        if (imageBuffers.length === 0) {
          return "Image generation returned no results. The prompt may have been blocked by content moderation.";
        }

        // Save each image and build preview content.
        const savedPaths: string[] = [];

        for (let i = 0; i < imageBuffers.length; i++) {
          const buf = imageBuffers[i]!;
          const savePath = imageBuffers.length === 1 ? outPath : insertIndex(outPath, i);
          await mkdir(path.dirname(savePath), { recursive: true });
          await writeFile(savePath, buf);
          savedPaths.push(savePath);
        }

        // The primary image (first) gets the full treatment: model-visible
        // image + inline preview. Additional images are previewed only.
        const primary = imageBuffers[0]!;
        const primaryPath = savedPaths[0]!;

        // Shrink for the model (provider image limits) and a smaller copy for
        // the inline terminal/webview preview.
        const { buffer: shrunk, mediaType: detectedType } = await shrinkToFit(primary, mediaType);
        const previewBuffer = await downscaleForPreview(shrunk);

        const imagePreviews = [
          {
            base64: previewBuffer.toString("base64"),
            mediaType: detectedType,
            path: primaryPath,
          },
        ];

        // Include additional images as previews too.
        for (let i = 1; i < imageBuffers.length; i++) {
          const extraBuf = imageBuffers[i]!;
          const extraPath = savedPaths[i]!;
          const extraShrunk = await shrinkToFit(extraBuf, mediaType);
          const extraPreview = await downscaleForPreview(extraShrunk.buffer);
          imagePreviews.push({
            base64: extraPreview.toString("base64"),
            mediaType: extraShrunk.mediaType,
            path: extraPath,
          });
        }

        const summary =
          savedPaths.length === 1
            ? `Generated image → ${primaryPath}`
            : `Generated ${savedPaths.length} images → ${savedPaths.join(", ")}`;

        const allContent: StructuredToolResult["content"] = [
          { type: "text", text: summary },
          {
            type: "image",
            mediaType: detectedType,
            data: shrunk.toString("base64"),
          },
        ];

        return {
          content: allContent,
          details: { imagePreviews },
        };
      } catch (err) {
        if (context.signal.aborted) return "Image generation aborted.";
        if (err instanceof ImageAccessError) return imageAccessMessage(token);
        if (err instanceof ImageLimitError) return imageLimitMessage(err.resetsAt);
        const reason = err instanceof Error ? err.message : String(err);
        return `Image generation failed: ${reason}`;
      }
    },
  };
}

/** Insert a numeric index before the extension for multi-image output. */
function insertIndex(filePath: string, index: number): string {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}_${index}${ext}`;
}

/** OpenAI refused the image request outright (HTTP 403): the account has no access. */
class ImageAccessError extends Error {}

/** The account's image quota is used up (HTTP 429 `usage_limit_reached`). */
class ImageLimitError extends Error {
  constructor(
    message: string,
    /** Unix seconds when the limit resets, when OpenAI says. */
    readonly resetsAt: number | undefined,
  ) {
    super(message);
  }
}

/** What to tell the agent when the image quota is used up. */
function imageLimitMessage(resetsAt: number | undefined): string {
  const when =
    resetsAt !== undefined && Number.isFinite(resetsAt)
      ? ` It resets at ${new Date(resetsAt * 1000).toISOString()}.`
      : "";
  return (
    `This ChatGPT account has reached its image generation limit.${when} ` +
    "Tell the user; retrying before then will not help."
  );
}

/**
 * The ChatGPT plan from the access token's auth claim (`chatgpt_plan_type`), or
 * undefined when the token is not a readable JWT. Only the plan name is read;
 * nothing from the token is logged or returned.
 */
function chatgptPlan(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const auth = claims["https://api.openai.com/auth"];
    if (auth && typeof auth === "object" && "chatgpt_plan_type" in auth) {
      const plan = (auth as { chatgpt_plan_type?: unknown }).chatgpt_plan_type;
      return typeof plan === "string" ? plan : undefined;
    }
  } catch {
    // Not a JWT we can read; fall through to the generic message.
  }
  return undefined;
}

/**
 * What to tell the agent when OpenAI refuses image generation for the account.
 * A free ChatGPT plan gets a bare 403 "Forbidden" for every image request, so
 * say that plainly instead of passing the opaque status through.
 */
function imageAccessMessage(token: string): string {
  const lead =
    chatgptPlan(token) === "free"
      ? "Image generation is not included with a free ChatGPT plan, so OpenAI refused the request (403 Forbidden)."
      : "OpenAI refused the image request (403 Forbidden). This ChatGPT account does not appear to include image generation in Codex.";
  return (
    `${lead} It needs a ChatGPT login on a paid plan that includes Codex image generation. ` +
    "Tell the user; retrying, or changing size, quality or format, will not help."
  );
}

/**
 * POST one request to a Codex image endpoint and return the decoded images.
 * Headers carry the same Codex client identity as chat (originator, user agent
 * and `version`), since the ChatGPT backend gates features on that version.
 */
async function callImageEndpoint(
  url: string,
  request: Record<string, unknown>,
  auth: { token: string; accountId: string | undefined; turnId: string },
  signal: AbortSignal,
): Promise<Buffer[]> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
      originator: "codex_cli_rs",
      "User-Agent": `codex_cli_rs/${CODEX_CLIENT_VERSION} (${os.type()} ${os.release()}; ${os.arch()})`,
      version: CODEX_CLIENT_VERSION,
      "x-codex-image-turn-id": auth.turnId,
    },
    body: JSON.stringify(request),
    signal,
  });

  const text = await response.text();
  if (response.status === 403) throw new ImageAccessError(text);
  if (!response.ok) {
    let detail = text;
    let errorType: string | undefined;
    let resetsAt: number | undefined;
    try {
      const parsed = JSON.parse(text) as {
        detail?: string;
        error?: { message?: string; type?: string; resets_at?: number };
      };
      errorType = parsed.error?.type;
      resetsAt = typeof parsed.error?.resets_at === "number" ? parsed.error.resets_at : undefined;
      if (parsed.detail) detail = parsed.detail;
      else if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // Keep raw text
    }
    if (response.status === 429 && errorType === "usage_limit_reached") {
      throw new ImageLimitError(detail, resetsAt);
    }
    throw new Error(`OpenAI Image API (${response.status}): ${detail}`);
  }

  let parsed: { data?: Array<{ b64_json?: unknown }> };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error("OpenAI Image API returned a response that is not JSON.");
  }
  return (parsed.data ?? [])
    .map((item) => item.b64_json)
    .filter((b64): b64 is string => typeof b64 === "string" && b64.length > 0)
    .map((b64) => Buffer.from(b64, "base64"));
}
