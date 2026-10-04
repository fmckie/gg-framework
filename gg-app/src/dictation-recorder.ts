// iPhone dictation, the recording half: capture the microphone in the webview
// and hand back 16 kHz mono 16-bit PCM, the format Whisper takes. The paired
// Mac's sidecar transcribes it (`POST /transcribe`, @kleio/core dictation.ts).
//
// WKWebView serves the app from `tauri://localhost`, which WebKit treats as a
// secure context, so getUserMedia works there; iOS asks for permission with
// the NSMicrophoneUsageDescription text on first use.

export const DICTATION_SAMPLE_RATE = 16_000;
/** The sidecar's limit, so a long recording stops itself rather than failing. */
export const DICTATION_MAX_MS = 120_000;

/** The recording timer's label: "0:07", "1:59". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Linear-interpolation resample from the microphone's rate to 16 kHz. */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === DICTATION_SAMPLE_RATE || input.length === 0) return input;
  const ratio = fromRate / DICTATION_SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const a = input[left] ?? 0;
    const b = input[left + 1] ?? a;
    out[i] = a + (b - a) * (pos - left);
  }
  return out;
}

/** Float samples to base64 16-bit little-endian PCM. */
export function encodePcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(i * 2, Math.round(clamped * 32_767), true);
  }
  // Chunked: one String.fromCharCode over megabytes overflows the call stack.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export interface Recording {
  /** Stop and return the clip as base64 16 kHz mono 16-bit PCM. */
  stop(): Promise<string>;
  /** Stop and throw the audio away. */
  cancel(): void;
}

export type RecordingStart =
  { ok: true; value: Recording } | { ok: false; error: "unsupported" | "denied" | "unavailable" };

/** Ask for the microphone and start capturing. */
export async function startRecording(): Promise<RecordingStart> {
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return { ok: false, error: "unsupported" };
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    const denied = err instanceof DOMException && err.name === "NotAllowedError";
    return { ok: false, error: denied ? "denied" : "unavailable" };
  }

  // The context runs at the hardware rate: WebKit refuses a microphone whose
  // rate differs from the context's, so `stop()` resamples to 16 kHz instead.
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated, but an AudioWorklet module would have
  // to load from the custom scheme; this node is supported and enough for a
  // single mono capture.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  // The node only runs while connected to the output; it writes silence.
  processor.connect(ctx.destination);
  if (ctx.state === "suspended") await ctx.resume();

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void ctx.close();
  };

  return {
    ok: true,
    value: {
      async stop() {
        const rate = ctx.sampleRate;
        release();
        let total = 0;
        for (const c of chunks) total += c.length;
        const merged = new Float32Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        return encodePcm16Base64(resampleTo16k(merged, rate));
      },
      cancel: release,
    },
  };
}
