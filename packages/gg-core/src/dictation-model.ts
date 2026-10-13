/**
 * The speech model dictation runs, and Kleio's own download of it.
 *
 * Pinned to one commit of onnx-community/whisper-base.en. Each file is fetched
 * from that commit, written to `<file>.part` while it is hashed, and renamed
 * into place only once its size and SHA-256 match the list below. A `.part` an
 * earlier try left behind is picked up with a Range request. Once every file
 * checks out, a marker records them, so later starts know the model is whole
 * from a few stats instead of hashing it again.
 *
 * The files sit where transformers.js put them when it downloaded the model
 * itself (`<models>/onnx-community/whisper-base.en/<file>`), so a host that
 * already has them gets them checked, not downloaded again.
 */

import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

export interface ModelFile {
  /** Its path in the model's folder, "/"-separated as on the Hub. */
  readonly path: string;
  readonly size: number;
  /** SHA-256, lowercase hex. */
  readonly sha256: string;
}

export interface SpeechModel {
  /** The Hub id, which is also its folder under the models directory. */
  readonly id: string;
  /** The commit every file is fetched from. */
  readonly revision: string;
  readonly files: readonly ModelFile[];
}

/**
 * English Whisper "base": the seven files transformers.js reads for it, with a
 * full-precision encoder (the accuracy) and an 8-bit decoder (the speed).
 * Pinned 13 Oct 2026 to the repo's latest commit (last changed 8 Oct 2024);
 * the ONNX hashes are the Hub's own LFS records.
 */
export const WHISPER_MODEL = {
  id: "onnx-community/whisper-base.en",
  revision: "51eefc0af78b103839eda9e7e4f4186acc6517fe",
  files: [
    {
      path: "config.json",
      size: 2_197,
      sha256: "c8a0de5ed8a083565a4319db29d0c210fda35b4d6076c2d711cae53ae00f3cb1",
    },
    {
      path: "generation_config.json",
      size: 1_556,
      sha256: "3479b1f44a07e41db799e22599222fee5816738036def94a39841cb9cdbb4120",
    },
    {
      path: "preprocessor_config.json",
      size: 339,
      sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
    },
    {
      path: "tokenizer.json",
      size: 2_405_679,
      sha256: "5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0",
    },
    {
      path: "tokenizer_config.json",
      size: 282_662,
      sha256: "93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c",
    },
    {
      path: "onnx/encoder_model.onnx",
      size: 82_468_078,
      sha256: "1cc86302d480b061452d348638064383ab41b6f3333ddd0e423532d14edaf535",
    },
    {
      path: "onnx/decoder_model_merged_quantized.onnx",
      size: 53_692_803,
      sha256: "dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909",
    },
  ],
} as const satisfies SpeechModel;

export const HUGGING_FACE_URL = "https://huggingface.co";

/** Why the model couldn't be downloaded. `detail` is for the host's log only. */
export type ModelDownloadError =
  /** No answer from the Hub: no network, DNS, a dropped or stalled connection. */
  | { readonly kind: "offline"; readonly detail: string }
  /** The Hub answered with an error of its own (5xx, 429, anything unexpected). */
  | { readonly kind: "server"; readonly status: number }
  /** The pinned commit or a file in it is gone from the Hub. */
  | { readonly kind: "missing"; readonly status: number }
  /** This machine couldn't hold or write the files: free space, permissions, a read-only disk. */
  | { readonly kind: "storage"; readonly detail: string }
  /** A file's bytes didn't match the pin, so they were thrown away. */
  | { readonly kind: "integrity"; readonly file: string }
  /** Stopped by the caller's signal. */
  | { readonly kind: "aborted" };

export type ModelDownloadResult =
  { readonly ok: true } | { readonly ok: false; readonly error: ModelDownloadError };

export interface ModelDownloadOptions {
  /** Defaults to Whisper base (tests use a small one). */
  readonly model?: SpeechModel;
  readonly fetch?: typeof fetch;
  /** Stops the download; a `.part` file stays for next time. */
  readonly signal?: AbortSignal;
  /** Free bytes on the disk holding `dir` (default: the file system's own count). */
  readonly freeBytes?: (dir: string) => Promise<number>;
  /** Bytes of the model in place so far, and its size. Never goes down. */
  readonly onProgress?: (loaded: number, total: number) => void;
  /** The Hub's address (tests). */
  readonly baseUrl?: string;
  /** Clock for the stale-temp-file rule (tests). */
  readonly now?: () => number;
  /** Give up on a connection that sends nothing for this long. */
  readonly stallMs?: number;
}

const MARKER = ".kleio-verified.json";
const STALL_MS = 30_000;
/**
 * transformers.js's own downloads go to `<file>.tmp.<pid>.<random>` and are
 * renamed when done; a killed download leaves one behind. Kleio Coder on the
 * same machine may share the models folder and be mid-download, so only files
 * untouched for an hour are removed.
 */
const STALE_TEMP_MS = 60 * 60 * 1000;
const TEMP_FILE = /\.tmp\.\d+\.-?[0-9a-z]+$/;

/** The whole model, in bytes. */
export function modelBytes(model: SpeechModel = WHISPER_MODEL): number {
  return model.files.reduce((n, f) => n + f.size, 0);
}

/** The model's folder: `<modelsDir>/<hub id>`. */
export function modelDir(modelsDir: string, model: SpeechModel = WHISPER_MODEL): string {
  return path.join(path.resolve(modelsDir), ...model.id.split("/"));
}

/**
 * Where one of the model's files lives. Paths come from the manifest, never a
 * request; one that would leave the model's folder is a bug.
 */
function fileTarget(dir: string, file: ModelFile): string {
  const parts = file.path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || /[\\:]/.test(p))) {
    throw new Error(`bad model file path: ${file.path}`);
  }
  return path.join(dir, ...parts);
}

function fileUrl(baseUrl: string, model: SpeechModel, file: ModelFile): string {
  const seg = (s: string): string => s.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${seg(model.id)}/resolve/${seg(model.revision)}/${seg(file.path)}`;
}

interface Marker {
  revision: string;
  files: Record<string, { size: number; mtimeMs: number }>;
}

function isMarker(value: unknown): value is Marker {
  if (typeof value !== "object" || value === null) return false;
  const { revision, files } = value as { revision?: unknown; files?: unknown };
  if (typeof revision !== "string" || typeof files !== "object" || files === null) return false;
  return Object.values(files).every(
    (f: unknown) =>
      typeof f === "object" &&
      f !== null &&
      typeof (f as { size?: unknown }).size === "number" &&
      typeof (f as { mtimeMs?: unknown }).mtimeMs === "number",
  );
}

/**
 * Whether the model was downloaded and checked, and hasn't changed since: the
 * marker's commit, and each file's size and modified time. A few stats, no
 * hashing.
 */
export async function verifiedOnDisk(
  modelsDir: string,
  model: SpeechModel = WHISPER_MODEL,
): Promise<boolean> {
  const dir = modelDir(modelsDir, model);
  let marker: unknown;
  try {
    marker = JSON.parse(await fs.readFile(path.join(dir, MARKER), "utf8"));
  } catch {
    return false;
  }
  if (!isMarker(marker) || marker.revision !== model.revision) return false;
  for (const file of model.files) {
    const seen = Object.hasOwn(marker.files, file.path) ? marker.files[file.path] : undefined;
    if (!seen || seen.size !== file.size) return false;
    const stat = await fs.stat(fileTarget(dir, file)).catch(() => null);
    if (!stat?.isFile() || stat.size !== file.size || stat.mtimeMs !== seen.mtimeMs) return false;
  }
  return true;
}

/**
 * Remove transformers.js's leftover temp files (see STALE_TEMP_MS) from the
 * model's own folders. Symlinks are left alone. Returns how many went.
 */
export async function removeStaleTempFiles(
  modelsDir: string,
  options: { model?: SpeechModel; now?: number; maxAgeMs?: number } = {},
): Promise<number> {
  const model = options.model ?? WHISPER_MODEL;
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STALE_TEMP_MS;
  const dir = modelDir(modelsDir, model);
  const folders = [...new Set(model.files.map((f) => path.dirname(fileTarget(dir, f))))].sort();
  let removed = 0;
  for (const folder of folders) {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      // A Dirent is never a file for a symlink.
      if (!entry.isFile() || !TEMP_FILE.test(entry.name)) continue;
      const file = path.join(folder, entry.name);
      const stat = await fs.lstat(file).catch(() => null);
      if (!stat?.isFile() || now - stat.mtimeMs < maxAgeMs) continue;
      if (
        await fs.rm(file, { force: true }).then(
          () => true,
          () => false,
        )
      )
        removed += 1;
    }
  }
  return removed;
}

/** A file-system failure, kept apart from network ones so it reads as `storage`. */
class StorageFailure extends Error {
  constructor(readonly original: unknown) {
    super(describe(original));
  }
}

/** A Hub answer that ends this file's download. */
class HubAnswer extends Error {
  constructor(readonly error: ModelDownloadError) {
    super(error.kind);
  }
}

function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as { code?: unknown }).code;
  const cause = e.cause instanceof Error ? `: ${describe(e.cause)}` : "";
  return `${typeof code === "string" ? `${code} ` : ""}${e.message}${cause}`;
}

/** Run a file-system step; its failure is `storage`. */
async function disk<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    throw new StorageFailure(e);
  }
}

/** A write can take less than it was given; loop until it has it all. */
async function writeAll(handle: FileHandle, data: Uint8Array): Promise<void> {
  let at = 0;
  while (at < data.byteLength) {
    const { bytesWritten } = await handle.write(data, at, data.byteLength - at);
    at += bytesWritten;
  }
}

async function sizeOf(file: string): Promise<number> {
  const stat = await fs.stat(file).catch(() => null);
  return stat?.isFile() ? stat.size : 0;
}

async function hashInto(hash: Hash, file: string, signal?: AbortSignal): Promise<void> {
  const stream = createReadStream(file);
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      hash.update(chunk as Buffer);
    }
  } finally {
    stream.destroy();
  }
}

/** Whether `file` holds exactly the manifest's bytes. */
async function matches(file: string, expected: ModelFile, signal?: AbortSignal): Promise<boolean> {
  if ((await sizeOf(file)) !== expected.size) return false;
  const hash = createHash("sha256");
  await disk(() => hashInto(hash, file, signal));
  return hash.digest("hex") === expected.sha256;
}

/** `bytes <start>-<end>/<total>` → start and total. */
function contentRange(header: string | null): { start: number; total: number } | null {
  const m = /^bytes (\d+)-\d+\/(\d+)$/.exec(header?.trim() ?? "");
  return m ? { start: Number(m[1]), total: Number(m[2]) } : null;
}

function hubError(status: number): ModelDownloadError {
  // The Hub answers 401 for a repo that doesn't exist, 404 for a lost commit or file.
  return [401, 403, 404, 410].includes(status)
    ? { kind: "missing", status }
    : { kind: "server", status };
}

/** One signal for the caller's stop and the stall timer, without AbortSignal.any (Node 20+). */
function linkedAbort(signal: AbortSignal | undefined): {
  signal: AbortSignal;
  stall: () => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  const stop = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return {
    signal: controller.signal,
    stall: () => controller.abort(new Error("stalled")),
    dispose: () => signal?.removeEventListener("abort", stop),
  };
}

interface FileJob {
  readonly dir: string;
  readonly model: SpeechModel;
  readonly file: ModelFile;
  readonly fetch: typeof fetch;
  readonly baseUrl: string;
  readonly signal: AbortSignal | undefined;
  readonly stallMs: number;
  /** Bytes of this file on disk so far (a resumed `.part` counts at once). */
  readonly progress: (bytes: number) => void;
}

/**
 * Fetch one file into place. Resumes a `.part`, starts over when the Hub
 * can't (a 200 or 416 to a Range request, or a range that doesn't line up),
 * and never lets the file grow past its size. Throws HubAnswer for a Hub
 * error, StorageFailure for the disk, anything else for the network.
 */
async function fetchFile(job: FileJob): Promise<void> {
  const { file } = job;
  const target = fileTarget(job.dir, file);
  const part = `${target}.part`;
  await disk(() => fs.mkdir(path.dirname(target), { recursive: true }));
  // At most one start-over: a second would mean the Hub keeps contradicting itself.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let offset = await sizeOf(part);
    if (offset >= file.size) {
      // A finished `.part` the last try didn't get to rename.
      if (await matches(part, file, job.signal)) {
        await disk(() => fs.rename(part, target));
        job.progress(file.size);
        return;
      }
      await disk(() => fs.rm(part, { force: true }));
      offset = 0;
    }
    let hash = createHash("sha256");
    if (offset > 0) {
      await disk(() => hashInto(hash, part, job.signal));
      job.progress(offset);
    }

    const linked = linkedAbort(job.signal);
    let timer = setTimeout(linked.stall, job.stallMs);
    const alive = (): void => {
      clearTimeout(timer);
      timer = setTimeout(linked.stall, job.stallMs);
    };
    try {
      const res = await job.fetch(fileUrl(job.baseUrl, job.model, file), {
        headers: {
          // Ranges count raw bytes; a compressed answer would shift them.
          "accept-encoding": "identity",
          "user-agent": "Kleio dictation model download",
          ...(offset > 0 ? { range: `bytes=${offset}-` } : {}),
        },
        signal: linked.signal,
      });
      alive();
      const range = res.status === 206 ? contentRange(res.headers.get("content-range")) : null;
      const startOver =
        offset > 0 &&
        (res.status === 416 ||
          (res.status === 206 && (range?.start !== offset || range.total !== file.size)));
      if (startOver) {
        await res.body?.cancel().catch(() => undefined);
        await disk(() => fs.rm(part, { force: true }));
        continue;
      }
      if (!(res.status === 200 || (res.status === 206 && offset > 0))) {
        await res.body?.cancel().catch(() => undefined);
        throw new HubAnswer(hubError(res.status));
      }
      if (res.status === 200) {
        // The whole file, whatever was asked for.
        offset = 0;
        hash = createHash("sha256");
        const length = res.headers.get("content-length");
        if (length !== null && Number(length) !== file.size) {
          await res.body?.cancel().catch(() => undefined);
          throw new HubAnswer({ kind: "integrity", file: file.path });
        }
      }
      const body = res.body;
      if (!body) throw new HubAnswer({ kind: "server", status: res.status });

      const handle = await disk(() => fs.open(part, offset > 0 ? "a" : "w"));
      let written = offset;
      let tooBig = false;
      try {
        const reader = body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          alive();
          if (written + value.byteLength > file.size) {
            tooBig = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          hash.update(value);
          await disk(() => writeAll(handle, value));
          written += value.byteLength;
          job.progress(written);
        }
        await disk(() => handle.sync());
      } finally {
        await handle.close().catch(() => undefined);
      }
      if (tooBig) {
        await disk(() => fs.rm(part, { force: true }));
        throw new HubAnswer({ kind: "integrity", file: file.path });
      }
      // Ended early without an error: the `.part` stays, to pick up from.
      if (written < file.size) throw new Error(`connection ended at ${written} of ${file.size}`);
      if (hash.digest("hex") !== file.sha256) {
        await disk(() => fs.rm(part, { force: true }));
        throw new HubAnswer({ kind: "integrity", file: file.path });
      }
      await disk(() => fs.rename(part, target));
      return;
    } catch (e) {
      // The stall timer stopped a quiet connection: a network failure, not the caller's stop.
      if (linked.signal.aborted && !job.signal?.aborted) {
        throw new Error(`no data for ${Math.round(job.stallMs / 1000)} s`, { cause: e });
      }
      throw e;
    } finally {
      clearTimeout(timer);
      linked.dispose();
    }
  }
  throw new HubAnswer({ kind: "server", status: 416 });
}

async function writeMarker(dir: string, model: SpeechModel): Promise<void> {
  const files: Marker["files"] = {};
  for (const file of model.files) {
    const stat = await fs.stat(fileTarget(dir, file));
    files[file.path] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  const marker: Marker = { revision: model.revision, files };
  const temp = path.join(dir, `${MARKER}.${process.pid}.new`);
  await fs.writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`);
  await fs.rename(temp, path.join(dir, MARKER));
}

async function statfsFree(dir: string): Promise<number> {
  const s = await fs.statfs(dir);
  return s.bavail * s.bsize;
}

/**
 * Get the model into `<modelsDir>/<id>`: check the files already there, check
 * there's room for the rest, then fetch each missing one from the pinned
 * commit, and finally write the marker. Expected failures come back as
 * results; nothing is put in place that didn't match the pin.
 */
export async function downloadModel(
  modelsDir: string,
  options: ModelDownloadOptions = {},
): Promise<ModelDownloadResult> {
  const model = options.model ?? WHISPER_MODEL;
  const signal = options.signal;
  const dir = modelDir(modelsDir, model);
  const total = modelBytes(model);
  let reported = 0;
  const report = (loaded: number): void => {
    const next = Math.min(loaded, total);
    if (next <= reported) return;
    reported = next;
    options.onProgress?.(next, total);
  };

  try {
    signal?.throwIfAborted();
    await disk(() => fs.mkdir(dir, { recursive: true }));
    await removeStaleTempFiles(modelsDir, {
      model,
      now: (options.now ?? Date.now)(),
    });

    // What a first look says is here: a file of the right size, or part of one.
    const present = new Map<string, number>();
    for (const file of model.files) {
      const target = fileTarget(dir, file);
      const whole = (await sizeOf(target)) === file.size;
      const part = whole ? 0 : await sizeOf(`${target}.part`);
      present.set(file.path, whole ? file.size : part < file.size ? part : 0);
    }
    const needed = model.files.reduce((n, f) => n + f.size - (present.get(f.path) ?? 0), 0);
    if (needed > 0) {
      const free = await (options.freeBytes ?? statfsFree)(dir).catch(() => Infinity);
      if (free < needed) {
        return {
          ok: false,
          error: { kind: "storage", detail: `needs ${needed} bytes free, has ${free}` },
        };
      }
    }

    // Files already in place are checked, then count straight away.
    let done = 0;
    const missing: ModelFile[] = [];
    for (const file of model.files) {
      if (
        present.get(file.path) === file.size &&
        (await matches(fileTarget(dir, file), file, signal))
      ) {
        done += file.size;
        report(done);
      } else {
        missing.push(file);
      }
    }

    for (const file of missing) {
      const base = done;
      await fetchFile({
        dir,
        model,
        file,
        fetch: options.fetch ?? fetch,
        baseUrl: options.baseUrl ?? HUGGING_FACE_URL,
        signal,
        stallMs: options.stallMs ?? STALL_MS,
        progress: (bytes) => report(base + bytes),
      });
      done += file.size;
      report(done);
    }

    await disk(() => writeMarker(dir, model));
    return { ok: true };
  } catch (e) {
    if (signal?.aborted) return { ok: false, error: { kind: "aborted" } };
    if (e instanceof HubAnswer) return { ok: false, error: e.error };
    if (e instanceof StorageFailure) {
      return { ok: false, error: { kind: "storage", detail: e.message } };
    }
    return { ok: false, error: { kind: "offline", detail: describe(e) } };
  }
}
