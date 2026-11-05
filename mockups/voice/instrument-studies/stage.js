import * as THREE from 'three';
import { motionAt } from './motion.mjs';
import { suspendedCore } from './suspended-core.js';
import { kineticAperture } from './kinetic-aperture.js';
import { fieldDistortion } from './field-distortion.js';

export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#11151a');
  const panels = [
    [[-3, 4, 2], [2, 5], '#e5edf4', 5],
    [[3, 1, 0], [.55, 5], '#b9ccd9', 3],
    [[0, -3, 2], [5, .45], '#d6b8a1', 2],
    [[-2, 0, -4], [2, 2], '#a3343d', .8],
  ];
  for (const [position, size, color, intensity] of panels) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    mesh.position.set(...position);mesh.lookAt(0,0,0);scene.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, .04, .1, 20);
  scene.traverse(o => { o.geometry?.dispose();o.material?.dispose(); });
  pmrem.dispose();return target;
}

export function createInstrument(host, concept) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setClearColor(0, 0);renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = 'instrument-canvas';
  renderer.domElement.setAttribute('aria-hidden','true');host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 30);
  camera.position.set(0, 0, 3.85);camera.lookAt(0,0,0);
  const root = new THREE.Group();scene.add(root);
  let environment;
  if (concept !== 'field') {
    environment = makeEnvironment(renderer);scene.environment = environment.texture;
    const key = new THREE.DirectionalLight('#e1eaf0', 3.1);key.position.set(-3,4,5);scene.add(key);
    const fill = new THREE.DirectionalLight('#9cafbd', .65);fill.position.set(4,-1,2);scene.add(fill);
  }
  const instrument = concept === 'core' ? suspendedCore(root) : concept === 'aperture' ? kineticAperture(root) : fieldDistortion(root, renderer, host);
  let mood = 'listening', reduced = false, age = 0, previous, raf, dirty = true, drawn = 0, lastPose;
  const param = new URLSearchParams(location.search).get('frame');
  let fixed = param !== null && Number.isFinite(Number(param)) ? Math.max(0, Number(param)) : null;
  const resize = new ResizeObserver(() => { renderer.setSize(host.clientWidth, host.clientHeight, false);dirty = true; });
  resize.observe(host);
  const onVisibility = () => { previous = undefined;dirty = true; };
  document.addEventListener('visibilitychange', onVisibility);
  const render = (now) => {
    raf = requestAnimationFrame(render);
    if (document.hidden) { previous = undefined;return; }
    if (previous !== undefined && !reduced && fixed === null && !['muted','ended'].includes(mood)) age += Math.min((now - previous)/1000, .06);
    previous = now;
    const t = fixed ?? age;
    const pose = motionAt(mood, t, reduced);
    const signature = JSON.stringify(pose);
    const needsBackground = concept === 'field' && instrument.backgroundChanged(reduced);
    if (!dirty && signature === lastPose && !needsBackground) return;
    instrument.update(pose, t, reduced, mood);
    renderer.render(scene,camera);drawn++;dirty = false;lastPose = signature;
    renderer.domElement.dataset.mood = mood;
    renderer.domElement.dataset.ready = 'true';
  };
  raf = requestAnimationFrame(render);
  const api = {
    setState(next, still) { if(next !== mood) age = 0;mood = next;reduced = still;dirty = true; },
    seek(t) { fixed = t;dirty = true; },
    snapshot() { return { concept, mood, reduced, age, drawn, pose: motionAt(mood, fixed ?? age, reduced), backgroundReady: instrument.ready?.() ?? true }; },
    dispose() {
      cancelAnimationFrame(raf);resize.disconnect();document.removeEventListener('visibilitychange',onVisibility);
      instrument.dispose?.();
      const geometries = new Set(), materials = new Set();
      scene.traverse(o => { if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of [o.material].flat())materials.add(m); });
      geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());environment?.dispose();renderer.dispose();renderer.domElement.remove();
      if(window.instrument === api)delete window.instrument;
    },
  };
  window.instrument = api;return api;
}

export function ring(parent, radius, tube, material, tilt = [0,0,0], z = 0, arc = Math.PI*2) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius,tube,8,160,arc), material);
  mesh.rotation.set(...tilt);mesh.position.z = z;parent.add(mesh);return mesh;
}
