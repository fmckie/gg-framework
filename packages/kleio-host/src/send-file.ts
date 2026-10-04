// Stream a file that files.ts resolved, shared by the API's file routes and
// the preview origin. Each caller chooses its own headers.

import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AgentFile } from "./files.js";

export interface SendFileOptions {
  /** Headers for a 200; content-length is added. */
  readonly headers: Readonly<Record<string, string>>;
  /** Answer when the file is gone or was swapped since it was resolved. */
  readonly missing: (res: ServerResponse) => void;
  /** HEAD: headers only. */
  readonly head?: boolean;
}

/**
 * Open the file before any header goes out (so a vanished file is still a
 * clean 404), read at most `size` bytes, and cut the connection rather than
 * end short if the file shrank meanwhile. Returns [status, file bytes sent].
 */
export async function sendFile(
  res: ServerResponse,
  file: AgentFile,
  options: SendFileOptions,
): Promise<[number, number]> {
  let fh;
  try {
    // O_NOFOLLOW: the last component may not have become a symlink since it
    // was resolved; O_NONBLOCK: a FIFO swapped in can't hang the open. Both
    // are undefined, so 0, on Windows.
    fh = await open(
      file.path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch {
    options.missing(res);
    return [404, 0];
  }
  // Still the regular file that was resolved, not something swapped in since.
  const same = await fh.stat().then(
    (st) => st.isFile() && st.size === file.size && st.mtimeMs === file.mtimeMs,
    () => false,
  );
  if (!same) {
    await fh.close();
    options.missing(res);
    return [404, 0];
  }
  res.writeHead(200, { ...options.headers, "content-length": String(file.size) });
  if (file.size === 0 || options.head) {
    await fh.close();
    res.end();
    return [200, 0];
  }
  let sent = 0;
  try {
    await pipeline(
      fh.createReadStream({ start: 0, end: file.size - 1 }),
      new Transform({
        transform(chunk: Buffer, _enc, done): void {
          sent += chunk.length;
          done(null, chunk);
        },
        flush(done): void {
          done(sent === file.size ? null : new Error("file shrank while sending"));
        },
      }),
      res,
    );
  } catch {
    res.destroy();
  }
  return [200, sent];
}
