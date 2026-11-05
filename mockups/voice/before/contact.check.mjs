import { chromium } from 'playwright';
import { readFileSync,existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const items=JSON.parse(readFileSync('mockups/voice/before/evidence.json'));
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1680,height:1100}});
 await page.goto('http://127.0.0.1:4792/states.html');
 for(let i=0;i<items.length;i+=4){
  await page.evaluate(items=>{document.body.style.cssText='margin:0;max-width:none;background:#333;color:white;display:grid;grid-template-columns:1fr 1fr;font:14px system-ui;gap:12px';document.body.replaceChildren();for(const item of items){const box=document.createElement('div');box.textContent=`${item.state} · ${item.width}×1000`;const img=document.createElement('img');img.src='./'+item.path.split('/').at(-1);img.style.cssText='display:block;width:100%;height:510px;object-fit:contain;background:#111';box.append(img);document.body.append(box);}},items.slice(i,i+4));
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth));
  const path=`mockups/voice/before/contact-${i/4+1}.png`;assert(!existsSync(path));await page.screenshot({path});
 }
 console.log('12 contact sheets created from the 46 immutable captures.');
}finally{await browser.close();}
