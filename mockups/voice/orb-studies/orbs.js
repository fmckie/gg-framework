const treatment = document.body.dataset.treatment;
const preference = matchMedia('(prefers-reduced-motion: reduce)');
let canvas, ctx, host, mood, time = 0, previous;
const fixed = new URLSearchParams(location.search).get('frame');
function gradient(x,y,r,stops) {
  const g=ctx.createRadialGradient(x,y,0,x,y,r);
  stops.forEach(([p,c])=>g.addColorStop(p,c)); return g;
}
function disc(x,y,r,fill) { ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill(); }
function draw(t) {
  ctx.clearRect(0,0,760,760);
  const quiet = mood==='muted'||mood==='ended';
  const speed = mood==='thinking'?1.1:mood==='speaking'?.85:mood==='connecting'?.22:.18;
  const p=t*speed;
  const pulse = quiet?0:(mood==='speaking'? .018*Math.sin(t*5)+.009*Math.sin(t*8):.006*Math.sin(t*1.4));
  ctx.save();ctx.translate(380,380);ctx.scale(1+pulse,1+pulse);
  ctx.filter=mood==='muted'?'grayscale(1)':'none';
  const r=330;
  disc(0,0,365,gradient(0,0,365,[[0,'#e6294520'],[.8,'#ed234017'],[1,'#ed234000']]));
  disc(0,0,r,gradient(-110,-140,600,[[0,'#84323f'],[.35,'#350b19'],[.78,'#080710'],[1,'#020206']]));
  ctx.save();ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.clip();
  if(treatment==='ruby') {
    disc(90,140,300,gradient(90,140,300,[[0,'#ff2f5d'],[.35,'#b90e39'],[.74,'#580e29aa'],[1,'#13081400']]));
    for(let i=0;i<8;i++) {
      ctx.save();ctx.rotate(p*.18+i*.4);ctx.translate(25*Math.sin(p+i),0);
      ctx.beginPath();ctx.ellipse(-35,20,155+i*23,290-i*12,.6,0,Math.PI*2);
      ctx.strokeStyle=`rgba(255,${90+i*12},${123+i*10},${.08+i*.012})`;ctx.lineWidth=2+i*2;ctx.shadowBlur=18;ctx.shadowColor='#ff365d';ctx.stroke();ctx.restore();
    }
    disc(-115,-165,220,gradient(-115,-165,220,[[0,'#fff0df99'],[.12,'#ffcec66a'],[.32,'#f9a0a22a'],[1,'#ffc9bf00']]));
    ctx.save();ctx.rotate(-.55);ctx.beginPath();ctx.ellipse(-40,-263,125,17,0,0,Math.PI*2);ctx.fillStyle='#ffded9b0';ctx.filter='blur(9px)';ctx.fill();ctx.restore();
  } else if(treatment==='eclipse') {
    for(let i=0;i<42;i++) {
      const a=i/42*Math.PI*2+p*.18;
      ctx.beginPath();ctx.ellipse(0,0,302,100+27*Math.sin(p*.6),a,0,Math.PI*2);
      ctx.strokeStyle=`rgba(255,${100+Math.round(70*Math.sin(i*.12)**2)},${110+Math.round(60*Math.sin(i*.12)**2)},${.09+.1*Math.sin(i*.32+p)**2})`;ctx.lineWidth=1.3;ctx.stroke();
    }
    disc(-8,-12,239,gradient(-75,-100,440,[[0,'#392a32'],[.35,'#16121b'],[.7,'#09080e'],[1,'#330e22']]));
    ctx.beginPath();ctx.arc(-8,-12,240,0,Math.PI*2);ctx.strokeStyle='#ffabb488';ctx.lineWidth=2;ctx.shadowColor='#ff315c';ctx.shadowBlur=25;ctx.stroke();ctx.shadowBlur=0;
    ctx.save();ctx.rotate(p*.35);ctx.beginPath();ctx.ellipse(0,0,309,295,-.4,Math.PI*.95,Math.PI*1.65);ctx.strokeStyle='#ffe0c8';ctx.lineWidth=3;ctx.shadowColor='#ff5e70';ctx.shadowBlur=14;ctx.stroke();ctx.restore();
  } else {
    for(let j=0;j<66;j++) {
      const latitude=-Math.PI/2+(j+.5)/66*Math.PI;
      ctx.beginPath();
      for(let i=0;i<=180;i++) {
        const a=i/180*Math.PI*2;
        const wave=1+.035*Math.sin(a*5+latitude*7+p*1.4);
        const x=300*Math.cos(latitude)*Math.cos(a)*wave;
        const z=300*Math.cos(latitude)*Math.sin(a)*wave;
        const y=300*Math.sin(latitude);
        const tilt=.43+.12*Math.sin(p*.22);
        const yy=y*Math.cos(tilt)-z*Math.sin(tilt);
        const xx=x*Math.cos(p*.12)-yy*Math.sin(p*.12);
        const Y=x*Math.sin(p*.12)+yy*Math.cos(p*.12);
        if(i===0)ctx.moveTo(xx,Y);else ctx.lineTo(xx,Y);
      }
      ctx.strokeStyle=`rgba(255,${110+Math.round(j/66*90)},${130+Math.round(j/66*68)},${.25+.45*Math.sin(j/66*Math.PI)})`;ctx.lineWidth=1.35;ctx.stroke();
    }
    disc(-70,-100,270,gradient(-70,-100,270,[[0,'#ffb8b51c'],[1,'#ff879000']]));
  }
  ctx.restore();
  ctx.beginPath();ctx.arc(0,0,r-1,0,Math.PI*2);
  const rim=ctx.createLinearGradient(-250,-300,220,300);rim.addColorStop(0,'#ffd1d899');rim.addColorStop(.28,'#ff71852a');rim.addColorStop(.6,'#00000099');rim.addColorStop(1,'#ff607d88');
  ctx.strokeStyle=rim;ctx.lineWidth=treatment==='filament'?1:3;ctx.stroke();ctx.restore();
  canvas.dataset.mood=mood;canvas.dataset.frame=String(t);
}
function tick(now) {
  const next=document.querySelector('.voice-orb');
  if(next && next!==host) {
    host=next;canvas=document.createElement('canvas');canvas.className='study-orb';canvas.width=760;canvas.height=760;canvas.setAttribute('aria-hidden','true');host.append(canvas);ctx=canvas.getContext('2d');
  }
  if(next) {
    mood=document.querySelector('.voice-mode').dataset.mood;
    const still=preference.matches||mood==='muted'||mood==='ended';
    if(!document.hidden && !still && previous!==undefined)time+=Math.min((now-previous)/1000,.05);
    const t=fixed!==null?Number(fixed):still?0:time;
    if(canvas.dataset.frame!==String(t)||canvas.dataset.mood!==mood)draw(t);
  }
  previous=now;requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
