import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kleio/agent";
import { compact, err } from "../core/format.js";
import { checkFfprobe, probeMedia } from "../core/media/ffmpeg.js";

const ProbeMediaParams = z.object({
  filePath: z.string(),
});

export function createProbeMediaTool(cwd: string): AgentTool<typeof ProbeMediaParams> {
  return {
    name: "probe_media",
    description:
      "Probe a media file via ffprobe. Use BEFORE editing to verify framerate, duration, " +
      "resolution, codecs.",
    parameters: ProbeMediaParams,
    async execute({ filePath }) {
      if (!checkFfprobe()) return err("ffprobe not on PATH", "install ffmpeg");
      const abs = resolvePath(cwd, filePath);
      const p = probeMedia(abs);
      if (!p) return err(`probe failed for ${abs}`);
      return compact({
        dur: +p.durationSec.toFixed(3),
        w: p.width,
        h: p.height,
        fps: p.frameRate ? +p.frameRate.toFixed(3) : undefined,
        v: p.videoCodec,
        a: p.audioCodec,
      });
    },
  };
}
