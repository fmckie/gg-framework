import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
const dir='mockups/voice/before';
const browser=await chromium.launch();
const evidence=[];
const errors=[];
try {
  for(const width of [1680,1024]) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith('http://127.0.0.1:4792/')||url.startsWith('blob:')) return route.continue();
      errors.push('Unexpected request: '+url);return route.abort();
    });
    await page.addInitScript(()=>{
      const blocked=()=>{throw Error('Forbidden integration invoked');};
      navigator.mediaDevices.getUserMedia=blocked;
      window.fetch=blocked;window.WebSocket=blocked;window.RTCPeerConnection=blocked;
      Storage.prototype.setItem=blocked;Storage.prototype.getItem=blocked;
    });
    await page.goto('http://127.0.0.1:4792/');
    await page.waitForFunction(()=>window.baseline);
    const states=await page.evaluate(()=>window.baseline.scenarios);
    for(const state of [...states,'guide']) {
      await page.evaluate(name=>window.baseline.selectScenario(name),state==='guide'?'listening':state);
      await page.locator('.voice-orb canvas').waitFor();
      if(state==='guide') await page.getByRole('button',{name:'What Kleio Voice can do'}).click();
      if(state==='show-text') await page.locator('.voice-show-doc h1').waitFor();
      if(['show-image','show-pdf','show-web'].includes(state)) await page.locator('.voice-show img').first().waitFor();
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,state+' overflow');
      const path=`${dir}/${state}-${width}.png`;
      assert.equal(existsSync(path),false,'Immutable capture already exists');
      await page.screenshot({path});
      evidence.push({state,width,height:1000,engine:'Chromium',reducedMotion:true,screen:await page.locator('.voice-mode').evaluate(e=>({mood:e.dataset.mood,font:getComputedStyle(e).fontFamily})),path});
    }
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.baseline.selectScenario('listening'));
    await page.getByRole('button',{name:'Mute',exact:true}).click();
    assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'muted');
    await page.getByRole('button',{name:'Hang up',exact:true}).click();
    await page.getByRole('button',{name:'Talk again',exact:true}).click();
    assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'listening');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.voice-mode').count(),0);
    await page.close();
  }
  assert.deepEqual(errors,[]);
  for(const [path,hash] of Object.entries(JSON.parse(readFileSync(`${dir}/source-hashes.json`)))) assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash,path+' unchanged');
  writeFileSync(`${dir}/evidence.json`,JSON.stringify(evidence,null,2),{flag:'wx'});
  writeFileSync(`${dir}/states.html`,'<!doctype html><html lang="en"><meta charset="utf-8"><title>Voice baseline states</title><body style="font:16px/1.6 system-ui;max-width:900px;margin:40px auto"><h1>Source baseline · simulated data</h1><p>No microphone, host, network services or storage. Source UI unchanged; simulated captions and shown content. Captures use reduced motion at 1680×1000 and 1024×1000.</p><ul>'+ [...new Set(evidence.map(e=>e.state))].map(state=>`<li><a href="./?state=${state==='guide'?'listening':state}">${state}</a> — <a href="./${state}-1680.png">1680 capture</a> · <a href="./${state}-1024.png">1024 capture</a>${state==='guide'?' (open ? button in preview)':''}</li>`).join('')+'</ul></body></html>',{flag:'wx'});
  console.log(`PASS: ${evidence.length} state/viewport captures; mute, hang-up, retry, Escape; no integration calls, page errors or overflow; source hashes unchanged.`);
  console.log('WebKit executable present:',existsSync(webkit.executablePath()));
} finally {await browser.close();}
