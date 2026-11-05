import {
  __toESM,
  require_jsx_runtime,
  require_react
} from "./chunk-7HJLIOEM.js";

// mockups/voice/hud-study/Orb.tsx
var import_react = __toESM(require_react());

// mockups/voice/hud-study/motion.mjs
var clamp01 = (x) => Math.max(0, Math.min(1, x));
var ease = (x) => {
  const n = clamp01(x);
  return n * n * n * (n * (n * 6 - 15) + 10);
};
var PHRASE = 6.8;
var SYLLABLES = [[0.42, 0.72], [0.86, 0.95], [1.5, 0.58], [2.55, 1], [3.1, 0.7], [4.05, 0.88], [4.75, 0.62], [5.55, 0.48]];
function voiceAt(t) {
  const phrase = (t % PHRASE + PHRASE) % PHRASE;
  let v = 0;
  for (const [at, power] of SYLLABLES) v += power * Math.exp(-(((phrase - at) / 0.23) ** 2));
  return clamp01(v * (0.86 + 0.14 * Math.sin(t * 19.7) * Math.sin(t * 7.3 + 1.1)));
}
var UTTERANCE = 6.5;
var SPOKEN = [[1.15, 0.6], [1.55, 0.9], [2.05, 0.55], [2.6, 0.85], [3.15, 0.6]];
function inputAt(t) {
  const phrase = (t % UTTERANCE + UTTERANCE) % UTTERANCE;
  let v = 0;
  for (const [at, power] of SPOKEN) v += power * Math.exp(-(((phrase - at) / 0.2) ** 2));
  return clamp01(v);
}
var CYCLE = 3.2;
var STEPS = { seg: 0.42, dots: -0.21, outer: -0.31, scan: Math.PI / 4 };
var WINDOWS = { seg: [0, 0.9], dots: [0.3, 1.15], outer: [0.55, 1.5], scan: [0, 0.75] };
function thinkingAt(t) {
  const n = Math.floor(t / CYCLE), local = t - n * CYCLE, out = {};
  for (const [key, [start, end]] of Object.entries(WINDOWS)) out[key] = STEPS[key] * (n + ease((local - start) / (end - start)));
  return out;
}
function poseAt(mood, t, clock, reduced = false) {
  const p = { assemble: 1, live: 0.92, dim: 1, muted: 0, retract: 0, amp: 0, echoAmp: 0, inAmp: 0, extend: 0, scanAmt: 0, scan: 0, seekAmt: 0, seek: 0, yaw: 0, pitch: 0, phase: 0, seg: 0, dots: 0, outer: 0 };
  const drift = (gain) => {
    if (!reduced) {
      p.yaw = 0.028 * gain * Math.sin(clock * 0.37);
      p.pitch = 0.02 * gain * Math.sin(clock * 0.29 + 1.3);
    }
  };
  switch (mood) {
    case "connecting": {
      p.live = 0.62;
      p.assemble = reduced ? 1 : ease(t / 2);
      p.seekAmt = reduced ? 1 : ease((t - 1.6) / 0.5);
      const s = Math.max(0, t - 2.1), n = Math.floor(s / 1.2);
      p.seek = reduced ? 0 : (n + ease((s - n * 1.2) / 0.45)) % 4;
      break;
    }
    case "idle":
    case "listening": {
      drift(1);
      p.inAmp = reduced ? 0 : 9e-3 * inputAt(t);
      p.phase = reduced ? 0 : clock;
      if (mood === "idle") p.dim = 0.75;
      break;
    }
    case "thinking": {
      drift(0.5);
      p.live = 0.8;
      Object.assign(p, reduced ? { ...STEPS } : thinkingAt(t));
      p.scanAmt = reduced ? 1 : ease(t / 0.45);
      break;
    }
    case "speaking": {
      drift(0.6);
      p.live = 1;
      const v = reduced ? 0.55 : voiceAt(t), echo = reduced ? 0.45 : voiceAt(t - 0.16);
      p.amp = 0.024 * v;
      p.echoAmp = 0.018 * echo;
      p.extend = v;
      p.phase = reduced ? 1.3 : clock;
      break;
    }
    case "muted":
      Object.assign(p, { muted: 1, dim: 0.62, live: 0.55 });
      break;
    default:
      Object.assign(p, { retract: 1, dim: 0.8, live: 0.6 });
  }
  return p;
}

// mockups/voice/hud-study/shader.glsl.js
var VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
var FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform float uAssemble, uLive, uDim, uMuted, uRetract, uAmp, uEchoAmp, uExtend, uInAmp;
uniform float uCursor, uCursorLag, uCursorAmt;
uniform float uYaw, uPitch, uPhase, uSeg, uDots, uOuter;
out vec4 outColor;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
const float D = 5.0;    // camera distance
const float E = 1.03;   // half-extent of the view at z = 0
const float RS = 0.44;  // smoked-glass core
const float RM = 0.70;  // primary ring

vec3 RO, RD;

// Box-filtered coverage of a band of half-width hw at signed distance d; px = plane units per device pixel.
float band(float d, float hw, float px) {
  return clamp((min(d + 0.5 * px, hw) - max(d - 0.5 * px, -hw)) / px, 0.0, 1.0);
}
float css(float w, float px) { return 0.5 * w * px * uDpr; }
float cw(float th) { return mod(0.5 * PI - th, TAU); }

// Apparent polar coordinates in plane z, so radii read as seen from the camera.
vec2 plane(float z) {
  float t = (z - RO.z) / RD.z;
  vec2 q = (RO.xy + t * RD.xy) * (D / (D - z));
  return vec2(length(q), atan(q.y, q.x));
}

// Signed arc length inside a clockwise arc [a0, a0 + len].
float arcInside(float th, float r, float a0, float len) {
  float x = mod(cw(th) - a0, TAU);
  if (x > 0.5 * (len + TAU)) x -= TAU;
  return min(x, len - x) * r;
}

// Build-on: visible portion behind the write head, and the head's brief highlight.
vec2 sweep(float th, float r, float p, float px) {
  if (p >= 1.0) return vec2(1.0, 0.0);
  if (p <= 0.0) return vec2(0.0);
  float behind = (p * TAU - cw(th)) * r;
  return vec2(clamp(behind / px + 0.5, 0.0, 1.0), step(0.0, behind) * exp(-behind / 0.05));
}

// Deterministic voice trace: radial offset and its angular derivative (integer lobes keep the seam closed).
vec2 wave(float th, float ph) {
  float a = 31.0 * th + 9.0 * ph, b = 4.0 * th - 1.7 * ph, c = 57.0 * th - 14.0 * ph, e = 13.0 * th + 5.0 * ph;
  float m = 0.6 + 0.4 * sin(b);
  float w = 0.62 * sin(a) * m + 0.16 * sin(c) + 0.22 * sin(e);
  float dw = 0.62 * (31.0 * cos(a) * m + sin(a) * 1.6 * cos(b)) + 0.16 * 57.0 * cos(c) + 0.22 * 13.0 * cos(e);
  return vec2(w, dw);
}
float trace(float r, float th, float r0, float amp, float ph) {
  vec2 w = wave(th, ph);
  float slope = amp * w.y / r0;
  return (r - r0 - amp * w.x) / sqrt(1.0 + slope * slope);
}

void over(inout vec3 col, inout float a, vec3 c, float cov) {
  col = c * cov + col * (1.0 - cov);
  a = cov + a * (1.0 - cov);
}

const vec3 SEGS[7] = vec3[7](
  vec3(8.0, 38.0, 2.2), vec3(60.0, 7.0, 2.2), vec3(94.0, 66.0, 1.0), vec3(186.0, 24.0, 2.2),
  vec3(222.0, 4.0, 2.2), vec3(250.0, 72.0, 1.0), vec3(336.0, 13.0, 2.2));

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * min(uRes.x, uRes.y)) * E;
  float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
  mat3 M = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cp, sp, 0.0, -sp, cp);
  RO = transpose(M) * vec3(0.0, 0.0, D);
  RD = transpose(M) * normalize(vec3(p, -D));

  vec3 ink = mix(vec3(0.97, 0.94, 0.91), vec3(0.70, 0.71, 0.74), uMuted);
  vec3 bloom = mix(vec3(1.0, 0.64, 0.62), vec3(0.62, 0.63, 0.67), uMuted);
  float live = uLive * uDim;
  float A = uAssemble;
  float pBezel = smoothstep(0.0, 0.55, A), pSeg = smoothstep(0.12, 0.67, A), pDots = smoothstep(0.25, 0.75, A);
  float pMain = smoothstep(0.3, 0.85, A), pCore = smoothstep(0.45, 1.0, A);
  vec3 col = vec3(0.0);
  float a = 0.0;
  vec3 glow = vec3(0.0);

  // Instrument face: a faint smoked plate so hairlines hold against the moving room.
  vec2 B = plane(-0.4);
  float pxB = fwidth(B.x);
  over(col, a, vec3(0.012, 0.008, 0.01), 0.34 * smoothstep(0.99, 0.6, B.x) * pBezel);

  // Smoked-glass core, with the primary ring reflected near its rim and a reticle seen through it.
  {
    float rs = RS * D / sqrt(D * D - RS * RS);
    float rp = length(p), pxs = fwidth(rp);
    float edge = clamp((rs - rp) / pxs + 0.5, 0.0, 1.0);
    float b = dot(RO, RD), h = max(b * b - (dot(RO, RO) - RS * RS), 0.0);
    vec3 P = RO + (-b - sqrt(h)) * RD;
    vec3 N = normalize(P), V = -RD;
    float F = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
    vec3 R = reflect(RD, N);
    vec3 L = normalize(vec3(-0.55, 0.74, 0.39));
    vec3 X = normalize(cross(vec3(0.0, 1.0, 0.0), L)), Y = cross(L, X);
    float k = dot(R, L);
    vec2 box = vec2(dot(R, X), dot(R, Y)) / max(k, 1e-3);
    float soft = step(0.0, k) * smoothstep(0.75, 0.45, abs(box.x)) * smoothstep(0.075, 0.03, abs(box.y));
    float rz = min(R.z, -1e-3);
    vec2 Q = P.xy - P.z / rz * R.xy;
    float tq = atan(Q.y, Q.x);
    float ringRefl = step(R.z, -1e-3) * exp(-abs(length(Q) - RM - uAmp * wave(tq, uPhase).x) / 0.014);
    vec3 T = refract(RD, N, 1.0 / 1.38);
    float tz = min(T.z, -1e-3);
    vec2 Qi = P.xy - P.z / tz * T.xy;
    float ri = length(Qi), ti = atan(Qi.y, Qi.x), pxi = max(fwidth(ri), 1e-5);
    float quarter = mod(ti + PI * 0.25, PI * 0.5) - PI * 0.25;
    float fine = mod(ti + PI / 24.0, PI / 12.0) - PI / 24.0;
    float inner = band(ri - 0.30, css(0.8, pxi), pxi) * 0.8
      + band(quarter * ri, css(1.0, pxi), pxi) * band(ri - 0.262, 0.02, pxi) * 0.75
      + band(fine * ri, css(0.7, pxi), pxi) * band(ri - 0.322, 0.008, pxi) * 0.4;
    inner *= step(T.z, -1e-3);
    vec3 glass = vec3(0.022, 0.018, 0.022)
      + ink * inner * 0.5 * live
      + vec3(0.6, 0.58, 0.62) * F * 0.5
      + vec3(0.95, 0.93, 0.92) * soft * (0.04 + 0.42 * F)
      + bloom * ringRefl * (0.2 + 0.8 * F) * live;
    over(col, a, glass, 0.9 * edge * pCore);
  }

  // Bezel graduations, furthest back: 2.5 degree minors, 30 degree majors.
  {
    float r = B.x, th = B.y + uOuter, px = pxB;
    float s = TAU / 144.0, k = floor(th / s + 0.5), arc = (th - k * s) * r;
    float major = step(mod(k, 12.0), 0.5);
    float ticks = mix(band(arc, css(0.8, px), px) * band(r - 0.929, 0.011, px) * 0.42,
                      band(arc, css(1.25, px), px) * band(r - 0.9265, 0.0215, px) * 0.85, major);
    float hair = band(r - 0.958, css(0.7, px), px) * 0.35;
    vec2 sw = sweep(B.y, r, pBezel, px);
    float keep = 1.0 - 0.82 * uRetract;
    over(col, a, ink, max(ticks, hair) * sw.x * live * keep);
    glow += bloom * sw.y * band(r - 0.93, 0.035, px) * 0.8;
  }

  // Segmented arcs: bold and fine weights; they lengthen slightly with speech.
  {
    vec2 S = plane(-0.15);
    float r = S.x, th = S.y - uSeg, px = fwidth(S.x);
    float c = 0.0;
    for (int i = 0; i < 7; i++) {
      vec3 g = SEGS[i];
      float bold = step(1.5, g.z);
      float len = radians(g.y) * (1.0 + 0.32 * uExtend * bold);
      float along = clamp(arcInside(th, r, radians(g.x), len) / px + 0.5, 0.0, 1.0);
      c = max(c, along * band(r - 0.865, css(g.z, px), px) * mix(0.5, 0.82, bold));
    }
    c = max(c, band(r - 0.835, css(0.6, px), px) * 0.22);
    over(col, a, ink, c * sweep(S.y, r, pSeg, px).x * live * (1.0 - 0.9 * uRetract));
  }

  // Dotted track, nearest the viewer.
  {
    vec2 Dt = plane(0.18);
    float r = Dt.x, th = Dt.y + uDots, px = fwidth(Dt.x);
    float s = TAU / 90.0, k = floor(th / s + 0.5);
    float accent = step(mod(k, 15.0), 0.5);
    float d = length(vec2((th - k * s) * r, r - 0.79));
    float dot1 = clamp((css(mix(1.7, 2.6, accent), px) - d) / px + 0.5, 0.0, 1.0) * mix(0.48, 0.8, accent);
    over(col, a, ink, dot1 * sweep(Dt.y, r, pDots, px).x * live * (1.0 - 0.9 * uRetract));
  }

  // Primary ring: still while listening, an oscilloscope trace while speaking; cardinal indices and brackets.
  {
    vec2 Mn = plane(0.0);
    float r = Mn.x, th = Mn.y, px = fwidth(Mn.x);
    vec2 sw = sweep(th, r, pMain, px);
    float keep = 1.0 - 0.45 * uRetract;
    float d = trace(r, th, RM, uAmp, uPhase);
    over(col, a, ink, band(d, css(1.3, px), px) * sw.x * live * keep);
    float speech = clamp(uAmp / 0.024, 0.0, 1.0);
    glow += bloom * sw.x * live * keep * (exp(-abs(d) / 0.02) * 0.12 + exp(-abs(d) / 0.035) * 0.2 * speech);
    glow += bloom * sw.y * band(r - RM, 0.03, px) * 0.9;
    float local = mod(cw(th) + PI * 0.25, PI * 0.5) - PI * 0.25;
    float index = band(local * r, css(1.4, px), px) * band(r - 0.74, 0.018, px) * 0.9;
    float al = abs(local);
    float bracket = clamp(min(al - radians(5.0), radians(12.0) - al) * r / px + 0.5, 0.0, 1.0)
      * band(r - 0.745, css(1.0, px), px) * 0.55;
    over(col, a, ink, max(index, bracket) * sw.x * live * (1.0 - 0.7 * uRetract));
  }

  // Delayed echo of the voice trace, slightly forward, present only while she speaks.
  {
    vec2 Ec = plane(0.06);
    float r = Ec.x, px = fwidth(Ec.x);
    float d = trace(r, Ec.y + 0.35, 0.672, uEchoAmp, uPhase - 0.16);
    over(col, a, ink, band(d, css(0.8, px), px) * 0.5 * smoothstep(0.0, 0.008, uEchoAmp) * live);
  }

  // Inner track: the person's voice arrives here while listening; the index cursor runs here otherwise,
  // stepping between cardinals while connecting and by eighths while thinking, smeared only in transit.
  {
    vec2 Cr = plane(0.1);
    float r = Cr.x, th = Cr.y, px = fwidth(Cr.x);
    float a0 = min(uCursorLag, uCursor) - radians(4.0), len = abs(uCursor - uCursorLag) + radians(8.0);
    float inside = arcInside(th, r, a0, len);
    float along = clamp(inside / px + 0.5, 0.0, 1.0);
    float x = mod(cw(th) - a0, TAU);
    float head = mix(0.35, 1.0, smoothstep(0.0, len, x));
    float track = band(r - 0.632, css(0.6, px), px) * 0.2;
    float cursor = along * band(r - 0.632, css(2.0, px), px) * head;
    float din = trace(r, th - 0.7, 0.632, uInAmp, uPhase * 1.25);
    float hearing = smoothstep(0.0, 0.004, uInAmp);
    float heard = band(din, css(0.9, px), px) * 0.6 * hearing * live;
    over(col, a, ink, max(max(track, cursor) * uCursorAmt * uDim, heard));
    glow += bloom * exp(-abs(din) / 0.02) * 0.12 * hearing * live;
    glow += bloom * along * exp(-abs(r - 0.632) / 0.015) * head * 0.22 * uCursorAmt * uDim;
  }

  outColor = vec4(col + glow * (1.0 - 0.6 * uMuted), a);
}`;

// mockups/voice/hud-study/hud.js
var UNIFORMS = [
  "uRes",
  "uDpr",
  "uAssemble",
  "uLive",
  "uDim",
  "uMuted",
  "uRetract",
  "uAmp",
  "uEchoAmp",
  "uExtend",
  "uInAmp",
  "uCursor",
  "uCursorLag",
  "uCursorAmt",
  "uYaw",
  "uPitch",
  "uPhase",
  "uSeg",
  "uDots",
  "uOuter"
];
var SMOOTH = { assemble: 7, live: 7, dim: 7, muted: 7, retract: 7, extend: 18, cursorAmt: 7, yaw: 6, pitch: 6, amp: 25, echoAmp: 25, inAmp: 25 };
var ROTATIONS = ["seg", "dots", "outer"];
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error("Shader Error: " + gl.getShaderInfoLog(shader));
  return shader;
}
function createHud(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "hud-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
  if (!gl) {
    canvas.remove();
    throw Error("WebGL2 unavailable");
  }
  let program, buffer, loc = {}, lost = false;
  const init = () => {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error("Shader Error: " + gl.getProgramInfoLog(program));
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    loc = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));
  };
  init();
  let mood = "listening", reduced = false, age = 0, clock = 0, previous, raf, dirty = true, drawn = 0, lastSignature;
  let shown = null, base = { seg: 0, dots: 0, outer: 0, scan: 0 }, cursor = 0, cursorLag = 0;
  const param = new URLSearchParams(location.search).get("frame");
  let fixed = param !== null && Number.isFinite(Number(param)) ? Math.max(0, Number(param)) : null;
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const onVisibility = () => {
    previous = void 0;
    dirty = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  const onLost = (event) => {
    event.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
    init();
    dirty = true;
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  const targetAt = (t, c, still) => {
    const pose = poseAt(mood, t, c, still);
    const lag = poseAt(mood, Math.max(0, t - 0.12), c - 0.12, still);
    if (mood === "thinking") {
      cursor = pose.scan;
      cursorLag = lag.scan;
    } else if (mood === "connecting") {
      cursor = pose.seek * Math.PI / 2;
      cursorLag = lag.seek * Math.PI / 2;
    }
    return { ...pose, cursorAmt: mood === "thinking" ? pose.scanAmt : mood === "connecting" ? pose.seekAmt : 0 };
  };
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (document.hidden || lost) {
      previous = void 0;
      return;
    }
    const animate = !reduced && fixed === null;
    const dt = previous === void 0 ? 0 : Math.min((now - previous) / 1e3, 0.06);
    previous = now;
    if (animate) {
      age += dt;
      clock += dt;
    }
    let pose;
    if (fixed !== null) {
      pose = targetAt(fixed, fixed, reduced);
      shown = null;
    } else {
      const target = targetAt(age, clock, reduced);
      for (const key of ROTATIONS) target[key] += base[key];
      if (mood === "thinking") {
        cursor += base.scan;
        cursorLag += base.scan;
      }
      if (!shown || !animate) shown = { ...target };
      else {
        for (const key of Object.keys(target)) {
          const rate = SMOOTH[key];
          const next = rate ? shown[key] + (target[key] - shown[key]) * (1 - Math.exp(-dt * rate)) : target[key];
          shown[key] = Math.abs(target[key] - next) < 5e-4 ? target[key] : next;
        }
      }
      pose = shown;
    }
    const signature = [canvas.width, canvas.height, cursor, cursorLag, ...Object.values(pose).map((v) => Math.round(v * 1e5))].join();
    if (!dirty && signature === lastSignature) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    const set = (name, value) => gl.uniform1f(loc[name], value);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    set("uDpr", dpr);
    set("uAssemble", pose.assemble);
    set("uLive", pose.live);
    set("uDim", pose.dim);
    set("uMuted", pose.muted);
    set("uRetract", pose.retract);
    set("uAmp", pose.amp);
    set("uEchoAmp", pose.echoAmp);
    set("uExtend", pose.extend);
    set("uInAmp", pose.inAmp);
    set("uCursor", cursor);
    set("uCursorLag", cursorLag);
    set("uCursorAmt", pose.cursorAmt);
    set("uYaw", pose.yaw);
    set("uPitch", pose.pitch);
    set("uPhase", pose.phase);
    set("uSeg", pose.seg);
    set("uDots", pose.dots);
    set("uOuter", pose.outer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawn++;
    dirty = false;
    lastSignature = signature;
    canvas.dataset.mood = mood;
    canvas.dataset.ready = "true";
  };
  raf = requestAnimationFrame(frame);
  const api = {
    setState(next, still) {
      if (next !== mood) {
        if (mood === "thinking" && fixed === null) {
          const pose = poseAt("thinking", age, clock, reduced);
          for (const key of ROTATIONS) base[key] += pose[key];
          base.scan += pose.scan;
        }
        age = 0;
      }
      mood = next;
      reduced = still;
      dirty = true;
    },
    seek(t) {
      fixed = t === null ? null : Math.max(0, t);
      previous = void 0;
      dirty = true;
    },
    snapshot() {
      return { mood, reduced, age, clock, drawn, fixed, pose: shown && Object.fromEntries(Object.entries(shown).map(([k, v]) => [k, Math.round(v * 1e5) / 1e5])) };
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      canvas.remove();
      if (window.hud === api) delete window.hud;
    }
  };
  window.hud = api;
  return api;
}

// mockups/voice/hud-study/Orb.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime());
function VoiceOrb({ mood, reducedMotion, className }) {
  const host = (0, import_react.useRef)(null);
  const engine = (0, import_react.useRef)(null);
  const [failed, setFailed] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    try {
      engine.current = createHud(host.current);
    } catch (error) {
      console.error("HUD renderer unavailable", error);
      setFailed(true);
    }
    return () => engine.current?.dispose();
  }, []);
  (0, import_react.useEffect)(() => {
    engine.current?.setState(mood, reducedMotion);
  }, [mood, reducedMotion]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: host, className: `${className} hud-orb`, "aria-hidden": "true", children: failed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "renderer-unavailable", children: "WebGL2 unavailable" }) });
}
export {
  VoiceOrb
};
