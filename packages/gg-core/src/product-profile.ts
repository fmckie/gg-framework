import type { ErrorDisplayOptions } from "@kleio/ai";

/** User-visible identity plus frozen compatibility identifiers for the Kleio fork. */
export const KLEIO_PRODUCT_PROFILE = {
  brandName: "Kleio",
  bugReportUrl: "https://github.com/fmckie/gg-framework/issues",
  coder: {
    displayName: "Kleio Coder",
    preferredCommand: "kleio-coder",
    legacyCommand: "ggcoder",
    httpUserAgent: "KleioCoder/1.0",
    legacyHttpUserAgent: "Mozilla/5.0 (compatible; GGCoder/1.0)",
    mcpClientName: "kleio-coder",
    legacyMcpClientName: "ggcoder",
    agentHomeId: "ggcoder",
  },
  manager: {
    displayName: "Kleio Manager",
    preferredCommand: "kleio-manager",
    legacyCommand: "ggboss",
  },
} as const;

export const KLEIO_CODER_ERROR_DISPLAY: ErrorDisplayOptions = {
  productName: KLEIO_PRODUCT_PROFILE.coder.displayName,
  loginCommand: `${KLEIO_PRODUCT_PROFILE.coder.preferredCommand} login`,
  bugReportUrl: KLEIO_PRODUCT_PROFILE.bugReportUrl,
};

export const KLEIO_MANAGER_ERROR_DISPLAY: ErrorDisplayOptions = {
  productName: KLEIO_PRODUCT_PROFILE.manager.displayName,
  loginCommand: `${KLEIO_PRODUCT_PROFILE.coder.preferredCommand} login`,
  bugReportUrl: KLEIO_PRODUCT_PROFILE.bugReportUrl,
};

/** Resolve a preferred environment variable before one or more legacy aliases. */
export function resolveEnvironmentAlias(
  environment: Readonly<Record<string, string | undefined>>,
  preferredName: string,
  legacyNames: string | readonly string[],
): string | undefined {
  for (const name of [
    preferredName,
    ...(typeof legacyNames === "string" ? [legacyNames] : legacyNames),
  ]) {
    const value = environment[name];
    if (value !== undefined) return value;
  }
  return undefined;
}
