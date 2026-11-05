import * as THREE from 'three';
import { ring } from './stage.js';

function bladeGeometry() {
  const radial=6, angular=12, count=(radial+1)*(angular+1);
  const positions=new Float32Array(count*2*3),indices=[];
  for(let layer=0;layer<2;layer++)for(let r=0;r<radial;r++)for(let a=0;a<angular;a++) {
    const k=layer*count+r*(angular+1)+a;
    if(layer===0)indices.push(k,k+1,k+angular+1,k+1,k+angular+2,k+angular+1);
    else indices.push(k,k+angular+1,k+1,k+1,k+angular+1,k+angular+2);
  }
  const boundary=[];
  for(let a=0;a<=angular;a++)boundary.push(a);
  for(let r=1;r<=radial;r++)boundary.push(r*(angular+1)+angular);
  for(let a=angular-1;a>=0;a--)boundary.push(radial*(angular+1)+a);
  for(let r=radial-1;r>0;r--)boundary.push(r*(angular+1));
  for(let i=0;i<boundary.length;i++){const a=boundary[i],b=boundary[(i+1)%boundary.length];indices.push(a,b,a+count,b,b+count,a+count);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));g.setIndex(indices);
  function shape(opening, index) {
    for(let layer=0;layer<2;layer++)for(let r=0;r<=radial;r++)for(let a=0;a<=angular;a++) {
      const u=r/radial,v=a/angular;
      const radius=opening+(.825-opening)*u;
      const theta=index*Math.PI/6+v*.58+(.6-opening)*Math.pow(1-u,1.25);
      const z=.18+.16*(1-u)-.025*v-.013*layer;
      const k=(layer*count+r*(angular+1)+a)*3;
      positions[k]=Math.cos(theta)*radius;positions[k+1]=Math.sin(theta)*radius;positions[k+2]=z;
    }
    g.attributes.position.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();
  }
  return {g,shape};
}

export function kineticAperture(root) {
  const housing=new THREE.Group();housing.rotation.set(-.18,-.25,-.12);root.add(housing);
  const dark=new THREE.MeshStandardMaterial({color:'#292c30',metalness:.93,roughness:.3});
  const steel=new THREE.MeshStandardMaterial({color:'#a8aaa6',metalness:.96,roughness:.27});
  const bladeMaterial=new THREE.MeshStandardMaterial({color:'#5e6265',metalness:.94,roughness:.32,side:THREE.DoubleSide});
  const light=new THREE.MeshStandardMaterial({color:'#e0d7c8',roughness:.3,metalness:.6,emissive:'#ddd8c9',emissiveIntensity:.3});
  const profile=[new THREE.Vector2(.78,-.28),new THREE.Vector2(.9,-.18),new THREE.Vector2(.98,-.03),new THREE.Vector2(.985,.04),new THREE.Vector2(.96,.09),new THREE.Vector2(.87,.13),new THREE.Vector2(.84,.11),new THREE.Vector2(.81,.02)];
  const barrel=new THREE.Mesh(new THREE.LatheGeometry(profile,144),dark);barrel.rotation.x=Math.PI/2;housing.add(barrel);
  ring(housing,.976,.012,steel,[0,0,0],.04);
  ring(housing,.875,.009,steel,[0,0,0],.13);
  ring(housing,.855,.006,dark,[0,0,0],.16);
  for(let i=0;i<96;i++) {
    const a=i/96*Math.PI*2;
    const tooth=new THREE.Mesh(new THREE.BoxGeometry(.009,.052,.022),dark);
    tooth.position.set(Math.cos(a)*.948,Math.sin(a)*.948,.073);tooth.rotation.z=a-Math.PI/2;housing.add(tooth);
  }
  const inner=new THREE.Group();housing.add(inner);
  const blades=[];
  for(let i=0;i<12;i++) { const blade=bladeGeometry();blade.shape(.32,i);const mesh=new THREE.Mesh(blade.g,bladeMaterial);inner.add(mesh);blades.push(blade); }
  const lens=new THREE.Mesh(new THREE.SphereGeometry(.58,80,56),new THREE.ShaderMaterial({vertexShader:`varying vec3 n;varying vec3 view;void main(){vec4 p=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);view=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,fragmentShader:`varying vec3 n;varying vec3 view;void main(){vec3 r=reflect(-normalize(view),normalize(n));float strip=pow(max(0.,dot(r,normalize(vec3(-.5,.6,.7)))),45.);gl_FragColor=vec4(vec3(.008,.012,.017)+vec3(.07,.08,.09)*strip,1.);}`,toneMapped:false}));
  lens.scale.z=.09;lens.position.z=-.4;housing.add(lens);
  const back=new THREE.Mesh(new THREE.CircleGeometry(.81,100),new THREE.MeshBasicMaterial({color:'#030609'}));back.position.z=-.5;housing.add(back);
  const trim=new THREE.Group();housing.add(trim);
  for(let i=0;i<6;i++) {
    const segment=ring(trim,.837,.004,light,[0,0,i*Math.PI/3+.08],.16,.22);
    segment.material=light;
  }
  const baffles=[];
  for(let i=0;i<7;i++)baffles.push(ring(housing,.43-i*.034,.005,dark,[0,0,0],.1-i*.06));
  let opening;
  return { update(p) {
    housing.rotation.x=-.18+p.pitch*.35;housing.rotation.y=-.25+p.yaw*.3;
    inner.rotation.z=p.index*.65;trim.rotation.z=-p.index*.65;
    if(opening!==p.opening){blades.forEach((b,i)=>b.shape(p.opening,i));opening=p.opening;}
    lens.position.z=-.4+p.axial;
    light.emissiveIntensity=p.energy*1.4;
    light.emissive.set(p.muted?'#989da1':'#ddd8c9');
  }};
}
