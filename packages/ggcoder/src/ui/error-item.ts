import { formatError } from "@kleio/ai";
import { KLEIO_CODER_ERROR_DISPLAY } from "@kleio/core";
import { log } from "../core/logger.js";
import type { ErrorItem } from "./app-items.js";

/** Build a consistently classified, Kleio-aware ErrorItem from any thrown value. */
export function toErrorItem(err: unknown, id: string, contextPrefix?: string): ErrorItem {
  const f = formatError(err, KLEIO_CODER_ERROR_DISPLAY);
  const headline = contextPrefix ? `${contextPrefix} — ${f.headline}` : f.headline;
  const guidance = f.guidance;

  log("ERROR", "ui-error", headline, {
    source: f.source,
    message: f.message,
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.statusCode != null ? { statusCode: String(f.statusCode) } : {}),
    ...(f.requestId ? { requestId: f.requestId } : {}),
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
  });

  return {
    kind: "error",
    headline,
    message: f.message,
    guidance,
    id,
  };
}
