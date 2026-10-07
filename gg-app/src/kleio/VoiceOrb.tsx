// Kleio's voice orb: a living sphere that swells with her voice and settles
// when she's quiet.
//
// Adapted from ElevenLabs UI's Orb (MIT, (c) ElevenLabs,
// github.com/elevenlabs/ui apps/www/registry/elevenlabs-ui/ui/orb.tsx):
//   - the Perlin texture is generated here, so nothing loads from a CDN and
//     no @react-three/drei is needed;
//   - driven by Kleio's measured volumes (her voice, your microphone) when
//     available, with the original state-based motion as the fallback;
//   - Kleio's crimson ramp; stills when reduced motion is preferred.

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/** What she's doing: shapes the orb's motion. */
export type OrbMood =
  "idle" | "connecting" | "listening" | "thinking" | "speaking" | "muted" | "ended";

/** How loud she (out) and you (in) are, 0–1; null where it isn't measured. */
export interface OrbLevels {
  readonly out: number | null;
  readonly in: number | null;
}

export interface VoiceOrbProps {
  readonly mood: OrbMood;
  /** Read every frame; a null level is imitated from the mood. */
  readonly levels?: () => OrbLevels;
  /** The orb's ramp, darkest to lightest (four colours). */
  readonly palette?: Palette;
  readonly reducedMotion?: boolean;
  readonly className?: string;
}

/** Darkest to lightest: shadow, deep, mid, glow. */
export type Palette = readonly [string, string, string, string];

/**
 * Kleio's crimson, kept within one hue so the orb glows rather than splitting
 * into light and dark halves: ember shadow, the icon's red, crimson, coral glow.
 */
const KLEIO_PALETTE: Palette = ["#2a070c", "#8b1521", "#d23447", "#ff8a96"];
/** Muted: the same orb, drained of colour. */
const MUTED_PALETTE: Palette = ["#121214", "#3a3a3e", "#66666c", "#9a9aa0"];

export function VoiceOrb({
  mood,
  levels,
  palette = KLEIO_PALETTE,
  reducedMotion = false,
  className,
}: VoiceOrbProps): React.ReactElement {
  return (
    <div className={className} aria-hidden="true">
      <Canvas
        resize={{ debounce: 100 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: true }}
      >
        <Scene
          mood={mood}
          levels={levels}
          palette={mood === "muted" ? MUTED_PALETTE : palette}
          reducedMotion={reducedMotion}
        />
      </Canvas>
    </div>
  );
}

function Scene({
  mood,
  levels,
  palette,
  reducedMotion,
}: {
  readonly mood: OrbMood;
  readonly levels: (() => OrbLevels) | undefined;
  readonly palette: Palette;
  readonly reducedMotion: boolean;
}): React.ReactElement {
  const { gl } = useThree();
  const mesh = useRef<THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>>(null);
  const moodRef = useRef(mood);
  const levelsRef = useRef(levels);
  const reducedRef = useRef(reducedMotion);
  // Where each ramp colour is heading; the uniforms ease toward these.
  const targets = useRef(palette.map((c) => new THREE.Color(c)));
  const speed = useRef(0.1);
  const curIn = useRef(0);
  const curOut = useRef(0);

  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);
  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);
  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);
  useEffect(() => {
    targets.current.forEach((c, i) => c.set(palette[i] ?? "#000000"));
  }, [palette]);

  // The noise the flow samples, made once here instead of fetched.
  const noise = useMemo(() => perlinTexture(256), []);
  useEffect(() => () => noise.dispose(), [noise]);

  const offsets = useMemo(() => {
    const random = splitmix32(0x4b6c6569); // "Klei": the same orb every time
    return new Float32Array(Array.from({ length: 7 }, () => random() * Math.PI * 2));
  }, []);

  const uniforms = useMemo(
    () => ({
      uColor0: new THREE.Uniform(new THREE.Color(KLEIO_PALETTE[0])),
      uColor1: new THREE.Uniform(new THREE.Color(KLEIO_PALETTE[1])),
      uColor2: new THREE.Uniform(new THREE.Color(KLEIO_PALETTE[2])),
      uColor3: new THREE.Uniform(new THREE.Color(KLEIO_PALETTE[3])),
      uOffsets: { value: offsets },
      uPerlinTexture: new THREE.Uniform(noise),
      uTime: new THREE.Uniform(0),
      uAnimation: new THREE.Uniform(0.1),
      uInverted: new THREE.Uniform(0),
      uInputVolume: new THREE.Uniform(0),
      uOutputVolume: new THREE.Uniform(0),
      uOpacity: new THREE.Uniform(0),
    }),
    [noise, offsets],
  );

  useFrame((_, delta) => {
    const mat = mesh.current?.material;
    if (!mat) return;
    const u = mat.uniforms as typeof uniforms;
    const still = reducedRef.current;
    // Reduced motion: the orb holds its shape; only its glow follows her.
    const dt = still ? 0 : delta;
    u.uTime.value += dt * 0.5;
    if (u.uOpacity.value < 1) u.uOpacity.value = Math.min(1, u.uOpacity.value + delta * 2);

    const t = u.uTime.value * 2;
    const measured = levelsRef.current?.() ?? null;
    const measuredOut = measured?.out ?? null;
    const measuredIn = measured?.in ?? null;
    // `out` drives the swirl (her voice), `in` the rings (yours). Low when
    // she's quiet, so the orb visibly settles; high when she speaks.
    let targetIn: number;
    let targetOut: number;
    switch (moodRef.current) {
      case "speaking":
        targetIn =
          measuredOut !== null ? 0.2 + measuredOut * 0.6 : clamp01(0.55 + Math.sin(t * 4.8) * 0.22);
        targetOut =
          measuredOut !== null ? 0.3 + measuredOut * 0.7 : clamp01(0.75 + Math.sin(t * 3.6) * 0.22);
        break;
      case "listening":
        targetIn = measuredIn !== null ? measuredIn * 0.9 : clamp01(0.3 + Math.sin(t * 3.2) * 0.2);
        targetOut = 0.08;
        break;
      case "thinking": {
        const base = 0.38 + 0.07 * Math.sin(t * 0.7);
        const wander = 0.05 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1.2);
        targetIn = clamp01(base + wander);
        targetOut = clamp01(0.3 + 0.1 * Math.sin(t * 1.05 + 0.6));
        break;
      }
      case "connecting":
        targetIn = clamp01(0.2 + Math.sin(t * 1.4) * 0.12);
        targetOut = 0.12;
        break;
      default:
        targetIn = 0;
        targetOut = 0.05;
    }
    // Reduced motion: the orb holds still (the status words say who's talking).
    if (still) {
      targetIn = 0.15;
      targetOut = 0.15;
    }
    curIn.current += (clamp01(targetIn) - curIn.current) * 0.2;
    curOut.current += (clamp01(targetOut) - curOut.current) * 0.2;

    const targetSpeed = 0.1 + (1 - Math.pow(curOut.current - 1, 2)) * 0.9;
    speed.current += (targetSpeed - speed.current) * 0.12;
    u.uAnimation.value += dt * speed.current;
    u.uInputVolume.value = curIn.current;
    u.uOutputVolume.value = curOut.current;
    u.uColor0.value.lerp(targets.current[0] ?? u.uColor0.value, 0.08);
    u.uColor1.value.lerp(targets.current[1] ?? u.uColor1.value, 0.08);
    u.uColor2.value.lerp(targets.current[2] ?? u.uColor2.value, 0.08);
    u.uColor3.value.lerp(targets.current[3] ?? u.uColor3.value, 0.08);
  });

  // A lost WebGL context (sleep, GPU reset) comes back instead of going blank.
  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (e: Event): void => {
      e.preventDefault();
      setTimeout(() => gl.forceContextRestore(), 1);
    };
    canvas.addEventListener("webglcontextlost", onLost, false);
    return () => canvas.removeEventListener("webglcontextlost", onLost, false);
  }, [gl]);

  return (
    <mesh ref={mesh}>
      <circleGeometry args={[3.5, 64]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
      />
    </mesh>
  );
}

// ── Noise ──────────────────────────────────────────────────────────────────

/** A tiling grey Perlin-noise texture (the flow the original loads from a CDN). */
function perlinTexture(size: number): THREE.DataTexture {
  const random = splitmix32(0x6f726221);
  const grid = 8;
  const grads = Array.from({ length: grid * grid }, () => {
    const a = random() * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)] as const;
  });
  const grad = (ix: number, iy: number): readonly [number, number] =>
    grads[(((iy % grid) + grid) % grid) * grid + (((ix % grid) + grid) % grid)] ?? [1, 0];
  const fade = (x: number): number => x * x * x * (x * (x * 6 - 15) + 10);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * grid;
      const fy = (y / size) * grid;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const dx = fx - x0;
      const dy = fy - y0;
      const dot = (ix: number, iy: number): number => {
        const g = grad(ix, iy);
        return g[0] * (fx - ix) + g[1] * (fy - iy);
      };
      const u = fade(dx);
      const v = fade(dy);
      const n0 = dot(x0, y0) + u * (dot(x0 + 1, y0) - dot(x0, y0));
      const n1 = dot(x0, y0 + 1) + u * (dot(x0 + 1, y0 + 1) - dot(x0, y0 + 1));
      const n = n0 + v * (n1 - n0); // about -0.7 .. 0.7
      // Scaled to the original texture's spread (sd ≈ 0.10, 5–95% ≈ 0.32–0.68).
      const value = Math.round(Math.min(1, Math.max(0, 0.5 + n * 0.46)) * 255);
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function splitmix32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

// ── Shaders (ElevenLabs UI Orb, MIT) ───────────────────────────────────────

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uAnimation;
uniform float uInverted;
uniform float uOffsets[7];
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uInputVolume;
uniform float uOutputVolume;
uniform float uOpacity;
uniform sampler2D uPerlinTexture;
varying vec2 vUv;

const float PI = 3.14159265358979323846;

bool drawOval(vec2 polarUv, vec2 polarCenter, float a, float b, bool reverseGradient, float softness, out vec4 color) {
  vec2 p = polarUv - polarCenter;
  float oval = (p.x * p.x) / (a * a) + (p.y * p.y) / (b * b);
  float edge = smoothstep(1.0, 1.0 - softness, oval);
  if (edge > 0.0) {
    float gradient = reverseGradient ? (1.0 - (p.x / a + 1.0) / 2.0) : ((p.x / a + 1.0) / 2.0);
    gradient = mix(0.5, gradient, 0.1);
    color = vec4(vec3(gradient), 0.85 * edge);
    return true;
  }
  return false;
}

vec3 colorRamp(float grayscale, vec3 color1, vec3 color2, vec3 color3, vec3 color4) {
  if (grayscale < 0.33) return mix(color1, color2, grayscale * 3.0);
  if (grayscale < 0.66) return mix(color2, color3, (grayscale - 0.33) * 3.0);
  return mix(color3, color4, (grayscale - 0.66) * 3.0);
}

vec2 hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
  return 0.5 + 0.5 * n;
}

float sharpRing(vec3 decomposed, float time) {
  float noise = mix(noise2D(vec2(decomposed.x, time) * 5.0), noise2D(vec2(decomposed.y, time) * 5.0), decomposed.z);
  noise = (noise - 0.5) * 2.5;
  return 1.0 + noise * 0.3 * 1.5;
}

float smoothRing(vec3 decomposed, float time) {
  float noise = mix(noise2D(vec2(decomposed.x, time) * 6.0), noise2D(vec2(decomposed.y, time) * 6.0), decomposed.z);
  noise = (noise - 0.5) * 5.0;
  return 0.9 + noise * 0.2;
}

float flow(vec3 decomposed, float time) {
  return mix(
    texture(uPerlinTexture, vec2(time, decomposed.x / 2.0)).r,
    texture(uPerlinTexture, vec2(time, decomposed.y / 2.0)).r,
    decomposed.z
  );
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  float radius = length(uv);
  float theta = atan(uv.y, uv.x);
  if (theta < 0.0) theta += 2.0 * PI;

  vec3 decomposed = vec3(
    theta / (2.0 * PI),
    mod(theta / (2.0 * PI) + 0.5, 1.0) + 1.0,
    abs(theta / PI - 1.0)
  );

  float noise = flow(decomposed, radius * 0.03 - uAnimation * 0.2) - 0.5;
  theta += noise * mix(0.08, 0.25, uOutputVolume);
  // Kleio: the arms curve like a vortex, tightening as she speaks.
  theta += radius * mix(0.9, 1.7, uOutputVolume);

  vec4 color = vec4(1.0, 1.0, 1.0, 1.0);
  float originalCenters[7] = float[7](0.0, 0.5 * PI, 1.0 * PI, 1.5 * PI, 2.0 * PI, 2.5 * PI, 3.0 * PI);
  float centers[7];
  for (int i = 0; i < 7; i++) {
    centers[i] = originalCenters[i] + 0.5 * sin(uTime / 20.0 + uOffsets[i]);
  }

  float a, b;
  vec4 ovalColor;
  for (int i = 0; i < 7; i++) {
    float n = texture(uPerlinTexture, vec2(mod(centers[i] + uTime * 0.05, 1.0), 0.5)).r;
    a = 0.5 + n * 0.3;
    b = n * mix(3.5, 2.5, uInputVolume);
    bool reverseGradient = (i % 2 == 1);
    float distTheta = min(abs(theta - centers[i]), min(abs(theta + 2.0 * PI - centers[i]), abs(theta - 2.0 * PI - centers[i])));
    if (drawOval(vec2(distTheta, radius), vec2(0.0, 0.0), a, b, reverseGradient, 0.6, ovalColor)) {
      color.rgb = mix(color.rgb, ovalColor.rgb, ovalColor.a);
      color.a = max(color.a, ovalColor.a);
    }
  }

  float ringRadius1 = sharpRing(decomposed, uTime * 0.1);
  float ringRadius2 = smoothRing(decomposed, uTime * 0.1);
  float inputRadius1 = radius + uInputVolume * 0.2;
  float inputRadius2 = radius + uInputVolume * 0.15;
  float opacity1 = mix(0.2, 0.6, uInputVolume);
  float opacity2 = mix(0.15, 0.45, uInputVolume);
  float ringAlpha1 = (inputRadius2 >= ringRadius1) ? opacity1 : 0.0;
  float ringAlpha2 = smoothstep(ringRadius2 - 0.05, ringRadius2 + 0.05, inputRadius1) * opacity2;
  float totalRingAlpha = max(ringAlpha1, ringAlpha2);
  color.rgb = 1.0 - (1.0 - color.rgb) * (1.0 - vec3(1.0) * totalRingAlpha);

  float luminance = mix(color.r, 1.0 - color.r, uInverted);
  // Kleio's palette, darkest to lightest, all one hue: the swirl glows instead
  // of splitting into a white half and a dark half (the original is tuned for
  // pale pastels, where white blends in).
  color.rgb = colorRamp(luminance, uColor0, uColor1, uColor2, uColor3);
  // A bright core: the arms meet in light, not at a point. It swells with her voice.
  float core = 1.0 - smoothstep(0.0, mix(0.38, 0.55, uOutputVolume), radius);
  color.rgb = mix(color.rgb, uColor3, core * 0.8);
  // A sphere, not a disc: lit at the centre, shading toward the rim.
  color.rgb *= mix(1.08, 0.62, smoothstep(0.15, 1.0, radius));
  // A faint lit rim, brighter at the top, so she stands apart from the crimson
  // room behind her instead of fading into it.
  float rim = smoothstep(0.8, 0.95, radius) * (1.0 - smoothstep(0.95, 0.995, radius));
  color.rgb = mix(color.rgb, uColor3, rim * mix(0.18, 0.4, vUv.y));
  // A clean edge, softened just enough not to look cut out.
  color.a *= uOpacity * (1.0 - smoothstep(0.955, 1.0, radius));
  gl_FragColor = color;
}
`;
