/**
 * Provider-level diagnostic hook. Mirrors the pattern used by @kleio/agent's
 * setStreamDiagnostic — the host app wires a callback (typically writing to
 * a debug log) and providers call `providerDiag(...)` to record interesting
 * lifecycle events (e.g. raw SSE event types and timings).
 */
export type ProviderDiagnosticFn = (phase: string, data?: Record<string, unknown>) => void;

let _diagFn: ProviderDiagnosticFn | null = null;

/** Register a diagnostic callback for provider-level tracing. */
export function setProviderDiagnostic(fn: ProviderDiagnosticFn | null): void {
  _diagFn = fn;
}

export function providerDiag(phase: string, data?: Record<string, unknown>): void {
  _diagFn?.(phase, data);
}
