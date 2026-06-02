import { writeFileSync } from "node:fs";
import type { TextContent, ImageContent, VideoContent } from "@kenkaiiii/gg-ai";
import type { ImageAttachment } from "../utils/image.js";
import { VIDEO_MEDIA_TYPES } from "../utils/image.js";
import { PROMPT_COMMANDS } from "../core/prompt-commands.js";
import type { CustomCommand } from "../core/custom-commands.js";

export function routePromptCommandInput(
  input: string,
  promptCommands = PROMPT_COMMANDS,
  customCommands: Pick<CustomCommand, "name" | "prompt">[] = [],
): { cmdName: string; cmdArgs: string; promptText: string; fullPrompt: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(" ");
  const cmdName = parts[0];
  const cmdArgs = parts.slice(1).join(" ").trim();
  const builtinCmd = promptCommands.find((c) => c.name === cmdName || c.aliases.includes(cmdName));
  const customCmd = !builtinCmd ? customCommands.find((c) => c.name === cmdName) : undefined;
  const promptText = builtinCmd?.prompt ?? customCmd?.prompt;
  if (!promptText) return null;
  return {
    cmdName,
    cmdArgs,
    promptText,
    fullPrompt: cmdArgs ? `${promptText}\n\n## User Instructions\n\n${cmdArgs}` : promptText,
  };
}

export function buildUserContentWithAttachments(
  text: string,
  inputImages: ImageAttachment[],
  modelSupportsImages: boolean,
  modelSupportsVideo: boolean,
): string | (TextContent | ImageContent | VideoContent)[] {
  if (inputImages.length === 0) return text;

  const parts: (TextContent | ImageContent | VideoContent)[] = [];
  if (text) {
    parts.push({ type: "text", text });
  }

  for (const img of inputImages) {
    if (img.kind === "text") {
      parts.push({
        type: "text",
        text: `<file name="${img.fileName}">\n${img.data}\n</file>`,
      });
    } else if (img.kind === "video") {
      if (modelSupportsVideo) {
        parts.push({ type: "video", mediaType: img.mediaType, data: img.data });
      } else {
        // Models without native video: save to a temp file and tell the model
        // to inspect it with ffmpeg/tools (mirrors the GLM image fallback).
        const ext =
          Object.entries(VIDEO_MEDIA_TYPES).find(([, mt]) => mt === img.mediaType)?.[0] ?? ".mp4";
        const tmpPath = `/tmp/ggcoder-video-${Date.now()}${ext}`;
        try {
          writeFileSync(tmpPath, Buffer.from(img.data, "base64"));
          parts.push({
            type: "text",
            text: `[User attached a video saved at: ${tmpPath} — use ffmpeg or your tools to inspect it]`,
          });
        } catch {
          parts.push({
            type: "text",
            text: `[User attached a video but it could not be saved for analysis]`,
          });
        }
      }
    } else if (modelSupportsImages) {
      parts.push({ type: "image", mediaType: img.mediaType, data: img.data });
    } else {
      // GLM models: save image to temp file and instruct model to use vision MCP tool
      const ext = img.mediaType.split("/")[1] ?? "png";
      const tmpPath = `/tmp/ggcoder-img-${Date.now()}.${ext}`;
      try {
        writeFileSync(tmpPath, Buffer.from(img.data, "base64"));
        parts.push({
          type: "text",
          text: `[User attached an image saved at: ${tmpPath} — use the image_analysis tool to view and analyze it]`,
        });
      } catch {
        parts.push({
          type: "text",
          text: `[User attached an image but it could not be saved for analysis]`,
        });
      }
    }
  }

  // If only text parts remain after stripping images, simplify to plain string
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}
