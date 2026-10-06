/**
 * Jev, Typesafe's fast judgement model, through its System One API.
 *
 * `POST {base}/v1/systemone` with `{ model, state, questions }`: typed
 * questions about a JSON state, answered with probabilities in well under a
 * second. Two question types are used here: `choice` (pick one of named
 * criteria) and `noul` (how likely a statement is true).
 *
 * The API key comes from `apiKey()` (the host reads a key file or the
 * environment); without one every call fails fast with "not set up". Nothing
 * here retries: a caller that can't get an answer falls back to its own rule.
 */
import { readFile } from "node:fs/promises";
import { err, ok, type Result } from "./result.js";

export type JevQuestion =
  | {
      readonly type: "choice";
      readonly instructions: string;
      /** label → description. */
      readonly criteria: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "noul";
      readonly instructions: string;
      readonly criteria?: { readonly true?: string; readonly false?: string };
    };

export type JevAnswer =
  | {
      readonly type: "choice";
      readonly choice: string;
      /** label → probability, 0..1. */
      readonly probabilities: Readonly<Record<string, number>>;
    }
  | { readonly type: "noul"; readonly noul: number };

export interface JevOptions {
  /** The API key, read at each call; null when it isn't set up. */
  readonly apiKey: () => Promise<string | null>;
  /** Default https://api.typesafe.ai. */
  readonly baseUrl?: string;
  /** Default jev-latest. */
  readonly model?: string;
  readonly fetch?: typeof fetch;
  /** Per call. Default 10 s. */
  readonly timeoutMs?: number;
}

export interface Jev {
  ask(
    state: unknown,
    questions: Readonly<Record<string, JevQuestion>>,
    signal?: AbortSignal,
  ): Promise<Result<Record<string, JevAnswer>, string>>;
}

export const JEV_NOT_SET_UP = "not set up";
const DEFAULT_BASE = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Error bodies are echoed into the log: keep them short. */
const ERROR_CHARS = 200;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isProbability = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** One answer from the wire, or null when it isn't a well-formed choice/noul. */
export function parseAnswer(v: unknown): JevAnswer | null {
  if (!isRecord(v)) return null;
  if (v.type === "noul") return isProbability(v.noul) ? { type: "noul", noul: v.noul } : null;
  if (v.type !== "choice" || typeof v.choice !== "string" || !isRecord(v.probabilities))
    return null;
  const probabilities: Record<string, number> = {};
  for (const [label, p] of Object.entries(v.probabilities)) {
    if (!isProbability(p)) return null;
    probabilities[label] = p;
  }
  return { type: "choice", choice: v.choice, probabilities };
}

/** A key file's trimmed contents; null when it is missing or empty. */
export async function readKeyFile(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

export function createJev(options: JevOptions): Jev {
  const base = (options.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const model = options.model ?? DEFAULT_MODEL;
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async ask(state, questions, signal) {
      const key = await options.apiKey();
      if (!key) return err(JEV_NOT_SET_UP);
      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetchFn(`${base}/v1/systemone`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ model, state, questions }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (e) {
        return err(timeout.aborted ? `no answer in ${timeoutMs} ms` : `unreachable: ${String(e)}`);
      }
      const raw = await res.text().catch(() => "");
      if (!res.ok) return err(`HTTP ${res.status}: ${raw.slice(0, ERROR_CHARS)}`);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return err("the answer isn't JSON");
      }
      const answers = isRecord(body) ? body.answers : undefined;
      if (!isRecord(answers)) return err("the answer has no answers");
      const out: Record<string, JevAnswer> = {};
      for (const name of Object.keys(questions)) {
        const a = parseAnswer(answers[name]);
        if (!a || a.type !== questions[name]?.type) return err(`no valid answer to "${name}"`);
        out[name] = a;
      }
      return ok(out);
    },
  };
}
