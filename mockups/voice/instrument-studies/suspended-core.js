import * as THREE from 'three';
import { ring } from './stage.js';

export function suspendedCore(root) {
  const housing = new THREE.Group();root.add(housing);housing.rotation.set(.22,-.24,-.14);
  const titanium = new THREE.MeshStandardMaterial({ color:'#45515b',metalness:.94,roughness:.32 });
  const black = new THREE.MeshStandardMaterial({ color:'#161d24',metalness:.92,roughness:.27 });
  const edge = new THREE.MeshStandardMaterial({ color:'#8f9ca3',metalness:1,roughness:.23 });
  const light = new THREE.MeshStandardMaterial({ color:'#a8c2cd',metalness:.5,roughness:.3,emissive:'#93c7d9',emissiveIntensity:.2 });
  const inner = new THREE.Group();housing.add(inner);
  const core = new THREE.Mesh(new THREE.SphereGeometry(.637,80,56),black);inner.add(core);
  const source = new THREE.IcosahedronGeometry(.65,5);
  const positions = source.getAttribute('position');
  const plated = [];
  for(let i=0;i<positions.count;i+=3) {
    const vertices=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,i+j));
    const center=vertices.reduce((c,v)=>c.add(v),new THREE.Vector3()).multiplyScalar(1/3);
    for(const vertex of vertices) plated.push(...vertex.lerp(center,.035).toArray());
  }
  const plates = new THREE.BufferGeometry();plates.setAttribute('position',new THREE.Float32BufferAttribute(plated,3));plates.setAttribute('normal',new THREE.Float32BufferAttribute(plated.flatMap((_,i)=>i%3===0?new THREE.Vector3(...plated.slice(i,i+3)).normalize().toArray():[]),3));source.dispose();
  inner.add(new THREE.Mesh(plates,titanium));
  const gimbal = new THREE.Group();housing.add(gimbal);
  for(const [r,tilt] of [[.735,[.45,.3,0]],[.83,[1.2,-.25,.45]],[.93,[.1,.6,-.3]]]) {
    ring(gimbal,r,.0045,edge,tilt);
    ring(gimbal,r-.012,.009,black,tilt);
  }
  const ribs = new THREE.Group();housing.add(ribs);
  for(let i=0;i<12;i++) {
    const angle=i/12*Math.PI*2;
    const points=[];
    for(let j=0;j<=70;j++) {
      const a=.23+j/70*(Math.PI-.46);
      points.push(new THREE.Vector3(.955*Math.sin(a)*Math.cos(angle),.955*Math.cos(a),.955*Math.sin(a)*Math.sin(angle)));
    }
    const rib=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),72,.0055,5,false),i%3===0?edge:black);ribs.add(rib);
  }
  const shutters=[];
  for(let i=0;i<6;i++) {
    const group=new THREE.Group();group.rotation.z=i*Math.PI/3;inner.add(group);
    const bar=new THREE.Mesh(new THREE.BoxGeometry(.005,.065,.012),light);bar.position.set(0,.69,.13);group.add(bar);shutters.push(group);
    const bridge=new THREE.Mesh(new THREE.BoxGeometry(.018,.115,.024),black);bridge.position.set(0,.73,0);group.add(bridge);
  }
  const shell = new THREE.ShaderMaterial({ transparent:true,depthWrite:false,side:THREE.FrontSide,uniforms:{},vertexShader:`varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`varying vec3 vN;varying vec3 vV;void main(){vec3 n=normalize(vN);float edge=pow(1.-max(0.,dot(n,normalize(vV))),5.);float strip=pow(max(0.,dot(n,normalize(vec3(-.6,.65,.25)))),22.);vec3 reflection=reflect(-normalize(vV),n);float ribbon=exp(-pow((reflection.x+reflection.y*.38+.3)/.065,2.))*smoothstep(.05,.75,reflection.y);vec3 c=mix(vec3(.012,.022,.03),vec3(.59,.67,.72),clamp(edge*.8+strip*.32+ribbon*.7,0.,1.));gl_FragColor=vec4(c,.33+edge*.2+ribbon*.14);}` });
  housing.add(new THREE.Mesh(new THREE.SphereGeometry(.98,96,64),shell));
  return { update(p) {
    housing.rotation.x=.22+p.pitch;housing.rotation.y=-.24+p.yaw;
    gimbal.rotation.z=p.index;gimbal.rotation.x=p.index*.45;
    inner.position.z=p.axial;inner.rotation.y=p.index*.28;
    shutters.forEach((s,i)=>{s.position.y=Math.cos(i*Math.PI/3)*p.axial*.35;s.position.x=Math.sin(i*Math.PI/3)*p.axial*.35;});
    light.emissiveIntensity=p.energy*1.6;light.emissive.set(p.muted?'#9fa6aa':'#93c7d9');
  }};
}
