// How loud Kleio and you are right now, for the orb: a Web Audio analyser on
// her incoming voice and one on your microphone. Measures only: her voice is
// still played by the call's <audio> element, and nothing is recorded.

/** A level reader: 0 (silence) to 1 (loud speech), smoothed. */
export interface LevelMeter {
  read(): number;
  stop(): void;
}

/** Speech sits around -40..-10 dBFS; this maps that range onto 0..1. */
const FLOOR_DB = -60;
const CEIL_DB = -12;

/** Loudness of one frame of samples (-1..1), as 0..1. */
export function levelOf(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
}

/**
 * Meters a live stream. Rises fast and falls slowly, like a VU needle, so the
 * orb swells on a word and settles between them rather than flickering.
 * Null when this device has no Web Audio.
 */
export function meterStream(stream: MediaStream): LevelMeter | null {
  const Ctx = typeof AudioContext !== "undefined" ? AudioContext : undefined;
  if (!Ctx || stream.getAudioTracks().length === 0) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser); // Not to the speakers: the <audio> element plays it.
  const buffer = new Float32Array(analyser.fftSize);
  let level = 0;
  let stopped = false;
  // Started by the user's click, but resume in case it was created suspended.
  void ctx.resume().catch(() => {});
  return {
    read() {
      if (stopped) return 0;
      analyser.getFloatTimeDomainData(buffer);
      const now = levelOf(buffer);
      level = now > level ? level + (now - level) * 0.6 : level + (now - level) * 0.12;
      return level;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      source.disconnect();
      void ctx.close().catch(() => {});
    },
  };
}
