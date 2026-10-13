/**
 * A stand-in for Hugging Face in tests: a loopback HTTP server that serves a
 * test model's files from memory at `/<id>/resolve/<revision>/<path>`, and
 * answers Range requests the way the Hub does. A test can answer any request
 * its own way instead; every request is recorded.
 */

import { createHash } from "node:crypto";
import http from "node:http";
import type { ModelFile, SpeechModel } from "../dictation-model.js";

export interface TestModel {
  readonly model: SpeechModel;
  /** Each file's bytes, by its path in the model. */
  readonly contents: ReadonlyMap<string, Buffer>;
}

/** A model made of `files` (path → bytes, in download order), with a manifest that matches. */
export function testModel(
  files: Readonly<Record<string, Buffer>>,
  options: { readonly id?: string; readonly revision?: string } = {},
): TestModel {
  const contents = new Map(Object.entries(files));
  const manifest: ModelFile[] = [...contents].map(([filePath, data]) => ({
    path: filePath,
    size: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"),
  }));
  return {
    model: {
      id: options.id ?? "test-org/test-model",
      revision: options.revision ?? "c0ffee00",
      files: manifest,
    },
    contents,
  };
}

/** `size` bytes with no short repeats, the same on every run. */
export function testBytes(size: number, seed = 1): Buffer {
  const out = Buffer.alloc(size);
  let x = seed >>> 0;
  for (let i = 0; i < size; i += 1) {
    x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

/** A file's bytes; a test asking for a file its model doesn't have is a bug. */
export function bytesOf(test: TestModel, file: string): Buffer {
  const data = test.contents.get(file);
  if (!data) throw new Error(`the test model has no ${file}`);
  return data;
}

export interface HubRequest {
  /** The requested file's path in the model; "" for any other URL. */
  readonly file: string;
  /** The Range header, if any. */
  readonly range: string | null;
}

/** How to answer one request. */
export type HubAnswer =
  /** As the Hub does: the file, from a Range's start with a 206 when one is asked for. */
  | { readonly kind: "serve" }
  /** The whole file with a 200, whatever the Range. */
  | { readonly kind: "whole" }
  /** An error status and no body. */
  | { readonly kind: "status"; readonly status: number }
  /** A 200 with these bytes, with a Content-Length only when `sized`. */
  | { readonly kind: "body"; readonly body: Buffer; readonly sized?: boolean }
  /** As "serve", but only the first `after` bytes of the body, then nothing. */
  | { readonly kind: "stall"; readonly after: number };

export interface FakeHub {
  /** For downloadModel's `baseUrl`. */
  readonly baseUrl: string;
  /** Every request so far, in order. */
  readonly requests: readonly HubRequest[];
  /** Cut every open connection, as a dropped network would. */
  dropConnections(): void;
  close(): Promise<void>;
}

const RANGE = /^bytes=(\d+)-$/;

export async function startFakeHub(
  test: TestModel,
  answer: (request: HubRequest, index: number) => HubAnswer = () => ({ kind: "serve" }),
): Promise<FakeHub> {
  const requests: HubRequest[] = [];
  const prefix = `/${test.model.id}/resolve/${test.model.revision}/`;
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url ?? "/", "http://hub.test").pathname);
    const request: HubRequest = {
      file: url.startsWith(prefix) ? url.slice(prefix.length) : "",
      range: req.headers.range ?? null,
    };
    requests.push(request);
    const how = answer(request, requests.length - 1);

    if (how.kind === "status") {
      res.writeHead(how.status).end();
      return;
    }
    if (how.kind === "body") {
      res.writeHead(200, how.sized ? { "content-length": String(how.body.byteLength) } : {});
      // A write before end() with no length streams the body chunked.
      res.write(how.body);
      res.end();
      return;
    }
    const data = test.contents.get(request.file);
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    const range = how.kind === "whole" ? null : RANGE.exec(request.range ?? "");
    const start = range ? Number(range[1]) : 0;
    if (start >= data.byteLength && range) {
      res.writeHead(416, { "content-range": `bytes */${data.byteLength}` }).end();
      return;
    }
    const body = data.subarray(start);
    res.writeHead(range ? 206 : 200, {
      "content-length": String(body.byteLength),
      ...(range
        ? { "content-range": `bytes ${start}-${data.byteLength - 1}/${data.byteLength}` }
        : {}),
    });
    if (how.kind === "stall") {
      res.write(body.subarray(0, how.after));
      return;
    }
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the fake hub has no port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    dropConnections: () => server.closeAllConnections(),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
