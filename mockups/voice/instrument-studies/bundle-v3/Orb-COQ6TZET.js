import {
  ACESFilmicToneMapping,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer
} from "./chunk-JRAYEPSQ.js";
import {
  __toESM,
  require_jsx_runtime,
  require_react
} from "./chunk-7HJLIOEM.js";

// mockups/voice/instrument-studies/Orb.tsx
var import_react = __toESM(require_react());

// mockups/voice/instrument-studies/motion.mjs
var clamp = (x) => Math.max(0, Math.min(1, x));
var ease = (x) => {
  const n = clamp(x);
  return n * n * (3 - 2 * n);
};
function motionAt(mood, time, reduced = false) {
  const t = reduced ? 0 : Math.max(0, time);
  const rest = mood === "muted" || mood === "ended";
  const pose = { pitch: 0, yaw: 0, index: 0, opening: 0.32, energy: 0.17, strain: 0.025, axial: 0, muted: mood === "muted" ? 1 : 0 };
  if (rest) return { ...pose, opening: 0.16, energy: 0.025, strain: 8e-3 };
  if (mood === "connecting") {
    const settle = reduced ? 1 : ease(t / 1.8);
    return { ...pose, opening: 0.18 + 0.08 * settle, energy: 0.09, axial: 0.06 * (1 - settle) };
  }
  if (mood === "listening") {
    pose.pitch = reduced ? 0 : 0.018 * Math.sin(t * 0.43);
    pose.yaw = reduced ? 0 : 0.026 * Math.sin(t * 0.31);
    pose.strain = 0.025 + (reduced ? 0 : 4e-3 * Math.sin(t * 0.53));
  }
  if (mood === "thinking") {
    const step = reduced ? 0.5 : ease((t % 6 - 0.4) / 0.8) - ease((t % 6 - 3.5) / 0.8);
    pose.index = 0.14 * step;
    pose.opening = 0.22;
    pose.energy = 0.23;
    pose.strain = 0.07;
    pose.axial = 0.018 * step;
  }
  if (mood === "speaking") {
    const phrase = t % 6.8;
    const syllables = [[0.5, 0.7], [1, 0.9], [1.7, 0.55], [2.8, 1], [3.4, 0.65], [4.3, 0.85], [5.1, 0.6]];
    const voice = reduced ? 0.5 : Math.min(1, syllables.reduce((v, [at, power]) => v + power * Math.exp(-(((phrase - at) / 0.27) ** 2)), 0));
    pose.opening = Math.min(0.45, 0.28 + voice * 0.17);
    pose.energy = 0.19 + voice * 0.44;
    pose.strain = 0.04 + voice * 0.14;
    pose.axial = voice * 0.037;
    pose.pitch = voice * 0.012;
  }
  return pose;
}

// mockups/voice/instrument-studies/suspended-core.js
function suspendedCore(root) {
  const housing = new Group();
  root.add(housing);
  housing.rotation.set(0.22, -0.24, -0.14);
  const titanium = new MeshStandardMaterial({ color: "#45515b", metalness: 0.94, roughness: 0.32 });
  const black = new MeshStandardMaterial({ color: "#161d24", metalness: 0.92, roughness: 0.27 });
  const edge = new MeshStandardMaterial({ color: "#8f9ca3", metalness: 1, roughness: 0.23 });
  const light = new MeshStandardMaterial({ color: "#a8c2cd", metalness: 0.5, roughness: 0.3, emissive: "#93c7d9", emissiveIntensity: 0.2 });
  const inner = new Group();
  housing.add(inner);
  const core = new Mesh(new SphereGeometry(0.637, 80, 56), black);
  inner.add(core);
  const source = new IcosahedronGeometry(0.65, 5);
  const positions = source.getAttribute("position");
  const plated = [];
  for (let i = 0; i < positions.count; i += 3) {
    const vertices = [0, 1, 2].map((j) => new Vector3().fromBufferAttribute(positions, i + j));
    const center = vertices.reduce((c, v) => c.add(v), new Vector3()).multiplyScalar(1 / 3);
    for (const vertex of vertices) plated.push(...vertex.lerp(center, 0.035).toArray());
  }
  const plates = new BufferGeometry();
  plates.setAttribute("position", new Float32BufferAttribute(plated, 3));
  plates.setAttribute("normal", new Float32BufferAttribute(plated.flatMap((_, i) => i % 3 === 0 ? new Vector3(...plated.slice(i, i + 3)).normalize().toArray() : []), 3));
  source.dispose();
  inner.add(new Mesh(plates, titanium));
  const gimbal = new Group();
  housing.add(gimbal);
  for (const [r, tilt] of [[0.735, [0.45, 0.3, 0]], [0.83, [1.2, -0.25, 0.45]], [0.93, [0.1, 0.6, -0.3]]]) {
    ring(gimbal, r, 45e-4, edge, tilt);
    ring(gimbal, r - 0.012, 9e-3, black, tilt);
  }
  const ribs = new Group();
  housing.add(ribs);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    const points = [];
    for (let j = 0; j <= 70; j++) {
      const a = 0.23 + j / 70 * (Math.PI - 0.46);
      points.push(new Vector3(0.955 * Math.sin(a) * Math.cos(angle), 0.955 * Math.cos(a), 0.955 * Math.sin(a) * Math.sin(angle)));
    }
    const rib = new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 72, 55e-4, 5, false), i % 3 === 0 ? edge : black);
    ribs.add(rib);
  }
  const shutters = [];
  for (let i = 0; i < 6; i++) {
    const group = new Group();
    group.rotation.z = i * Math.PI / 3;
    inner.add(group);
    const bar = new Mesh(new BoxGeometry(5e-3, 0.065, 0.012), light);
    bar.position.set(0, 0.69, 0.13);
    group.add(bar);
    shutters.push(group);
    const bridge = new Mesh(new BoxGeometry(0.018, 0.115, 0.024), black);
    bridge.position.set(0, 0.73, 0);
    group.add(bridge);
  }
  const shell = new ShaderMaterial({ transparent: true, depthWrite: false, side: FrontSide, uniforms: {}, vertexShader: `varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`, fragmentShader: `varying vec3 vN;varying vec3 vV;void main(){vec3 n=normalize(vN);float edge=pow(1.-max(0.,dot(n,normalize(vV))),5.);float strip=pow(max(0.,dot(n,normalize(vec3(-.6,.65,.25)))),22.);vec3 reflection=reflect(-normalize(vV),n);float ribbon=exp(-pow((reflection.x+reflection.y*.38+.3)/.065,2.))*smoothstep(.05,.75,reflection.y);vec3 c=mix(vec3(.012,.022,.03),vec3(.59,.67,.72),clamp(edge*.8+strip*.32+ribbon*.7,0.,1.));gl_FragColor=vec4(c,.33+edge*.2+ribbon*.14);}` });
  housing.add(new Mesh(new SphereGeometry(0.98, 96, 64), shell));
  return { update(p) {
    housing.rotation.x = 0.22 + p.pitch;
    housing.rotation.y = -0.24 + p.yaw;
    gimbal.rotation.z = p.index;
    gimbal.rotation.x = p.index * 0.45;
    inner.position.z = p.axial;
    inner.rotation.y = p.index * 0.28;
    shutters.forEach((s, i) => {
      s.position.y = Math.cos(i * Math.PI / 3) * p.axial * 0.35;
      s.position.x = Math.sin(i * Math.PI / 3) * p.axial * 0.35;
    });
    light.emissiveIntensity = p.energy * 1.6;
    light.emissive.set(p.muted ? "#9fa6aa" : "#93c7d9");
  } };
}

// mockups/voice/instrument-studies/kinetic-aperture.js
function bladeGeometry() {
  const radial = 6, angular = 12, count = (radial + 1) * (angular + 1);
  const positions = new Float32Array(count * 2 * 3), indices = [];
  for (let layer = 0; layer < 2; layer++) for (let r = 0; r < radial; r++) for (let a = 0; a < angular; a++) {
    const k = layer * count + r * (angular + 1) + a;
    if (layer === 0) indices.push(k, k + 1, k + angular + 1, k + 1, k + angular + 2, k + angular + 1);
    else indices.push(k, k + angular + 1, k + 1, k + 1, k + angular + 1, k + angular + 2);
  }
  const boundary = [];
  for (let a = 0; a <= angular; a++) boundary.push(a);
  for (let r = 1; r <= radial; r++) boundary.push(r * (angular + 1) + angular);
  for (let a = angular - 1; a >= 0; a--) boundary.push(radial * (angular + 1) + a);
  for (let r = radial - 1; r > 0; r--) boundary.push(r * (angular + 1));
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    indices.push(a, b, a + count, b, b + count, a + count);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setIndex(indices);
  function shape(opening, index) {
    for (let layer = 0; layer < 2; layer++) for (let r = 0; r <= radial; r++) for (let a = 0; a <= angular; a++) {
      const u = r / radial, v = a / angular;
      const radius = opening + (0.825 - opening) * u;
      const theta = index * Math.PI / 6 + v * 0.58 + (0.6 - opening) * Math.pow(1 - u, 1.25);
      const z = 0.18 + 0.16 * (1 - u) - 0.025 * v - 0.013 * layer;
      const k = (layer * count + r * (angular + 1) + a) * 3;
      positions[k] = Math.cos(theta) * radius;
      positions[k + 1] = Math.sin(theta) * radius;
      positions[k + 2] = z;
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }
  return { g, shape };
}
function kineticAperture(root) {
  const housing = new Group();
  housing.rotation.set(-0.18, -0.25, -0.12);
  root.add(housing);
  const dark = new MeshStandardMaterial({ color: "#292c30", metalness: 0.93, roughness: 0.3 });
  const steel = new MeshStandardMaterial({ color: "#a8aaa6", metalness: 0.96, roughness: 0.27 });
  const bladeMaterial = new MeshStandardMaterial({ color: "#5e6265", metalness: 0.94, roughness: 0.32, side: DoubleSide });
  const light = new MeshStandardMaterial({ color: "#e0d7c8", roughness: 0.3, metalness: 0.6, emissive: "#ddd8c9", emissiveIntensity: 0.3 });
  const profile = [new Vector2(0.78, -0.28), new Vector2(0.9, -0.18), new Vector2(0.98, -0.03), new Vector2(0.985, 0.04), new Vector2(0.96, 0.09), new Vector2(0.87, 0.13), new Vector2(0.84, 0.11), new Vector2(0.81, 0.02)];
  const barrel = new Mesh(new LatheGeometry(profile, 144), dark);
  barrel.rotation.x = Math.PI / 2;
  housing.add(barrel);
  ring(housing, 0.976, 0.012, steel, [0, 0, 0], 0.04);
  ring(housing, 0.875, 9e-3, steel, [0, 0, 0], 0.13);
  ring(housing, 0.855, 6e-3, dark, [0, 0, 0], 0.16);
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * Math.PI * 2;
    const tooth = new Mesh(new BoxGeometry(9e-3, 0.052, 0.022), dark);
    tooth.position.set(Math.cos(a) * 0.948, Math.sin(a) * 0.948, 0.073);
    tooth.rotation.z = a - Math.PI / 2;
    housing.add(tooth);
  }
  const inner = new Group();
  housing.add(inner);
  const blades = [];
  for (let i = 0; i < 12; i++) {
    const blade = bladeGeometry();
    blade.shape(0.32, i);
    const mesh = new Mesh(blade.g, bladeMaterial);
    inner.add(mesh);
    blades.push(blade);
  }
  const lens = new Mesh(new SphereGeometry(0.58, 80, 56), new ShaderMaterial({ vertexShader: `varying vec3 n;varying vec3 view;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);view=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`, fragmentShader: `varying vec3 n;varying vec3 view;void main(){vec3 r=reflect(-normalize(view),normalize(n));float strip=pow(max(0.,dot(r,normalize(vec3(-.5,.6,.7)))),45.);gl_FragColor=vec4(vec3(.008,.012,.017)+vec3(.07,.08,.09)*strip,1.);}`, toneMapped: false }));
  lens.scale.z = 0.09;
  lens.position.z = -0.4;
  housing.add(lens);
  const back = new Mesh(new CircleGeometry(0.81, 100), new MeshBasicMaterial({ color: "#030609" }));
  back.position.z = -0.5;
  housing.add(back);
  const trim = new Group();
  housing.add(trim);
  for (let i = 0; i < 6; i++) {
    const segment = ring(trim, 0.837, 4e-3, light, [0, 0, i * Math.PI / 3 + 0.08], 0.16, 0.22);
    segment.material = light;
  }
  const baffles = [];
  for (let i = 0; i < 7; i++) baffles.push(ring(housing, 0.43 - i * 0.034, 5e-3, dark, [0, 0, 0], 0.1 - i * 0.06));
  let opening;
  return { update(p) {
    housing.rotation.x = -0.18 + p.pitch * 0.35;
    housing.rotation.y = -0.25 + p.yaw * 0.3;
    inner.rotation.z = p.index * 0.65;
    trim.rotation.z = -p.index * 0.65;
    if (opening !== p.opening) {
      blades.forEach((b, i) => b.shape(p.opening, i));
      opening = p.opening;
    }
    lens.position.z = -0.4 + p.axial;
    light.emissiveIntensity = p.energy * 1.4;
    light.emissive.set(p.muted ? "#989da1" : "#ddd8c9");
  } };
}

// mockups/voice/instrument-studies/field-distortion.js
var vertexShader = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
var fragmentShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D backdrop;
uniform vec4 bounds;
uniform vec2 viewport;
uniform float strain;
uniform float energy;
uniform float shift;
uniform float muted;
uniform float ready;
vec3 room(vec2 uv){
  vec3 color=texture2D(backdrop,clamp(uv,vec2(0.),vec2(1.))).rgb;
  vec2 top=vec2(uv.x,1.-uv.y);
  float b=.22*(1.-clamp(length((top-vec2(1.))/vec2(.4))/.8,0.,1.));
  float a=.46*(1.-clamp(length((top-vec2(.5,.4))/vec2(.52,.46))/.76,0.,1.));
  color=mix(color,vec3(.5451,.08235,.1294),b);
  return mix(color,vec3(.5451,.08235,.1294),a);
}
void main(){
  vec2 q=(vUv-.5)*2.18;
  float r=length(q);
  if(r>1.012)discard;
  float angle=atan(q.y,q.x);
  float edge=1.-smoothstep(.995,1.01,r);
  float z=sqrt(max(.001,1.-min(r*r,.999)));
  float wave=sin(q.y*9.+q.x*2.-shift*5.)*sin(q.x*6.-q.y*3.);
  vec3 n=normalize(vec3(q+vec2(wave,-wave*.38)*strain*(1.-r*r),z));
  vec3 ray=refract(vec3(0.,0.,-1.),n,1./(1.08+strain*.7));
  vec2 offset=ray.xy*(.14+strain*.4)*z;
  vec2 uv=bounds.xy+vUv*bounds.zw;
  vec3 color=room(uv+offset*bounds.zw);
  vec3 reflected=reflect(vec3(0.,0.,-1.),n);
  float fresnel=pow(1.-max(n.z,0.),3.8);
  float key=pow(max(0.,dot(reflected,normalize(vec3(-.7,.5,.6)))),65.);
  float slash=exp(-pow((reflected.x+reflected.y*.5+.34)/.032,2.))*smoothstep(-.3,.65,reflected.y);
  float rim=pow(max(0.,dot(normalize(vec3(q,.1)),normalize(vec3(-.65,.7,.1)))),18.);
  float far=pow(max(0.,dot(reflected,normalize(vec3(.8,-.5,.2)))),55.);
  color*=1.-.085*(1.-z);
  vec3 white=mix(vec3(.78,.86,.9),vec3(.77),muted);
  color+=white*(key*.22+slash*(.06+energy*.16)+fresnel*rim*.42+far*.13);
  float boundary=exp(-pow((r-.998)/.0023,2.));
  color+=white*boundary*(.035+rim*.24);
  gl_FragColor=vec4(color,edge*ready);
}`;
function fieldDistortion(root, renderer, host) {
  const copy = document.createElement("canvas");
  copy.width = 1;
  copy.height = 1;
  const context = copy.getContext("2d", { alpha: false });
  const makeTexture = () => {
    const t = new CanvasTexture(copy);
    t.colorSpace = NoColorSpace;
    t.minFilter = LinearFilter;
    t.magFilter = LinearFilter;
    return t;
  };
  let texture = makeTexture();
  const uniforms = { backdrop: { value: texture }, bounds: { value: new Vector4() }, viewport: { value: new Vector2() }, strain: { value: 0.025 }, energy: { value: 0.17 }, shift: { value: 0 }, muted: { value: 0 }, ready: { value: 0 } };
  const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, toneMapped: false });
  const plane = new Mesh(new PlaneGeometry(2.13, 2.13), material);
  root.add(plane);
  let source, lastSource, copied = false;
  function backgroundChanged(reduced) {
    source = document.querySelector(".voice-dither canvas");
    return !!source && (!reduced || !copied || source !== lastSource || copy.width !== source.width || copy.height !== source.height);
  }
  return {
    backgroundChanged,
    ready: () => copied,
    update(p) {
      source = document.querySelector(".voice-dither canvas");
      if (source && source.width && source.height) {
        if (copy.width !== source.width || copy.height !== source.height) {
          copy.width = source.width;
          copy.height = source.height;
          texture.dispose();
          texture = makeTexture();
          uniforms.backdrop.value = texture;
          copied = false;
        }
        context.drawImage(source, 0, 0);
        texture.needsUpdate = true;
        lastSource = source;
        if (!copied) copied = context.getImageData(0, 0, copy.width, copy.height).data.some((v, i) => i % 4 !== 3 && v > 0);
        uniforms.ready.value = copied ? 1 : 0;
        const rect = host.getBoundingClientRect(), bg = source.getBoundingClientRect();
        const fraction = 2.13 / (2 * 3.85 * Math.tan(34 * Math.PI / 360));
        const size = rect.width * fraction, inset = (rect.width - size) / 2;
        uniforms.bounds.value.set((rect.left + inset - bg.left) / bg.width, 1 - (rect.top + inset - bg.top + size) / bg.height, size / bg.width, size / bg.height);
        uniforms.viewport.value.set(bg.width, bg.height);
      }
      uniforms.strain.value = p.strain;
      uniforms.energy.value = p.energy;
      uniforms.shift.value = p.index + p.axial;
      uniforms.muted.value = p.muted;
    },
    dispose() {
      texture.dispose();
    }
  };
}

// mockups/voice/instrument-studies/stage.js
function makeEnvironment(renderer) {
  const scene = new Scene();
  scene.background = new Color("#11151a");
  const panels = [
    [[-3, 4, 2], [2, 5], "#e5edf4", 5],
    [[3, 1, 0], [0.55, 5], "#b9ccd9", 3],
    [[0, -3, 2], [5, 0.45], "#d6b8a1", 2],
    [[-2, 0, -4], [2, 2], "#a3343d", 0.8]
  ];
  for (const [position, size, color, intensity] of panels) {
    const mesh = new Mesh(new PlaneGeometry(...size), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: DoubleSide }));
    mesh.position.set(...position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  }
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.04, 0.1, 20);
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  pmrem.dispose();
  return target;
}
function createInstrument(host, concept) {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.className = "instrument-canvas";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.append(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 0, 3.85);
  camera.lookAt(0, 0, 0);
  const root = new Group();
  scene.add(root);
  let environment;
  if (concept !== "field") {
    environment = makeEnvironment(renderer);
    scene.environment = environment.texture;
    const key = new DirectionalLight("#e1eaf0", 3.1);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const fill = new DirectionalLight("#9cafbd", 0.65);
    fill.position.set(4, -1, 2);
    scene.add(fill);
  }
  const instrument = concept === "core" ? suspendedCore(root) : concept === "aperture" ? kineticAperture(root) : fieldDistortion(root, renderer, host);
  let mood = "listening", reduced = false, age = 0, previous, raf, dirty = true, drawn = 0, lastPose;
  const param = new URLSearchParams(location.search).get("frame");
  let fixed = param !== null && Number.isFinite(Number(param)) ? Math.max(0, Number(param)) : null;
  const resize = new ResizeObserver(() => {
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    dirty = true;
  });
  resize.observe(host);
  const onVisibility = () => {
    previous = void 0;
    dirty = true;
  };
  document.addEventListener("visibilitychange", onVisibility);
  const render = (now) => {
    raf = requestAnimationFrame(render);
    if (document.hidden) {
      previous = void 0;
      return;
    }
    if (previous !== void 0 && !reduced && fixed === null && !["muted", "ended"].includes(mood)) age += Math.min((now - previous) / 1e3, 0.06);
    previous = now;
    const t = fixed ?? age;
    const pose = motionAt(mood, t, reduced);
    const signature = JSON.stringify(pose);
    const needsBackground = concept === "field" && instrument.backgroundChanged(reduced);
    if (!dirty && signature === lastPose && !needsBackground) return;
    instrument.update(pose, t, reduced, mood);
    renderer.render(scene, camera);
    drawn++;
    dirty = false;
    lastPose = signature;
    renderer.domElement.dataset.mood = mood;
    renderer.domElement.dataset.ready = "true";
  };
  raf = requestAnimationFrame(render);
  const api = {
    setState(next, still) {
      if (next !== mood) age = 0;
      mood = next;
      reduced = still;
      dirty = true;
    },
    seek(t) {
      fixed = t;
      dirty = true;
    },
    snapshot() {
      return { concept, mood, reduced, age, drawn, pose: motionAt(mood, fixed ?? age, reduced), backgroundReady: instrument.ready?.() ?? true };
    },
    dispose() {
      cancelAnimationFrame(raf);
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      instrument.dispose?.();
      const geometries = /* @__PURE__ */ new Set(), materials = /* @__PURE__ */ new Set();
      scene.traverse((o) => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) for (const m of [o.material].flat()) materials.add(m);
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      if (window.instrument === api) delete window.instrument;
    }
  };
  window.instrument = api;
  return api;
}
function ring(parent, radius, tube, material, tilt = [0, 0, 0], z = 0, arc = Math.PI * 2) {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 8, 160, arc), material);
  mesh.rotation.set(...tilt);
  mesh.position.z = z;
  parent.add(mesh);
  return mesh;
}

// mockups/voice/instrument-studies/Orb.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime());
function VoiceOrb({ mood, reducedMotion, className }) {
  const host = (0, import_react.useRef)(null);
  const engine = (0, import_react.useRef)(null);
  const [failed, setFailed] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    try {
      engine.current = createInstrument(host.current, document.body.dataset.concept);
    } catch (error) {
      console.error("Instrument renderer unavailable", error);
      setFailed(true);
    }
    return () => engine.current?.dispose();
  }, []);
  (0, import_react.useEffect)(() => {
    engine.current?.setState(mood, reducedMotion);
  }, [mood, reducedMotion]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { ref: host, className: `${className} instrument-orb`, "aria-hidden": "true", children: failed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "renderer-unavailable", children: "WebGL unavailable" }) });
}
export {
  VoiceOrb
};
