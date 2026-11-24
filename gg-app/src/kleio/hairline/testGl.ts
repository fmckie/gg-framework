// Test doubles for the Hairline orb: jsdom has no WebGL and no frame clock.

import { vi } from "vitest";

export interface FakeGl {
  readonly gl: WebGL2RenderingContext;
  /** The uniforms as last set. */
  readonly uniforms: Map<string, number>;
  /** The uniforms at each draw, oldest first. */
  readonly drawn: Record<string, number>[];
  /** Whether shaders compile; flip it to fail the next compile. */
  compiles: boolean;
}

export function fakeGl(): FakeGl {
  const uniforms = new Map<string, number>();
  const drawn: Record<string, number>[] = [];
  const state = { compiles: true };
  const known: Record<string, unknown> = {
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    getShaderParameter: () => state.compiles,
    getProgramParameter: () => true,
    getShaderInfoLog: () => "it does not compile",
    getAttribLocation: () => 0,
    getExtension: () => null,
    getUniformLocation: (_program: unknown, name: string) => name,
    uniform1f: (name: string, value: number) => uniforms.set(name, value),
    uniform2f: (name: string, x: number, y: number) => {
      uniforms.set(`${name}.x`, x);
      uniforms.set(`${name}.y`, y);
    },
    drawArrays: () => drawn.push(Object.fromEntries(uniforms)),
  };
  // Everything else on the context is a call the orb makes and ignores.
  const gl = new Proxy(known, {
    get: (target, key) => (key in target ? target[String(key)] : () => undefined),
  }) as unknown as WebGL2RenderingContext;
  return {
    gl,
    uniforms,
    drawn,
    get compiles() {
      return state.compiles;
    },
    set compiles(value: boolean) {
      state.compiles = value;
    },
  };
}

export interface Frames {
  /** Runs the frame loop for `seconds` at 60 frames a second. */
  run(seconds: number): void;
  /** How many frames are waiting: 0 means the loop has stopped. */
  pending(): number;
}

export function fakeFrames(): Frames {
  let now = 0;
  let id = 0;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queue.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => queue.delete(handle));
  return {
    run(seconds) {
      for (let left = Math.round(seconds * 60); left > 0; left--) {
        now += 1000 / 60;
        const due = [...queue.values()];
        queue.clear();
        for (const callback of due) callback(now);
      }
    },
    pending: () => queue.size,
  };
}

/** Stands a fake WebGL2 context (or none, for `null`) in for jsdom's canvas. */
export function stubCanvas(context: FakeGl | null): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
    kind === "webgl2" && context ? context.gl : null) as never);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
}
