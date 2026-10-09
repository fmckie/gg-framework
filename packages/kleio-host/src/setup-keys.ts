/**
 * Third-party API keys set from an admin device (GET/POST/DELETE /kleio/setup).
 *
 * Shared by the Composio and Typesafe key routes: the key's state for the
 * setup screen, its format, a check with the provider before it is saved,
 * and the 0600 key file. A key never appears in a returned detail: provider
 * text is redacted of it before it is kept.
 */
import { readFile } from "node:fs/promises";
import { atomicWrite } from "./device-registry.js";

/** "env": set by the environment/options (a key file would do nothing). */
export type KeyState = "missing" | "saved" | "env";

export type KeyCheckError =
  | { readonly kind: "bad_key" }
  | { readonly kind: "rejected"; readonly status: number; readonly detail: string }
  | { readonly kind: "unreachable"; readonly detail: string };

export const KEY_MAX = 512;
export const KEY_CHECK_TIMEOUT_MS = 15_000;
const DETAIL_CHARS = 200;

/** The trimmed key, or null when it is empty, too long or has whitespace. */
export function normalizeKey(raw: string): string | null {
  const k = raw.trim();
  return !k || k.length > KEY_MAX || /\s/.test(k) ? null : k;
}

export const envKeySet = (apiKey: string | undefined): boolean => !!apiKey?.trim();

export async function keyFileState(envKey: string | undefined, path: string): Promise<KeyState> {
  if (envKeySet(envKey)) return "env";
  try {
    return (await readFile(path, "utf8")).trim() ? "saved" : "missing";
  } catch {
    return "missing";
  }
}

/** `text` with every occurrence of the key removed, at most 200 characters. */
export function redactKey(text: string, key: string): string {
  return [...text.split(key).join("[key]")].slice(0, DETAIL_CHARS).join("");
}

/**
 * Ask the provider whether `key` works: null when it answered 2xx. 401/403 is
 * bad_key; other statuses "rejected"; a network error or timeout "unreachable".
 */
export async function checkKey(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  key: string,
): Promise<KeyCheckError | null> {
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS) });
  } catch (e) {
    return { kind: "unreachable", detail: redactKey(String((e as Error)?.message ?? e), key) };
  }
  const body = await res.text().catch(() => "");
  if (res.ok) return null;
  if (res.status === 401 || res.status === 403) return { kind: "bad_key" };
  return { kind: "rejected", status: res.status, detail: redactKey(body, key) };
}

/** Write the key file atomically, owner-only, with a trailing newline. */
export function saveKeyFile(path: string, key: string): Promise<void> {
  return atomicWrite(path, `${key}\n`, 0o600);
}
