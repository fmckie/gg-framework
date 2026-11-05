import * as THREE from 'three';
const vertexShader=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragmentShader=`
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

export function fieldDistortion(root, renderer, host) {
  const copy=document.createElement('canvas');copy.width=1;copy.height=1;
  const context=copy.getContext('2d',{alpha:false});
  const makeTexture=()=>{const t=new THREE.CanvasTexture(copy);t.colorSpace=THREE.NoColorSpace;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;return t;};
  let texture=makeTexture();
  const uniforms={backdrop:{value:texture},bounds:{value:new THREE.Vector4()},viewport:{value:new THREE.Vector2()},strain:{value:.025},energy:{value:.17},shift:{value:0},muted:{value:0},ready:{value:0}};
  const material=new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,toneMapped:false});
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(2.13,2.13),material);root.add(plane);
  let source, lastSource, copied=false;
  function backgroundChanged(reduced){
    source=document.querySelector('.voice-dither canvas');
    return !!source&&(!reduced||!copied||source!==lastSource||copy.width!==source.width||copy.height!==source.height);
  }
  return {
    backgroundChanged,
    ready:()=>copied,
    update(p) {
      source=document.querySelector('.voice-dither canvas');
      if(source&&source.width&&source.height) {
        if(copy.width!==source.width||copy.height!==source.height){copy.width=source.width;copy.height=source.height;texture.dispose();texture=makeTexture();uniforms.backdrop.value=texture;copied=false;}
        context.drawImage(source,0,0);texture.needsUpdate=true;lastSource=source;
        if(!copied)copied=context.getImageData(0,0,copy.width,copy.height).data.some((v,i)=>i%4!==3&&v>0);
        uniforms.ready.value=copied?1:0;
        const rect=host.getBoundingClientRect(), bg=source.getBoundingClientRect();
        // The plane occupies 90% of the canvas; UVs must sample that same screen rectangle.
        const fraction=2.13/(2*3.85*Math.tan(34*Math.PI/360));
        const size=rect.width*fraction, inset=(rect.width-size)/2;
        uniforms.bounds.value.set((rect.left+inset-bg.left)/bg.width,1-(rect.top+inset-bg.top+size)/bg.height,size/bg.width,size/bg.height);
        uniforms.viewport.value.set(bg.width,bg.height);
      }
      uniforms.strain.value=p.strain;uniforms.energy.value=p.energy;uniforms.shift.value=p.index+p.axial;uniforms.muted.value=p.muted;
    },
    dispose(){texture.dispose();},
  };
}
