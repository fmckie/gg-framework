const clamp01 = x => Math.max(0, Math.min(1, x));
export const ease = x => { const n = clamp01(x); return n * n * n * (n * (n * 6 - 15) + 10); };

// A fixed 6.8 s phrase: overlapping syllables with rests, so speech has rhythm without audio.
const PHRASE = 6.8;
const SYLLABLES = [[.42, .72], [.86, .95], [1.5, .58], [2.55, 1], [3.1, .7], [4.05, .88], [4.75, .62], [5.55, .48]];
export function voiceAt(t) {
  const phrase = ((t % PHRASE) + PHRASE) % PHRASE;
  let v = 0;
  for (const [at, power] of SYLLABLES) v += power * Math.exp(-(((phrase - at) / .23) ** 2));
  return clamp01(v * (.86 + .14 * Math.sin(t * 19.7) * Math.sin(t * 7.3 + 1.1)));
}

// The person's turn, simulated: one short utterance every 6.5 s, then quiet.
const UTTERANCE = 6.5;
const SPOKEN = [[1.15, .6], [1.55, .9], [2.05, .55], [2.6, .85], [3.15, .6]];
export function inputAt(t) {
  const phrase = ((t % UTTERANCE) + UTTERANCE) % UTTERANCE;
  let v = 0;
  for (const [at, power] of SPOKEN) v += power * Math.exp(-(((phrase - at) / .2) ** 2));
  return clamp01(v);
}

// Thinking indexes each layer by a detent, then holds: 3.2 s per cycle, never a free spin.
export const CYCLE = 3.2;
export const STEPS = { seg: .42, dots: -.21, outer: -.31, scan: Math.PI / 4 };
const WINDOWS = { seg: [0, .9], dots: [.3, 1.15], outer: [.55, 1.5], scan: [0, .75] };
export function thinkingAt(t) {
  const n = Math.floor(t / CYCLE), local = t - n * CYCLE, out = {};
  for (const [key, [start, end]] of Object.entries(WINDOWS)) out[key] = STEPS[key] * (n + ease((local - start) / (end - start)));
  return out;
}

export function poseAt(mood, t, clock, reduced = false) {
  const p = { assemble: 1, live: .92, dim: 1, muted: 0, retract: 0, amp: 0, echoAmp: 0, inAmp: 0, extend: 0, scanAmt: 0, scan: 0, seekAmt: 0, seek: 0, yaw: 0, pitch: 0, phase: 0, seg: 0, dots: 0, outer: 0 };
  const drift = gain => { if (!reduced) { p.yaw = .028 * gain * Math.sin(clock * .37); p.pitch = .02 * gain * Math.sin(clock * .29 + 1.3); } };
  switch (mood) {
    case 'connecting': {
      p.live = .62;
      p.assemble = reduced ? 1 : ease(t / 2);
      p.seekAmt = reduced ? 1 : ease((t - 1.6) / .5);
      const s = Math.max(0, t - 2.1), n = Math.floor(s / 1.2);
      p.seek = reduced ? 0 : (n + ease((s - n * 1.2) / .45)) % 4;
      break;
    }
    case 'idle':
    case 'listening': {
      drift(1);
      p.inAmp = reduced ? 0 : .009 * inputAt(t);
      p.phase = reduced ? 0 : clock;
      if (mood === 'idle') p.dim = .75;
      break;
    }
    case 'thinking': {
      drift(.5);
      p.live = .8;
      Object.assign(p, reduced ? { ...STEPS } : thinkingAt(t));
      p.scanAmt = reduced ? 1 : ease(t / .45);
      break;
    }
    case 'speaking': {
      drift(.6);
      p.live = 1;
      const v = reduced ? .55 : voiceAt(t), echo = reduced ? .45 : voiceAt(t - .16);
      p.amp = .024 * v;
      p.echoAmp = .018 * echo;
      p.extend = v;
      p.phase = reduced ? 1.3 : clock;
      break;
    }
    case 'muted':
      Object.assign(p, { muted: 1, dim: .62, live: .55 });
      break;
    default:
      Object.assign(p, { retract: 1, dim: .8, live: .6 });
  }
  return p;
}
