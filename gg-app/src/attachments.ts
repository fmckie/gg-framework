import type { Attachment } from "./agent";

/** A staged attachment in the input, with a local preview URL for images. */
export interface PendingAttachment extends Attachment {
  id: number;
  /** Object/data URL for inline image preview (images only). */
  previewUrl?: string;
}

let seq = 0;
const nextId = (): number => ++seq;

function kindForType(mime: string): Attachment["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

/** Read a browser File/Blob (clipboard paste, <input type=file>) into a pending
 *  attachment with base64 data and an image preview URL. */
export function fileToPending(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // data:<mime>;base64,<data> — strip the prefix for the raw payload.
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      const mediaType = file.type || "application/octet-stream";
      const kind = kindForType(mediaType);
      resolve({
        id: nextId(),
        kind,
        name: file.name || `pasted.${mediaType.split("/")[1] ?? "bin"}`,
        mediaType,
        data,
        previewUrl: kind === "image" ? result : undefined,
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Most attachment data one message can carry, in file bytes (decimal MB, as
 *  Finder shows sizes). Attachments travel as base64, a third larger than the
 *  file, inside a request body that is refused over 10 MiB by the sidecar
 *  (`MAX_HTTP_BODY_BYTES` in @kleio/coder's src/utils/http-body.ts) and over
 *  8 MiB by a paired Kleio host's proxy (`PROXY_BODY_MAX`,
 *  packages/kleio-host/src/host.ts). 6 MB of files encodes to 8 MB, which fits
 *  both with room left for the message text. */
const MAX_ATTACHMENT_BYTES = 6_000_000;

/** Size of the file behind an attachment's base64 `data`. */
function attachmentBytes(a: Attachment): number {
  const padding = a.data.endsWith("==") ? 2 : a.data.endsWith("=") ? 1 : 0;
  return Math.floor((a.data.length * 3) / 4) - padding;
}

/** Why these attachments can't go in one message, or null when they fit. The
 *  composer checks before sending, since an oversized message never arrives. */
export function oversizedAttachmentsMessage(attachments: readonly Attachment[]): string | null {
  const total = attachments.reduce((sum, a) => sum + attachmentBytes(a), 0);
  if (total <= MAX_ATTACHMENT_BYTES) return null;
  const sizes =
    `(${(total / 1_000_000).toFixed(1)} MB; ` +
    `a message can carry up to ${MAX_ATTACHMENT_BYTES / 1_000_000} MB)`;
  const [only] = attachments;
  return attachments.length === 1 && only
    ? `${only.name} is too large to send ${sizes}. ` +
        "Remove it and mention the file's path in your message instead."
    : `These attachments are too large to send together ${sizes}. ` +
        "Remove some and mention their file paths in your message instead.";
}

/** Strip the preview/id fields before sending over IPC. */
export function toWire(a: PendingAttachment): Attachment {
  return { kind: a.kind, name: a.name, mediaType: a.mediaType, data: a.data };
}

/** Stage an already-decoded Attachment (e.g. base64 read natively from a
 *  dropped file's path, which has no browser File object) as a pending
 *  attachment — same shape `fileToPending` builds from a File, so a native
 *  drop attaches identically to a paste/picker file. */
export function attachmentToPending(a: Attachment): PendingAttachment {
  return {
    ...a,
    id: nextId(),
    previewUrl: a.kind === "image" ? `data:${a.mediaType};base64,${a.data}` : undefined,
  };
}
