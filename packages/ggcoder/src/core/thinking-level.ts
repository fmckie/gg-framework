// Moved to @kleio/core. This shim re-exports it so existing relative
// imports (`./thinking-level.js`) keep resolving unchanged.
export {
  getSupportedThinkingLevels,
  isThinkingLevelSupported,
  getNextThinkingLevel,
  clampThinkingForPlanMode,
} from "@kleio/core";
