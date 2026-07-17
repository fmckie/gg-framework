import type { AgentTool } from "@kleio/agent";
import type { VideoHost } from "../core/hosts/types.js";
import { logError, logInfo } from "../core/logger.js";
import { discoverSkills, type SkillSource } from "../core/skills-loader.js";
import { SKILLS } from "../skills.js";
import { createAddFadesTool } from "./add-fades.js";
import { createAddMarkerTool } from "./add-marker.js";
import { createAddTrackTool } from "./add-track.js";
import { createApplyLutTool } from "./apply-lut.js";
import { createAppendClipTool } from "./append-clip.js";
import { createBurnSubtitlesTool } from "./burn-subtitles.js";
import { createCleanAudioTool } from "./clean-audio.js";
import { createCloneTimelineTool } from "./clone-timeline.js";
import { createClusterTakesTool } from "./cluster-takes.js";
import { createComposeThumbnailTool } from "./compose-thumbnail.js";
import { createComposeThumbnailVariantsTool } from "./compose-thumbnail-variants.js";
import { createConcatVideosTool } from "./concat-videos.js";
import { createColorMatchTool } from "./color-match.js";
import { createGradeSkinTonesTool } from "./grade-skin-tones.js";
import { createMatchClipColorTool } from "./match-clip-color.js";
import { createCutFillerWordsTool } from "./cut-filler-words.js";
import { createPunchInTool } from "./punch-in.js";
import { createAnalyzeHookTool } from "./analyze-hook.js";
import { createAuditFirstFrameTool } from "./audit-first-frame.js";
import { createAuditRetentionStructureTool } from "./audit-retention-structure.js";
import { createLoopMatchShortTool } from "./loop-match-short.js";
import { createRewriteHookTool } from "./rewrite-hook.js";
import { createVerifyThumbnailPromiseTool } from "./verify-thumbnail-promise.js";
import { createScoreClipTool } from "./score-clip.js";
import { createFindViralMomentsTool } from "./find-viral-moments.js";
import { createGenerateYouTubeMetadataTool } from "./generate-youtube-metadata.js";
import { createWriteKeywordCaptionsTool } from "./write-keyword-captions.js";
import { createAddSfxAtCutsTool } from "./add-sfx-at-cuts.js";
import { createAddSfxToTimelineTool } from "./add-sfx-to-timeline.js";
import { createSnapCutsToBeatsTool } from "./snap-cuts-to-beats.js";
import { createFaceReframeTool } from "./face-reframe.js";
import { createComposeLayeredTool } from "./compose-layered.js";
import { createCopyGradeTool } from "./copy-grade.js";
import { createDetectSpeakerChangesTool } from "./detect-speaker-changes.js";
import { createCrossfadeVideosTool } from "./crossfade-videos.js";
import { createKenBurnsTool } from "./ken-burns.js";
import { createMixAudioTool } from "./mix-audio.js";
import { createReorderTimelineTool } from "./reorder-timeline.js";
import { createSpeedRampTool } from "./speed-ramp.js";
import { createTransitionVideosTool } from "./transition-videos.js";
import { createWriteLowerThirdTool } from "./write-lower-third.js";
import { createWriteTitleCardTool } from "./write-title-card.js";
import { createDuckAudioTool } from "./duck-audio.js";
import { createCreateTimelineTool } from "./create-timeline.js";
import { createCutAtTool } from "./cut-at.js";
import { createDetectSilenceTool } from "./detect-silence.js";
import { createExtractAudioTool } from "./extract-audio.js";
import { createGetMarkersTool } from "./get-markers.js";
import { createGetTimelineTool } from "./get-timeline.js";
import { createHostEvalTool } from "./host-eval.js";
import { createHostInfoTool } from "./host-info.js";
import { createImportEdlTool } from "./import-edl.js";
import { createImportSubtitlesTool } from "./import-subtitles.js";
import { createImportToMediaPoolTool } from "./import-to-media-pool.js";
import { createGenerateGifTool } from "./generate-gif.js";
import { createInsertBrollTool } from "./insert-broll.js";
import { createSuggestBrollTool } from "./suggest-broll.js";
import { createListRenderPresetsTool } from "./list-render-presets.js";
import { createOverlayWatermarkTool } from "./overlay-watermark.js";
import { createMeasureLoudnessTool } from "./measure-loudness.js";
import { createMulticamSyncTool } from "./multicam-sync.js";
import { createNormalizeLoudnessTool } from "./normalize-loudness.js";
import { createPreRenderCheckTool } from "./pre-render-check.js";
import { createExtractFrameTool } from "./extract-frame.js";
import { createFusionCompTool } from "./fusion-comp.js";
import { createSaveProjectTool } from "./save-project.js";
import { createWriteAssTool } from "./write-ass.js";
import { createOpenPageTool } from "./open-page.js";
import { createPickBestTakesTool } from "./pick-best-takes.js";
import { createProbeMediaTool } from "./probe-media.js";
import { createReadSkillTool } from "./read-skill.js";
import { createReadTranscriptTool } from "./read-transcript.js";
import { createReviewEditTool, type ReviewEditConfig } from "./review-edit.js";
import { createReformatTimelineTool } from "./reformat-timeline.js";
import { createRenderMultiFormatTool } from "./render-multi-format.js";
import { createRenderTool } from "./render.js";
import { createRippleDeleteTool } from "./ripple-delete.js";
import { createScoreShotTool } from "./score-shot.js";
import { createReplaceClipTool } from "./replace-clip.js";
import { createSetClipSpeedTool } from "./set-clip-speed.js";
import { createSetClipVolumeTool } from "./set-clip-volume.js";
import { createStabilizeVideoTool } from "./stabilize-video.js";
import { createSetPrimaryCorrectionTool } from "./set-primary-correction.js";
import { createSmartReframeTool } from "./smart-reframe.js";
import { createTranscribeTool } from "./transcribe.js";
import { createWriteEdlTool } from "./write-edl.js";
import { createWriteFcpxmlTool } from "./write-fcpxml.js";
import { createWriteSrtTool } from "./write-srt.js";
import { createTrimDeadAirTool } from "./trim-dead-air.js";
import { createBleepWordsTool } from "./bleep-words.js";
import { createTextBasedCutTool } from "./text-based-cut.js";
import { createGenerateOutroTool } from "./generate-outro.js";
import { createSearchToolsTool } from "./search-tools.js";

export interface CreateEditorToolsOptions {
  host: VideoHost;
  cwd: string;
  /**
   * If supplied, registers the read-only `review_edit` self-critique tool.
   * If absent, `review_edit` is omitted (file-only / no-auth contexts).
   */
  reviewConfig?: ReviewEditConfig;
  /**
   * Skill set the agent can read via `read_skill`. Defaults to the result of
   * `discoverSkills({ cwd, bundled: SKILLS })` so library consumers get sensible
   * behaviour automatically (bundled + project + user skills layered).
   */
  skills?: SkillSource[];
}

export function createEditorTools(opts: CreateEditorToolsOptions): AgentTool[] {
  const { host, cwd, reviewConfig } = opts;
  const skills = opts.skills ?? discoverSkills({ cwd, bundled: Object.values(SKILLS) });
  const tools: AgentTool[] = [
    // Host introspection — agent should call this first.
    createHostInfoTool(host),

    // Timeline-state ops
    createGetTimelineTool(host),
    createGetMarkersTool(host),

    // Mutation ops (per-clip)
    createCutAtTool(host),
    createRippleDeleteTool(host),
    createAddMarkerTool(host),
    createAppendClipTool(host, cwd),
    createSetClipSpeedTool(host),
    createSetClipVolumeTool(host),
    createReplaceClipTool(host, cwd),
    createInsertBrollTool(host, cwd),
    createSuggestBrollTool(cwd),

    // Project / timeline / media-pool setup
    createCreateTimelineTool(host),
    createCloneTimelineTool(host),
    createSaveProjectTool(host),
    createAddTrackTool(host),
    createImportToMediaPoolTool(host, cwd),
    createOpenPageTool(host),

    // Bulk timeline ops
    createWriteEdlTool(cwd),
    createWriteFcpxmlTool(cwd),
    createImportEdlTool(host, cwd),
    createReformatTimelineTool(cwd),
    createRenderTool(host, cwd),
    createRenderMultiFormatTool(cwd),
    createListRenderPresetsTool(host),
    createSmartReframeTool(host),
    createFaceReframeTool(cwd),
    createPreRenderCheckTool(host, cwd),
    createReorderTimelineTool(host, cwd),
    createComposeLayeredTool(host, cwd),

    // Captions / subtitles
    createWriteSrtTool(cwd),
    createWriteAssTool(cwd),
    createImportSubtitlesTool(host, cwd),

    // Color (Resolve-only — Premiere throws unsupported)
    createApplyLutTool(host, cwd),
    createSetPrimaryCorrectionTool(host),
    createCopyGradeTool(host),
    createColorMatchTool(cwd),
    createGradeSkinTonesTool(cwd),
    createMatchClipColorTool(host, cwd),

    // Motion graphics (Resolve only — Premiere returns not_supported)
    createFusionCompTool(host),

    // Audio cleanup + loudness (file-only; works on every host)
    createMeasureLoudnessTool(cwd),
    createNormalizeLoudnessTool(cwd),
    createCleanAudioTool(cwd),
    createDuckAudioTool(cwd),
    createMixAudioTool(cwd),

    // Frame extraction
    createExtractFrameTool(cwd),

    // Video stabilization
    createStabilizeVideoTool(cwd),

    // Post-production / delivery (file-only)
    createBurnSubtitlesTool(cwd),
    createTrimDeadAirTool(cwd),
    createBleepWordsTool(cwd),
    createGenerateOutroTool(cwd),
    createConcatVideosTool(cwd),
    createAddFadesTool(cwd),
    createCrossfadeVideosTool(cwd),
    createTransitionVideosTool(cwd),
    createGenerateGifTool(cwd),
    createOverlayWatermarkTool(cwd),
    createComposeThumbnailTool(cwd),
    createSpeedRampTool(cwd),
    createKenBurnsTool(cwd),
    createWriteLowerThirdTool(cwd),
    createWriteTitleCardTool(cwd),

    // Retention-tuning ops (the YouTube / TikTok / Reels pipeline)
    createCutFillerWordsTool(cwd),
    createTextBasedCutTool(cwd),
    createPunchInTool(cwd),
    createAnalyzeHookTool(cwd),
    createAuditFirstFrameTool(cwd),
    createAuditRetentionStructureTool(cwd),
    createRewriteHookTool(cwd),
    createVerifyThumbnailPromiseTool(cwd),
    createWriteKeywordCaptionsTool(cwd),
    createAddSfxAtCutsTool(cwd),
    createAddSfxToTimelineTool(host, cwd),
    createSnapCutsToBeatsTool(cwd),
    createLoopMatchShortTool(cwd),

    // LLM-driven creator helpers
    createScoreClipTool(cwd),
    createFindViralMomentsTool(cwd),
    createGenerateYouTubeMetadataTool(cwd),
    createComposeThumbnailVariantsTool(cwd),

    // Host-independent media ops
    createProbeMediaTool(cwd),
    createExtractAudioTool(cwd),
    createDetectSilenceTool(cwd),
    createTranscribeTool(cwd),
    createReadTranscriptTool(cwd),
    createClusterTakesTool(cwd),
    createScoreShotTool(cwd),
    createPickBestTakesTool(cwd),
    createMulticamSyncTool(cwd),
    createDetectSpeakerChangesTool(cwd),

    // Skills
    createReadSkillTool(skills),

    // Escape hatch — ALWAYS register; throws not_supported on host=none.
    // Read host-eval.ts for the contract: only use when no named tool fits.
    createHostEvalTool(host),
  ];

  if (reviewConfig) {
    tools.push(createReviewEditTool(host, cwd, reviewConfig));
  }
  // Meta-tool: needs to introspect the live registry. Built last so it sees
  // every other tool. Snapshot of {name, description} avoids leaking the
  // execute closures into the search index.
  const snapshot = tools.map((t) => ({ name: t.name, description: t.description ?? "" }));
  tools.push(createSearchToolsTool(() => snapshot));
  return tools.map(withLogging);
}

/**
 * Wrap a tool's `execute` so every invocation is logged with name, args,
 * duration, and ok/err. Single decorator applied uniformly so the agent
 * loop can't get a tool call past us without leaving a log trail.
 *
 * Args are JSON-stringified and capped — long media paths and CDL arrays
 * shouldn't drown the log. Same for the result preview.
 */
function withLogging<T extends AgentTool>(tool: T): T {
  const originalExecute = tool.execute.bind(tool);
  const wrapped: T = {
    ...tool,
    execute: async (args, context) => {
      const startedAt = Date.now();
      const argsPreview = previewJson(args);
      try {
        const result = await originalExecute(args, context);
        const isError =
          typeof result === "object" && result !== null && "isError" in result
            ? Boolean((result as { isError?: unknown }).isError)
            : false;
        const resultText =
          typeof result === "object" && result !== null && "content" in result
            ? extractContentPreview((result as { content?: unknown }).content)
            : previewJson(result);
        const meta = {
          ms: Date.now() - startedAt,
          args: argsPreview,
          result: resultText,
        };
        if (isError) logError("tool", tool.name, meta);
        else logInfo("tool", tool.name, meta);
        return result;
      } catch (e) {
        const err = e as Error;
        logError("tool", tool.name, {
          ms: Date.now() - startedAt,
          args: argsPreview,
          throw: err.message,
        });
        throw e;
      }
    },
  } as T;
  return wrapped;
}

// Field-cap is enforced inside logger.formatValue; we just produce raw
// strings here. No need to truncate twice (would distort the overflow count).
function previewJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractContentPreview(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        typeof c === "object" && c !== null && "text" in c
          ? String((c as { text: unknown }).text)
          : previewJson(c),
      )
      .join(" | ");
  }
  return previewJson(content);
}

export { createAddFadesTool } from "./add-fades.js";
export { createAddMarkerTool } from "./add-marker.js";
export { createAddTrackTool } from "./add-track.js";
export { createApplyLutTool } from "./apply-lut.js";
export { createAppendClipTool } from "./append-clip.js";
export { createBurnSubtitlesTool } from "./burn-subtitles.js";
export { createCleanAudioTool } from "./clean-audio.js";
export { createCloneTimelineTool } from "./clone-timeline.js";
export { createClusterTakesTool } from "./cluster-takes.js";
export { createComposeThumbnailTool } from "./compose-thumbnail.js";
export { createComposeThumbnailVariantsTool } from "./compose-thumbnail-variants.js";
export { createConcatVideosTool } from "./concat-videos.js";
export { createCrossfadeVideosTool } from "./crossfade-videos.js";
export { createColorMatchTool } from "./color-match.js";
export { createGradeSkinTonesTool } from "./grade-skin-tones.js";
export { createMatchClipColorTool } from "./match-clip-color.js";
export { createCutFillerWordsTool } from "./cut-filler-words.js";
export { createPunchInTool } from "./punch-in.js";
export { createAnalyzeHookTool } from "./analyze-hook.js";
export { createAuditFirstFrameTool } from "./audit-first-frame.js";
export { createAuditRetentionStructureTool } from "./audit-retention-structure.js";
export { createLoopMatchShortTool } from "./loop-match-short.js";
export { createRewriteHookTool } from "./rewrite-hook.js";
export { createVerifyThumbnailPromiseTool } from "./verify-thumbnail-promise.js";
export { createScoreClipTool } from "./score-clip.js";
export { createFindViralMomentsTool } from "./find-viral-moments.js";
export { createGenerateYouTubeMetadataTool } from "./generate-youtube-metadata.js";
export { createWriteKeywordCaptionsTool } from "./write-keyword-captions.js";
export { createAddSfxAtCutsTool } from "./add-sfx-at-cuts.js";
export { createAddSfxToTimelineTool } from "./add-sfx-to-timeline.js";
export { createSnapCutsToBeatsTool } from "./snap-cuts-to-beats.js";
export { createFaceReframeTool } from "./face-reframe.js";
export { createComposeLayeredTool } from "./compose-layered.js";
export { createCopyGradeTool } from "./copy-grade.js";
export { createDetectSpeakerChangesTool } from "./detect-speaker-changes.js";
export { createKenBurnsTool } from "./ken-burns.js";
export { createMixAudioTool } from "./mix-audio.js";
export { createReorderTimelineTool } from "./reorder-timeline.js";
export { createSpeedRampTool } from "./speed-ramp.js";
export { createTransitionVideosTool } from "./transition-videos.js";
export { createWriteLowerThirdTool } from "./write-lower-third.js";
export { createWriteTitleCardTool } from "./write-title-card.js";
export { createDuckAudioTool } from "./duck-audio.js";
export { createCreateTimelineTool } from "./create-timeline.js";
export { createCutAtTool } from "./cut-at.js";
export { createDetectSilenceTool } from "./detect-silence.js";
export { createExtractAudioTool } from "./extract-audio.js";
export { createGetMarkersTool } from "./get-markers.js";
export { createGetTimelineTool } from "./get-timeline.js";
export { createHostEvalTool } from "./host-eval.js";
export { createHostInfoTool } from "./host-info.js";
export { createImportEdlTool } from "./import-edl.js";
export { createImportSubtitlesTool } from "./import-subtitles.js";
export { createExtractFrameTool } from "./extract-frame.js";
export { createFusionCompTool } from "./fusion-comp.js";
export { createImportToMediaPoolTool } from "./import-to-media-pool.js";
export { createGenerateGifTool } from "./generate-gif.js";
export { createInsertBrollTool } from "./insert-broll.js";
export { createSuggestBrollTool } from "./suggest-broll.js";
export { createListRenderPresetsTool } from "./list-render-presets.js";
export { createOverlayWatermarkTool } from "./overlay-watermark.js";
export { createMeasureLoudnessTool } from "./measure-loudness.js";
export { createMulticamSyncTool } from "./multicam-sync.js";
export { createNormalizeLoudnessTool } from "./normalize-loudness.js";
export { createPreRenderCheckTool } from "./pre-render-check.js";
export { createSaveProjectTool } from "./save-project.js";
export { createWriteAssTool } from "./write-ass.js";
export { createOpenPageTool } from "./open-page.js";
export { createPickBestTakesTool } from "./pick-best-takes.js";
export { createProbeMediaTool } from "./probe-media.js";
export { createReadSkillTool } from "./read-skill.js";
export { createReadTranscriptTool } from "./read-transcript.js";
export { createReviewEditTool } from "./review-edit.js";
export type { ReviewEditConfig } from "./review-edit.js";
export { createReformatTimelineTool } from "./reformat-timeline.js";
export { createRenderMultiFormatTool } from "./render-multi-format.js";
export { createRenderTool } from "./render.js";
export { createRippleDeleteTool } from "./ripple-delete.js";
export { createScoreShotTool } from "./score-shot.js";
export { createReplaceClipTool } from "./replace-clip.js";
export { createSetClipSpeedTool } from "./set-clip-speed.js";
export { createSetClipVolumeTool } from "./set-clip-volume.js";
export { createSetPrimaryCorrectionTool } from "./set-primary-correction.js";
export { createSmartReframeTool } from "./smart-reframe.js";
export { createStabilizeVideoTool } from "./stabilize-video.js";
export { createTranscribeTool } from "./transcribe.js";
export { createWriteEdlTool } from "./write-edl.js";
export { createWriteFcpxmlTool } from "./write-fcpxml.js";
export { createWriteSrtTool } from "./write-srt.js";
