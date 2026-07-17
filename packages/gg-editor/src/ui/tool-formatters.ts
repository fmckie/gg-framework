/**
 * Per-tool detail + inline-summary formatters for gg-editor's ~91 tools.
 *
 * Kleio Coder's ToolExecution component renders every tool as
 * `<Bold>Label</Bold> (detail) — inline_summary` once done. The default behavior
 * converts snake_case to Title Case for the label and shows nothing for detail
 * or inline output unless `getToolHeaderParts` / `getInlineSummary` handles it.
 *
 * This file plugs gg-editor specifics into that surface via the
 * `ToolExecutionFormatters` API. Everything here is opt-in; returning
 * undefined keeps Kleio Coder's built-in defaults.
 *
 * Convention for `formatDetail`:
 *   - Show the most identifying argument the model picked (file path, clip id,
 *     candidate count, target aspect, etc.) — at most ~50 chars.
 *   - Skip generic args (model name, detail level) unless they're the only
 *     thing the user cares about for that tool.
 *
 * Convention for `formatInline`:
 *   - Tools that return one-shot status (e.g. `"ok"`, `"ok:<path>"`) get a
 *     concise summary derived from the JSON result.
 *   - Tools that return structured JSON we know about (compact()-shaped
 *     objects from `core/format.ts`) get key fields surfaced.
 */

import type { ToolExecutionFormatters } from "@kleio/coder/ui";

// ── helpers ─────────────────────────────────────────────────

const truncate = (s: string, max = 50): string => (s.length > max ? s.slice(0, max - 1) + "…" : s);

const basename = (p: string): string => {
  const norm = p.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i < 0 ? norm : norm.slice(i + 1);
};

const sec = (v: unknown): string => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (n < 60) return `${n.toFixed(1)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Pick the first present-and-non-empty file-like arg by basename. The default
 * key list covers every name we use across the 91 tools (filePath on
 * probe_media, transcript on score_clip, mediaPath on insert_broll, etc.)
 * so callers can usually omit explicit keys. Pass extra priority keys when a
 * tool has a clearly-most-relevant arg (e.g. `output` on render tools).
 */
const DEFAULT_FILE_KEYS = [
  "input",
  "filePath",
  "file",
  "path",
  "transcript",
  "transcriptPath",
  "sourceVideo",
  "videoPath",
  "video",
  "audio",
  "mediaPath",
  "source",
  "thumbnail",
  "lutPath",
] as const;

const fileArg = (args: Record<string, unknown>, ...keys: string[]): string | undefined => {
  const all = keys.length ? [...keys, ...DEFAULT_FILE_KEYS] : [...DEFAULT_FILE_KEYS];
  for (const k of all) {
    const v = args[k];
    if (typeof v === "string" && v.length > 0) return basename(v);
  }
  return undefined;
};

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

// ── detail formatter ───────────────────────────────────────

export function formatGgEditorDetail(
  name: string,
  args: Record<string, unknown>,
): string | undefined {
  switch (name) {
    // Host introspection / state
    case "host_info":
      return undefined;
    case "get_timeline":
      return undefined;
    case "get_markers": {
      const parts: string[] = [];
      if (args.color) parts.push(String(args.color));
      if (args.contains) parts.push(`"${truncate(String(args.contains), 24)}"`);
      return parts.join(", ") || undefined;
    }

    // Mutation
    case "cut_at":
      return `track ${args.track ?? "?"} @ ${args.frame ?? "?"}`;
    case "ripple_delete":
      return `track ${args.track ?? "?"} ${args.startFrame ?? "?"}–${args.endFrame ?? "?"}`;
    case "add_marker": {
      const note = args.note ? `"${truncate(String(args.note), 36)}"` : "";
      const color = args.color ? `${args.color} ` : "";
      return `${color}${note}` || undefined;
    }
    case "append_clip":
    case "replace_clip":
    case "insert_broll":
      return fileArg(args, "mediaPath");
    case "set_clip_speed":
      return `${args.clipId ?? "?"} → ${args.speed}×`;
    case "set_clip_volume":
      return `${args.clipId ?? "?"} → ${args.gainDb}dB`;
    case "save_project":
    case "open_page":
      return args.page ? String(args.page) : undefined;
    case "create_timeline":
    case "clone_timeline":
      return args.name ? truncate(String(args.name), 36) : undefined;
    case "import_to_media_pool":
      return fileArg(args, "path");
    case "add_track":
      return args.kind ? String(args.kind) : undefined;

    // Bulk timeline
    case "write_edl":
    case "write_fcpxml":
    case "import_edl":
      return fileArg(args, "path", "output");
    case "reformat_timeline":
      return args.preset ? String(args.preset) : undefined;
    case "render":
      return args.preset ? String(args.preset) : undefined;
    case "render_multi_format": {
      const formats = Array.isArray(args.formats) ? (args.formats as string[]) : [];
      return formats.length ? truncate(formats.join(", "), 50) : undefined;
    }
    case "list_render_presets":
      return undefined;
    case "smart_reframe":
    case "face_reframe":
      return args.aspect ? String(args.aspect) : undefined;
    case "pre_render_check":
      return undefined;
    case "reorder_timeline": {
      const order = Array.isArray(args.newOrder) ? (args.newOrder as unknown[]) : [];
      return order.length ? `${order.length} clips` : undefined;
    }
    case "compose_layered":
      return fileArg(args, "output");

    // Captions / subtitles
    case "write_srt":
    case "write_ass":
      return fileArg(args, "output");
    case "import_subtitles":
      return fileArg(args, "path");

    // Color (Resolve-only)
    case "apply_lut":
      return `${args.clipId ?? "?"} ← ${basename(String(args.lutPath ?? ""))}`;
    case "set_primary_correction":
    case "copy_grade":
      return args.clipId ? String(args.clipId) : undefined;
    case "color_match":
      return `${basename(String(args.referenceVideo ?? ""))} → ${basename(String(args.targetVideo ?? ""))}`;
    case "grade_skin_tones":
      return fileArg(args, "output", "targetVideo");
    case "match_clip_color":
      return args.targetClipId ? String(args.targetClipId) : undefined;

    // Motion graphics
    case "fusion_comp":
      return args.action ? String(args.action) : undefined;

    // Audio
    case "measure_loudness":
    case "normalize_loudness":
      return fileArg(args, "input");
    case "clean_audio":
      return args.mode ? String(args.mode) : fileArg(args, "input");
    case "duck_audio":
      return `${basename(String(args.voice ?? ""))} + ${basename(String(args.background ?? ""))}`;
    case "mix_audio":
      return fileArg(args, "input");

    // Frame / video utilities
    case "extract_frame":
      return `@ ${sec(args.atSec)}`;
    case "stabilize_video":
    case "burn_subtitles":
    case "concat_videos":
    case "add_fades":
    case "crossfade_videos":
    case "generate_gif":
    case "overlay_watermark":
    case "compose_thumbnail":
    case "speed_ramp":
    case "ken_burns":
    case "write_lower_third":
    case "write_title_card":
    case "trim_dead_air":
    case "bleep_words":
    case "loop_match_short":
    case "generate_outro":
      return fileArg(args, "output");
    case "transition_videos":
      return args.preset ? String(args.preset) : fileArg(args, "output");

    // Retention pipeline
    case "cut_filler_words":
      return fileArg(args, "transcript", "sourceVideo");
    case "text_based_cut": {
      const cuts = Array.isArray(args.cuts) ? (args.cuts as unknown[]) : [];
      return cuts.length ? `${cuts.length} cut${cuts.length === 1 ? "" : "s"}` : undefined;
    }
    case "punch_in":
      return fileArg(args, "input");
    case "analyze_hook":
    case "audit_first_frame":
      return fileArg(args, "input");
    case "audit_retention_structure":
      return fileArg(args, "transcript");
    case "verify_thumbnail_promise":
      return `${basename(String(args.thumbnail ?? ""))} vs ${basename(String(args.video ?? ""))}`;
    case "rewrite_hook":
      return args.pattern ? String(args.pattern) : undefined;
    case "write_keyword_captions":
      return fileArg(args, "output");
    case "add_sfx_at_cuts":
      return fileArg(args, "output");
    case "snap_cuts_to_beats": {
      const cuts = Array.isArray(args.cutPoints) ? (args.cutPoints as unknown[]) : [];
      return cuts.length ? `${cuts.length} cuts` : undefined;
    }

    // LLM creator helpers
    case "score_clip":
      return `${sec(args.startSec)}–${sec(args.endSec)}`;
    case "find_viral_moments": {
      const max = args.maxClips ?? 5;
      return `top ${max}`;
    }
    case "generate_youtube_metadata":
      return fileArg(args, "transcript");
    case "compose_thumbnail_variants":
      return args.strategy ? String(args.strategy) : undefined;
    case "suggest_broll": {
      const n = args.topN ?? 5;
      return `top ${n}`;
    }

    // Vision / shot scoring
    case "score_shot":
      return fileArg(args, "input");
    case "pick_best_takes":
      return fileArg(args, "transcriptPath", "videoPath");

    // Media io
    case "probe_media":
      return fileArg(args, "filePath");
    case "extract_audio":
    case "detect_silence":
      return fileArg(args, "input");
    case "transcribe":
      return fileArg(args, "input");
    case "read_transcript": {
      const parts: string[] = [];
      if (args.contains) parts.push(`"${truncate(String(args.contains), 24)}"`);
      if (args.startSec !== undefined && args.endSec !== undefined) {
        parts.push(`${sec(args.startSec)}–${sec(args.endSec)}`);
      }
      return parts.join(", ") || fileArg(args, "path");
    }
    case "cluster_takes":
      return fileArg(args, "path", "transcript");
    case "multicam_sync": {
      const inputs = Array.isArray(args.inputs) ? (args.inputs as string[]) : [];
      const method = args.method ? `, ${args.method}` : "";
      return inputs.length
        ? `${inputs.length} sources${method}`
        : args.method
          ? String(args.method)
          : undefined;
    }
    case "detect_speaker_changes":
      return fileArg(args, "transcript");

    // Skills + meta
    case "read_skill":
      return args.name ? String(args.name) : undefined;
    case "search_tools":
      return args.query ? `"${truncate(String(args.query), 40)}"` : undefined;

    // Escape hatch
    case "host_eval": {
      const code = String(args.code ?? "");
      const first = code.split("\n")[0];
      return truncate(first, 50);
    }
    case "review_edit":
      return fileArg(args, "rendered", "input");

    default:
      return undefined;
  }
}

// ── inline summary at done time ─────────────────────────────

export function formatGgEditorInline(
  name: string,
  result: string,
  isError: boolean,
): string | undefined {
  if (isError) {
    // gg-editor errors are formatted as "error: <cause>; fix: <next-step>".
    // Strip the "error:" prefix — the dim-red colour already says it's an error.
    const stripped = result.replace(/^error:\s*/, "");
    const firstSegment = stripped.split(";")[0];
    return truncate(firstSegment, 60);
  }

  // Tools that return bare "ok" or "ok:<path>" — surface the path basename.
  if (result === "ok") return undefined;
  if (result.startsWith("ok:")) return basename(result.slice(3));

  const parsed = safeJson(result);
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    switch (name) {
      case "cut_filler_words": {
        const stats = obj.stats as { total?: number; durationSec?: number } | undefined;
        if (stats?.total) {
          const dur = stats.durationSec ? ` (${sec(stats.durationSec)})` : "";
          return `removed ${stats.total} filler${stats.total === 1 ? "" : "s"}${dur}`;
        }
        break;
      }
      case "text_based_cut":
        return obj.removedSec
          ? `removed ${sec(obj.removedSec)} (${obj.cuts ?? "?"} ranges)`
          : undefined;
      case "trim_dead_air":
        return obj.removedSec ? `trimmed ${sec(obj.removedSec)}` : undefined;
      case "bleep_words":
        return obj.matched ? `${obj.matched} match${obj.matched === 1 ? "" : "es"}` : undefined;
      case "find_viral_moments": {
        const c = Array.isArray(obj.candidates) ? obj.candidates.length : 0;
        return `${c} candidate${c === 1 ? "" : "s"}`;
      }
      case "score_clip":
        return obj.score !== undefined ? `score ${obj.score}/100` : undefined;
      case "analyze_hook":
        return obj.score !== undefined
          ? `score ${obj.score}/100${obj.passes === false ? " (FAIL)" : ""}`
          : undefined;
      case "audit_first_frame":
        return obj.score !== undefined ? `${obj.score}/100` : undefined;
      case "audit_retention_structure": {
        const cps = Array.isArray(obj.checkpoints) ? obj.checkpoints.length : 0;
        const weak = obj.weakestCheckpoint as { atSec?: number; score?: number } | undefined;
        return weak?.score !== undefined
          ? `weakest @ ${sec(weak.atSec ?? 0)} (${weak.score})`
          : `${cps} checkpoint${cps === 1 ? "" : "s"}`;
      }
      case "verify_thumbnail_promise":
        return obj.matches !== undefined
          ? `match ${(Number(obj.matches) * 100).toFixed(0)}%`
          : undefined;
      case "rewrite_hook": {
        const cs = Array.isArray(obj.candidates) ? obj.candidates.length : 0;
        return `${cs} candidate${cs === 1 ? "" : "s"}`;
      }
      case "render_multi_format": {
        const c = Number(obj.count ?? 0);
        return c ? `${c} render${c === 1 ? "" : "s"}` : undefined;
      }
      case "compose_thumbnail_variants": {
        const c = Number(obj.count ?? 0);
        return c ? `${c} variant${c === 1 ? "" : "s"}` : undefined;
      }
      case "suggest_broll": {
        const c = Number(obj.count ?? 0);
        return c ? `${c} clip${c === 1 ? "" : "s"}` : undefined;
      }
      case "snap_cuts_to_beats": {
        const snapped = Array.isArray(obj.snapped) ? obj.snapped.length : 0;
        const tempo = obj.tempo ? ` @ ${Math.round(Number(obj.tempo))} BPM` : "";
        return `${snapped} snapped${tempo}`;
      }
      case "loop_match_short":
        return obj.path ? basename(String(obj.path)) : undefined;
      case "generate_youtube_metadata": {
        const titles = Array.isArray(obj.titles) ? obj.titles.length : 0;
        const chapters = Array.isArray(obj.chapters) ? obj.chapters.length : 0;
        return `${titles} title${titles === 1 ? "" : "s"}, ${chapters} chapter${chapters === 1 ? "" : "s"}`;
      }
      case "transcribe": {
        const dur = obj.durationSec;
        return dur ? `${sec(dur)} transcribed` : undefined;
      }
      case "detect_silence": {
        const r = Array.isArray(obj.ranges) ? obj.ranges.length : 0;
        return r ? `${r} silence range${r === 1 ? "" : "s"}` : "no silence";
      }
      case "get_timeline": {
        // Result shape from get_timeline: {name, fps, durationFrames, total, head, tail, ...}
        const total = typeof obj.total === "number" ? obj.total : undefined;
        const fps = typeof obj.fps === "number" ? obj.fps : undefined;
        const dur =
          typeof obj.durationFrames === "number" && fps ? obj.durationFrames / fps : undefined;
        const parts: string[] = [];
        if (total !== undefined) parts.push(`${total} clip${total === 1 ? "" : "s"}`);
        if (dur !== undefined) parts.push(sec(dur));
        if (fps !== undefined) parts.push(`${fps}fps`);
        return parts.length ? parts.join(", ") : undefined;
      }
      case "get_markers": {
        const total = typeof obj.total === "number" ? obj.total : undefined;
        if (total !== undefined) return `${total} marker${total === 1 ? "" : "s"}`;
        const head = Array.isArray(obj.head) ? obj.head.length : 0;
        return head ? `${head} marker${head === 1 ? "" : "s"}` : "no markers";
      }
      case "host_eval": {
        // Result shape: {result?, stdout?}. Surface result first, then stdout.
        if ("result" in obj && obj.result !== undefined && obj.result !== null) {
          const v = typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result);
          return truncate(v.replace(/\s+/g, " ").trim(), 60);
        }
        if (typeof obj.stdout === "string" && obj.stdout) {
          return truncate(obj.stdout.split("\n")[0], 60);
        }
        return undefined;
      }
      case "score_shot": {
        const top = Array.isArray(obj.top) ? obj.top.length : 0;
        return top ? `${top} top frame${top === 1 ? "" : "s"}` : undefined;
      }
      case "search_tools": {
        const matches = Array.isArray(obj.matches) ? obj.matches.length : 0;
        return matches ? `${matches} match${matches === 1 ? "" : "es"}` : "no matches";
      }
      case "probe_media": {
        const dur = obj.durationSec;
        const fps = obj.frameRate;
        return dur && fps ? `${sec(dur)} @ ${fps}fps` : undefined;
      }
      case "measure_loudness":
        return obj.integratedLufs !== undefined
          ? `${Number(obj.integratedLufs).toFixed(1)} LUFS`
          : undefined;
      case "host_info": {
        const host = obj.host;
        const ok = obj.available;
        return host ? `${host}${ok === false ? " (offline)" : ""}` : undefined;
      }
      default:
        // Generic compact() shape — surface the `path` if present.
        if (typeof obj.path === "string") return basename(obj.path);
        if (typeof obj.ok === "boolean" && obj.path) return basename(String(obj.path));
        return undefined;
    }
  }
  return undefined;
}

/** Bundled formatter object passed straight to ToolExecution's `formatters` prop. */
export const ggEditorFormatters: ToolExecutionFormatters = {
  formatDetail: formatGgEditorDetail,
  formatInline: formatGgEditorInline,
};
