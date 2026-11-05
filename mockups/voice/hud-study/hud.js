import { poseAt } from './motion.mjs';
import { VERT, FRAG } from './shader.glsl.js';

const UNIFORMS = ['uRes', 'uDpr', 'uAssemble', 'uLive', 'uDim', 'uMuted', 'uRetract', 'uAmp', 'uEchoAmp', 'uExtend', 'uInAmp',
  'uCursor', 'uCursorLag', 'uCursorAmt', 'uYaw', 'uPitch', 'uPhase', 'uSeg', 'uDots', 'uOuter'];
// Eased so state changes cross-fade; rotations stay continuous through accumulated offsets instead.
const SMOOTH = { assemble: 7, live: 7, dim: 7, muted: 7, retract: 7, extend: 18, cursorAmt: 7, yaw: 6, pitch: 6, amp: 25, echoAmp: 25, inAmp: 25 };
const ROTATIONS = ['seg', 'dots', 'outer'];

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('Shader Error: ' + gl.getShaderInfoLog(shader));
  return shader;
}

export function createHud(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'hud-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  if (!gl) { canvas.remove(); throw Error('WebGL2 unavailable'); }
  let program, buffer, loc = {}, lost = false;
  const init = () => {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Shader Error: ' + gl.getProgramInfoLog(program));
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    loc = Object.fromEntries(UNIFORMS.map(name => [name, gl.getUniformLocation(program, name)]));
  };
  init();

  let mood = 'listening', reduced = false, age = 0, clock = 0, previous, raf, dirty = true, drawn = 0, lastSignature;
  let shown = null, base = { seg: 0, dots: 0, outer: 0, scan: 0 }, cursor = 0, cursorLag = 0;
  const param = new URLSearchParams(location.search).get('frame');
  let fixed = param !== null && Number.isFinite(Number(param)) ? Math.max(0, Number(param)) : null;
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const onVisibility = () => { previous = undefined; dirty = true; };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = event => { event.preventDefault(); lost = true; };
  const onRestored = () => { lost = false; init(); dirty = true; };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const targetAt = (t, c, still) => {
    const pose = poseAt(mood, t, c, still);
    const lag = poseAt(mood, Math.max(0, t - 0.12), c - 0.12, still);
    if (mood === 'thinking') { cursor = pose.scan; cursorLag = lag.scan; }
    else if (mood === 'connecting') { cursor = pose.seek * Math.PI / 2; cursorLag = lag.seek * Math.PI / 2; }
    return { ...pose, cursorAmt: mood === 'thinking' ? pose.scanAmt : mood === 'connecting' ? pose.seekAmt : 0 };
  };

  const frame = now => {
    raf = requestAnimationFrame(frame);
    if (document.hidden || lost) { previous = undefined; return; }
    const animate = !reduced && fixed === null;
    const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.06);
    previous = now;
    if (animate) { age += dt; clock += dt; }
    let pose;
    if (fixed !== null) { pose = targetAt(fixed, fixed, reduced); shown = null; }
    else {
      const target = targetAt(age, clock, reduced);
      for (const key of ROTATIONS) target[key] += base[key];
      if (mood === 'thinking') { cursor += base.scan; cursorLag += base.scan; }
      if (!shown || !animate) shown = { ...target };
      else {
        for (const key of Object.keys(target)) {
          const rate = SMOOTH[key];
          const next = rate ? shown[key] + (target[key] - shown[key]) * (1 - Math.exp(-dt * rate)) : target[key];
          // Land exactly once the remainder is imperceptible, so settled states stop redrawing.
          shown[key] = Math.abs(target[key] - next) < 5e-4 ? target[key] : next;
        }
      }
      pose = shown;
    }
    const signature = [canvas.width, canvas.height, cursor, cursorLag, ...Object.values(pose).map(v => Math.round(v * 1e5))].join();
    if (!dirty && signature === lastSignature) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    const set = (name, value) => gl.uniform1f(loc[name], value);
    gl.uniform2f(loc.uRes, canvas.width, canvas.height);
    set('uDpr', dpr);
    set('uAssemble', pose.assemble); set('uLive', pose.live); set('uDim', pose.dim); set('uMuted', pose.muted);
    set('uRetract', pose.retract); set('uAmp', pose.amp); set('uEchoAmp', pose.echoAmp); set('uExtend', pose.extend); set('uInAmp', pose.inAmp);
    set('uCursor', cursor); set('uCursorLag', cursorLag); set('uCursorAmt', pose.cursorAmt);
    set('uYaw', pose.yaw); set('uPitch', pose.pitch); set('uPhase', pose.phase);
    set('uSeg', pose.seg); set('uDots', pose.dots); set('uOuter', pose.outer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawn++; dirty = false; lastSignature = signature;
    canvas.dataset.mood = mood;
    canvas.dataset.ready = 'true';
  };
  raf = requestAnimationFrame(frame);

  const api = {
    setState(next, still) {
      if (next !== mood) {
        // Keep indexed rings where thinking left them, so the next state never snaps them home.
        if (mood === 'thinking' && fixed === null) {
          const pose = poseAt('thinking', age, clock, reduced);
          for (const key of ROTATIONS) base[key] += pose[key];
          base.scan += pose.scan;
        }
        age = 0;
      }
      mood = next; reduced = still; dirty = true;
    },
    seek(t) { fixed = t === null ? null : Math.max(0, t); previous = undefined; dirty = true; },
    snapshot() {
      return { mood, reduced, age, clock, drawn, fixed, pose: shown && Object.fromEntries(Object.entries(shown).map(([k, v]) => [k, Math.round(v * 1e5) / 1e5])) };
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gl.deleteBuffer(buffer); gl.deleteProgram(program);
      canvas.remove();
      if (window.hud === api) delete window.hud;
    },
  };
  window.hud = api;
  return api;
}
