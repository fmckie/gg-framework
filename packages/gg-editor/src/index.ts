// Tools
export { createEditorTools } from "./tools/index.js";
export type { CreateEditorToolsOptions } from "./tools/index.js";

// Hosts
export {
  createHost,
  detectHost,
  HostUnreachableError,
  HostUnsupportedError,
  NoneAdapter,
  PremiereAdapter,
  ResolveAdapter,
} from "./core/hosts/index.js";
export type { VideoHost } from "./core/hosts/index.js";
export { createLazyHost } from "./core/hosts/lazy.js";
export type { LazyHost, LazyHostOptions } from "./core/hosts/lazy.js";

// Media
export { checkFfmpeg, checkFfprobe, probeMedia, runFfmpeg } from "./core/media/ffmpeg.js";
export type { FfmpegResult, MediaProbe } from "./core/media/ffmpeg.js";

// Doctor / first-run onboarding
export { isOnboarded, onboardedMarkerPath, runDoctor } from "./core/doctor.js";
export type {
  CheckSeverity,
  CheckStatus,
  DoctorCheck,
  DoctorReport,
  InstallableHint,
} from "./core/doctor.js";
export { renderDoctorReport } from "./core/doctor-render.js";
export { runDoctorInteractive } from "./core/doctor-runner.js";
export type { DoctorRunOptions } from "./core/doctor-runner.js";

// System prompt
export {
  buildEditorSystemPrompt,
  buildEditorStaticBody,
  buildEditorHostBlock,
  spliceHostBlock,
} from "./system-prompt.js";
export type { StaticPromptOptions } from "./system-prompt.js";

// Auth (shared with Kleio Coder via ~/.gg/auth.json — implementations live in
// @kleio/coder/auth and are re-exported through ./core/auth/index.js)
export {
  AuthStorage,
  NotLoggedInError,
  loginAnthropic,
  loginOpenAI,
  refreshAnthropicToken,
  refreshOpenAIToken,
  runLogin,
  runLogout,
  runStatus,
} from "./core/auth/index.js";
export type {
  OAuthCredentials,
  OAuthLoginCallbacks,
  SupportedAuthProvider,
} from "./core/auth/index.js";

// Types
export type {
  ClipInfo,
  EditorConfig,
  Frame,
  FrameRange,
  HostCapabilities,
  HostName,
  MarkerInfo,
  TimelineState,
} from "./types.js";
