/**
 * What `POST /transcribe` answers when dictation's speech model can't be got
 * ready: a status code, and plain words that the chat box shows as they are.
 * The reason is a code from @kleio/core; what went wrong in detail is only in
 * the host's log.
 */

import { modelBytes, type DictationUnavailableError } from "@kleio/core";

export interface DictationReply {
  readonly status: 502 | 503;
  readonly error: string;
}

/** The host, in words: "the speech engine doesn't work on …". */
export function hostMachine(platform: string, arch: string): string {
  if (platform === "darwin") return arch === "x64" ? "a Mac with an Intel chip" : "this Mac";
  if (platform === "linux") return "this Linux computer";
  if (platform === "win32") return "this Windows PC";
  return "this computer";
}

export function dictationUnavailableReply(
  reason: DictationUnavailableError["reason"],
  host: { readonly platform: string; readonly arch: string } = process,
): DictationReply {
  switch (reason) {
    case "offline":
      return {
        status: 503,
        error:
          "Your host couldn't download the speech model. Check its internet connection, then try again.",
      };
    case "server":
      return {
        status: 502,
        error:
          "Hugging Face, where the speech model comes from, had a problem. Try again in a few minutes.",
      };
    case "missing":
      return {
        status: 503,
        error:
          "This version of Kleio asks for a speech model that's no longer available. Update Kleio on your host.",
      };
    case "storage":
      return {
        status: 503,
        error: `Your host couldn't save the speech model. It needs ${Math.round(modelBytes() / 1_000_000)} MB free, and Kleio must be able to write to its home folder.`,
      };
    case "integrity":
      return {
        status: 503,
        error:
          "The speech model download didn't match what Kleio expects, so it was thrown away. Try again.",
      };
    case "load":
      return { status: 503, error: "Your host couldn't start dictation. Its log says why." };
    case "unsupported":
      return {
        status: 503,
        error: `Your host can't run dictation: the speech engine doesn't work on ${hostMachine(host.platform, host.arch)}.`,
      };
  }
}
