// Home's ways in on the desktop: upstream's plate button (its PlateButton.tsx, from GG
// Royale) in Kleio's crimson, on a stone socket. Pointing at it lifts the plate, pressing sinks it
// and letting go springs it back past rest. Dimmed sits sunk and dull, and still clicks.
//
// Drawn as the game draws it: three canvases of art pixels (the socket, the plate, the socket's
// front lip), shown at --plate-scale screen pixels each. The word is real text: it names the button.

import { useEffect, useRef } from "react";

// 124 wide, not upstream's 100: "Voice agent" is 85px in Alagard and has to clear the border.
export const PLATE_W = 124;
export const PLATE_H = 46;
// How far a press sinks the plate and a pointer lifts it, in art pixels.
const PRESS = 7;
const LIFT = -2;

const C = {
  ink: "#0e0809",
  stone: "#514a4c",
  stoneHi: "#686062",
  stoneLo: "#3d3638",
  stoneDark: "#2a2325",
  body: "#b31d30",
  ring: "#8c1526",
  side: "#3d0a13",
  sideHi: "#5e101d",
};

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// A box with 2px-cut corners and a 1px edge.
function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  edge: string,
): void {
  px(ctx, x + 2, y, w - 4, h, edge);
  px(ctx, x, y + 2, w, h - 4, edge);
  px(ctx, x + 1, y + 1, w - 2, h - 2, edge);
  px(ctx, x + 2, y + 1, w - 4, h - 2, fill);
  px(ctx, x + 1, y + 2, w - 2, h - 4, fill);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  amount: number,
  color: string,
): void {
  const r = rng(seed);
  ctx.fillStyle = color;
  for (let i = 0; i < w * h * amount; i++) {
    ctx.fillRect(x + Math.floor(r() * w), y + Math.floor(r() * h), 1, 1);
  }
}

function dashRect(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, col: string): void {
  for (let x = x0; x <= x1; x++) {
    if ((x - x0) % 8 < 5 || (x - x0) % 8 === 6) {
      px(ctx, x, y0, 1, 1, col);
      px(ctx, x, y1, 1, 1, col);
    }
  }
  for (let y = y0; y <= y1; y++) {
    if ((y - y0) % 8 < 5 || (y - y0) % 8 === 6) {
      px(ctx, x0, y, 1, 1, col);
      px(ctx, x1, y, 1, 1, col);
    }
  }
}

function ctxOf(canvas: HTMLCanvasElement | null): Ctx | null {
  const ctx = canvas?.getContext("2d") ?? null;
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, PLATE_W, PLATE_H);
  }
  return ctx;
}

function paint(
  back: HTMLCanvasElement | null,
  plate: HTMLCanvasElement | null,
  front: HTMLCanvasElement | null,
  seed: number,
): void {
  const W = PLATE_W;
  const H = PLATE_H;
  const b = ctxOf(back);
  if (b) {
    roundRect(b, 1, 12, W - 2, 27, C.stone, C.ink);
    px(b, 3, 13, W - 6, 1, C.stoneHi);
    speckle(b, 3, 14, W - 6, 22, seed * 7, 0.07, C.stoneHi);
    speckle(b, 3, 14, W - 6, 22, seed * 9, 0.06, C.stoneLo);
    px(b, 1, 37, W - 2, 7, C.ink);
    px(b, 2, 37, W - 4, 6, C.stoneDark);
    px(b, 3, 37, W - 6, 1, C.stoneLo);
    px(b, 9, 15, W - 18, 19, C.ink);
    px(b, 10, 16, W - 20, 3, C.stoneDark);
  }
  const f = ctxOf(front);
  if (f && back) {
    // Everything of the socket below the plate's resting bottom edge (y 33).
    f.drawImage(back, 0, 33, W, H - 33, 0, 33, W, H - 33);
    px(f, 9, 33, W - 18, 1, C.ink);
  }
  const x = ctxOf(plate);
  if (x) {
    // The side, then the top face: ink outline, a darker ring, the dash-dot border.
    roundRect(x, 7, 1, W - 14, 32, C.side, C.ink);
    px(x, 8, 29, W - 16, 1, C.sideHi);
    roundRect(x, 7, 1, W - 14, 28, C.ring, C.ink);
    px(x, 9, 3, W - 18, 24, C.body);
    px(x, 8, 4, W - 16, 22, C.body);
    dashRect(x, 10, 4, W - 11, 25, C.ring);
  }
}

interface Props extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "type" | "aria-disabled"
> {
  readonly label: string;
  /** Something is missing: shown sunk and dull, but still clickable so it can say what. */
  readonly dimmed?: boolean;
}

export function KleioPlate({
  label,
  dimmed = false,
  className,
  ...rest
}: Props): React.ReactElement {
  const btnRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const plateRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLSpanElement>(null);
  const dimmedRef = useRef(dimmed);
  const moveRef = useRef<((target: number, kick?: number) => void) | null>(null);

  useEffect(() => {
    let seed = 0;
    for (const ch of label) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    paint(backRef.current, plateRef.current, frontRef.current, (seed % 97) + 3);
  }, [label]);

  // A damped spring moves the plate: rest 0, lifted on hover, sunk on press.
  useEffect(() => {
    const btn = btnRef.current;
    const face = faceRef.current;
    if (!btn || !face) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sp = { y: 0, v: 0, target: 0, held: false, raf: 0 };
    const place = (y: number): void => {
      face.style.setProperty("--plate-y", String(y));
    };
    const step =
      (last: number) =>
      (t: number): void => {
        const dt = Math.min(0.033, (t - last) / 1000 || 0.016);
        // Stiff and a little under-damped: a release overshoots and wobbles.
        const a = -520 * (sp.y - sp.target) - 15 * sp.v;
        sp.v += a * dt;
        sp.y += sp.v * dt;
        place(Math.round(Math.max(-4, Math.min(PRESS + 1, sp.y))));
        if (Math.abs(sp.v) < 0.5 && Math.abs(sp.y - sp.target) < 0.3) {
          sp.y = sp.target;
          sp.v = 0;
          place(sp.target);
          sp.raf = 0;
          return;
        }
        sp.raf = requestAnimationFrame(step(t));
      };
    const move = (target: number, kick = 0): void => {
      sp.target = target;
      if (reduced) {
        sp.y = target;
        place(target);
        return;
      }
      sp.v += kick;
      if (!sp.raf) sp.raf = requestAnimationFrame(step(performance.now()));
    };
    const rest = (): number => (dimmedRef.current ? PRESS : 0);
    const enter = (): void => {
      if (!dimmedRef.current && !sp.held) move(LIFT, -30);
    };
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      sp.held = true;
      move(PRESS, 160);
    };
    const release = (leaving: boolean): void => {
      if (sp.held) {
        sp.held = false;
        move(leaving || dimmedRef.current ? rest() : LIFT, -40);
      } else if (leaving) move(rest(), 20);
    };
    const up = (): void => release(false);
    const leave = (): void => release(true);
    const keyDown = (e: KeyboardEvent): void => {
      if ((e.key === "Enter" || e.key === " ") && !e.repeat) move(PRESS, 160);
    };
    const keyUp = (e: KeyboardEvent): void => {
      if (e.key === "Enter" || e.key === " ") move(rest(), -40);
    };
    btn.addEventListener("pointerenter", enter);
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", leave);
    btn.addEventListener("keydown", keyDown);
    btn.addEventListener("keyup", keyUp);
    moveRef.current = move;
    sp.y = sp.target = rest();
    place(sp.y);
    return () => {
      cancelAnimationFrame(sp.raf);
      moveRef.current = null;
      btn.removeEventListener("pointerenter", enter);
      btn.removeEventListener("pointerdown", down);
      btn.removeEventListener("pointerup", up);
      btn.removeEventListener("pointerleave", leave);
      btn.removeEventListener("keydown", keyDown);
      btn.removeEventListener("keyup", keyUp);
    };
  }, []);

  // Dimmed sinks into the socket; ready pops back up with a bounce.
  useEffect(() => {
    if (dimmedRef.current === dimmed) return;
    dimmedRef.current = dimmed;
    moveRef.current?.(dimmed ? PRESS : 0, dimmed ? 60 : -60);
  }, [dimmed]);

  return (
    <button
      ref={btnRef}
      type="button"
      className={`kleio-plate${dimmed ? " is-dimmed" : ""}${className ? ` ${className}` : ""}`}
      aria-disabled={dimmed ? true : undefined}
      {...rest}
    >
      <canvas
        ref={backRef}
        className="kleio-plate-layer"
        width={PLATE_W}
        height={PLATE_H}
        aria-hidden="true"
      />
      <span ref={faceRef} className="kleio-plate-face">
        <canvas
          ref={plateRef}
          className="kleio-plate-layer"
          width={PLATE_W}
          height={PLATE_H}
          aria-hidden="true"
        />
        <span className="kleio-plate-word">{label}</span>
      </span>
      <canvas
        ref={frontRef}
        className="kleio-plate-layer"
        width={PLATE_W}
        height={PLATE_H}
        aria-hidden="true"
      />
    </button>
  );
}
