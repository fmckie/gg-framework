// Lives in @kleio/core — re-exported here so ggcoder call sites import
// Grok OAuth the same way they import the other providers.
export {
  loginXai,
  refreshXaiToken,
  grokCliBaseUrl,
  grokCliHeaders,
  isGrokCliEndpoint,
} from "@kleio/core";
