export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = `#version 300 es
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
