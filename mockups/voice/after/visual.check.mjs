import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const b=await chromium.launch();
try{
const p=await b.newPage({viewport:{width:1680,height:1500}});await p.goto('http://127.0.0.1:4793/voice/');
const contrast=await p.evaluate(()=>{
 const rgb=s=>s.match(/[\d.]+/g).map(Number);
 const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 const bg=e=>{for(;e;e=e.parentElement){let c=rgb(getComputedStyle(e).backgroundColor);if(c.length===3||c[3]===1)return c;}return [255,255,255];};
 return [...document.querySelectorAll('#voice-surface *, .demo-bar *, .simulation-notice, #announcement')].filter(e=>e.checkVisibility()&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>({label:e.id||e.className||e.tagName,ratio:ratio(rgb(getComputedStyle(e).color),bg(e))}));
});
for(const item of contrast)assert(item.ratio>=4.5,JSON.stringify(item));
const boundaries=await p.locator('.v-button:visible').evaluateAll(nodes=>nodes.map(e=>({color:getComputedStyle(e).borderColor,background:getComputedStyle(e).backgroundColor})));
const lum=s=>s.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
for(const x of boundaries){const a=lum(x.color),b=lum(x.background);x.ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);assert(x.ratio>=3,JSON.stringify(x));}
writeFileSync('mockups/voice/after/contrast.json',JSON.stringify({text:contrast,boundaries,scope:'New voice text and controls; shared approved chrome unchanged.'},null,2));
const {evidence}=JSON.parse(readFileSync('mockups/voice/after/evidence.json'));
for(let i=0;i<evidence.length;i+=6){await p.evaluate(items=>{document.head.replaceChildren();document.body.style.cssText='margin:0;background:#333;color:white;display:grid;grid-template-columns:1fr 1fr;font:14px sans-serif';document.body.replaceChildren();for(const item of items){let box=document.createElement('div');box.textContent=item.name+' '+item.width;let img=document.createElement('img');img.src='./after/'+item.path.split('/').at(-1);img.style.cssText='width:100%;height:470px;object-fit:contain;display:block';box.append(img);document.body.append(box);}},evidence.slice(i,i+6));await p.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));await p.screenshot({path:`mockups/voice/after/contact-${i/6+1}.png`});}
writeFileSync('mockups/voice/after/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>Conversation Table evidence</title><body style="background:#161213;color:#e8e0dc;font:16px/1.6 system-ui;padding:32px"><h1>Conversation Table · Chromium captures</h1><p>Local simulation. Each capture is 1000px tall. Reduced motion except speaking-motion.</p><a style="color:#94a2c4" href="../">Open mockup</a><ul>'+evidence.map(e=>`<li><a style="color:#94a2c4" href="${e.path.split('/').at(-1)}">${e.name} · ${e.width}×1000</a></li>`).join('')+'</ul></body></html>');
console.log(`PASS: ${contrast.length} new text contrast samples ≥4.5:1; contact sheets refreshed.`);
}finally{await b.close();}
