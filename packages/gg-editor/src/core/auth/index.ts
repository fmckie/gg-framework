/**
 * gg-editor's auth surface. Single source of truth lives in
 * `@kleio/coder/auth` \u2014 we re-export it here so editor code keeps a
 * stable import path while the underlying OAuth flows, refresh logic, and
 * AuthStorage are exactly the ones Kleio Coder ships and exercises daily.
 *
 * Why re-export instead of fork: every previous fork (gg-editor 0.6.0\u20130.6.6)
 * accumulated regressions when small details drifted \u2014 wrong OpenAI
 * `originator`, missing 401 retry callback, broken Windows browser-open.
 * Importing keeps editor + coder bug-fix-symmetric forever.
 *
 * `types.ts` and `api-keys.ts` stay editor-local: provider lists and the
 * vision-tools API-key store are editor-specific concerns.
 */
export {
  AuthStorage,
  NotLoggedInError,
  loginAnthropic,
  loginOpenAI,
  refreshAnthropicToken,
  refreshOpenAIToken,
} from "@kleio/coder/auth";
export type { OAuthCredentials, OAuthLoginCallbacks } from "@kleio/coder/auth";

export { runLogin, runLogout, runStatus } from "./login.js";
export { STATIC_KEY_PROVIDERS, OAUTH_PROVIDERS } from "./types.js";
export type { SupportedAuthProvider } from "./types.js";
