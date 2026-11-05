import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root='mockups/voice/instrument-studies';
const name=process.argv[2]||'verification-1';
assert.match(name,/^verification-[a-z0-9-]+$/);
const out=resolve(root,name);mkdirSync(out);
const origin='http://127.0.0.1:4794';
const browser=await chromium.launch({headless:true});
const errors=[],glErrors=[],results=[],motion=[];
const selectors=['.voice-mode','.voice-stage','.voice-words','.voice-controls','.voice-status','.voice-line','.voice-error','.voice-show','.voice-corner','.voice-button'];
async function metrics(page){return page.evaluate(selectors=>selectors.flatMap(s=>[...document.querySelectorAll(s)].map(e=>{
  const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {s,x:r.x,y:r.y,w:r.width,h:r.height,font:c.fontFamily,size:c.fontSize,line:c.lineHeight,weight:c.fontWeight,spacing:c.letterSpacing,text:s==='.voice-mode'?'':e.textContent,role:e.getAttribute('role'),label:e.getAttribute('aria-label')};
})),selectors);}
async function settle(page){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(350);}
async function prepare(page){
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(/GL_INVALID|Shader Error|VALIDATE_STATUS/.test(m.text()))glErrors.push(m.text());});
 await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();errors.push('Unexpected request '+url);return route.abort();});
 await page.addInitScript(()=>{
   const no=()=>{throw Error('Forbidden integration');};navigator.mediaDevices.getUserMedia=no;window.fetch=no;window.WebSocket=no;window.RTCPeerConnection=no;window.AudioContext=no;window.webkitAudioContext=no;window.SpeechRecognition=no;Storage.prototype.setItem=no;Storage.prototype.getItem=no;indexedDB.open=no;
 });
}
async function scenario(page,state){await page.evaluate(s=>window.baseline.selectScenario(s),state);await settle(page);}
async function orbPixels(page){return page.locator('.instrument-canvas').evaluate(c=>c.toDataURL());}
try {
 for(const width of [1680,1024]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});await prepare(page);
  await page.goto(origin+'/voice/before/');await page.locator('.voice-orb canvas').waitFor();await settle(page);
  const states=await page.evaluate(()=>window.baseline.scenarios),baseline={};
  for(const state of states){await scenario(page,state);baseline[state]=await metrics(page);}
  for(const concept of ['core','field','aperture']){
   await page.goto(`${origin}/voice/instrument-studies/${concept}.html`);await page.waitForFunction(()=>window.instrument?.snapshot().backgroundReady);await settle(page);
   assert.equal(await page.locator('.voice-orb canvas').count(),1,'No hidden baseline orb renderer');
   for(const state of states){
    await scenario(page,state);
    assert.deepEqual(await metrics(page),baseline[state],`${concept} ${state} ${width}: unchanged baseline`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No overflow');
    const a=await orbPixels(page);await page.waitForTimeout(100);assert.equal(await orbPixels(page),a,`${concept} reduced motion ${state}`);
    if(['connecting','listening','thinking','speaking','muted','ended','failed','show-text'].includes(state))await page.screenshot({path:`${out}/${concept}-${state}-${width}.png`});
    results.push({concept,state,width,baselineMatch:true,staticReducedMotion:true});
   }
   await scenario(page,'listening');
   await page.getByRole('button',{name:'Mute',exact:true}).click();assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'muted');
   await page.getByRole('button',{name:'Unmute',exact:true}).click();assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'listening');
   await page.getByRole('button',{name:'What Kleio Voice can do',exact:true}).click();await page.getByRole('dialog',{name:'What Kleio Voice can do'}).waitFor();await page.keyboard.press('Escape');
   assert.equal(await page.getByRole('dialog',{name:'What Kleio Voice can do'}).count(),0);assert.equal(await page.locator('.voice-mode').count(),1);
   await page.getByRole('button',{name:'Hang up',exact:true}).click();assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'ended');
   await page.getByRole('button',{name:'Talk again',exact:true}).click();assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'listening');
   await page.getByRole('button',{name:'Mute',exact:true}).focus();await page.keyboard.press('Space');assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'muted');
   await page.keyboard.press('Space');assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'listening');
   await page.emulateMedia({reducedMotion:'no-preference'});
   for(const state of ['listening','thinking','speaking']){
    await scenario(page,state);
    const a=await page.evaluate(()=>window.instrument.snapshot());await page.waitForTimeout(500);const b=await page.evaluate(()=>window.instrument.snapshot());
    assert(b.age>a.age,'Live simulation clock advances');
    if(state!=='thinking')assert(b.drawn>a.drawn,'Live animation renders');
    const frames=state==='listening'?[0,3,6,9]:state==='thinking'?[.4,1.2,2.5,4.3]:[.1,1,2.8,6.5];
    const shots=[];
    for(const frame of frames){await page.evaluate(t=>window.instrument.seek(t),frame);await page.waitForTimeout(100);await page.locator('.voice-stage').screenshot({path:`${out}/${concept}-${state}-t${frame}-${width}.png`});shots.push(await orbPixels(page));}
    assert(new Set(shots).size>1,'Different rendered motion frames');
    await page.evaluate(()=>window.instrument.seek(2.8));await page.waitForTimeout(100);
    await page.screenshot({path:`${out}/${concept}-${state}-motion-${width}.png`});
    motion.push({concept,state,width,frames,liveClock:true,renderedChanges:true});
    await page.evaluate(()=>window.instrument.seek(null));
   }
   await scenario(page,'speaking');await page.emulateMedia({reducedMotion:'reduce'});await settle(page);
   const still=await orbPixels(page);await page.waitForTimeout(250);assert.equal(await orbPixels(page),still,'Live motion preference stops orb');
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.waitForFunction(()=>window.instrument.snapshot().reduced===false);
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
   const hidden=await page.evaluate(()=>window.instrument.snapshot());await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>window.instrument.snapshot()),hidden,'Hidden study pauses');
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
   await page.keyboard.press('Escape');assert.equal(await page.locator('.voice-mode').count(),0);
   await page.emulateMedia({reducedMotion:'reduce'});
  }
  await page.close();
 }
 const resize=await browser.newPage({viewport:{width:1680,height:1000},reducedMotion:'reduce'});await prepare(resize);
 await resize.goto(`${origin}/voice/instrument-studies/field.html`);await resize.waitForFunction(()=>window.instrument?.snapshot().backgroundReady);await settle(resize);
 for(const width of [1024,1680]){await resize.setViewportSize({width,height:1000});await settle(resize);assert.equal(await resize.evaluate(()=>window.instrument.snapshot().backgroundReady),true);await resize.screenshot({path:`${out}/field-resize-${width}.png`});}
 await resize.close();
 for(const width of [1680,1024])for(const concept of ['core','field','aperture']){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'no-preference',recordVideo:{dir:out,size:{width,height:1000}}});const page=await context.newPage();await prepare(page);
  await page.goto(`${origin}/voice/instrument-studies/${concept}.html?demo=1`);await page.waitForFunction(()=>window.instrument?.snapshot().backgroundReady);
  await page.waitForTimeout(2500);await scenario(page,'listening');await page.waitForTimeout(900);
  await page.getByRole('button',{name:'Mute',exact:true}).click();await page.waitForTimeout(2400);assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'muted','Controls cancel demo');
  await page.getByRole('button',{name:'Unmute',exact:true}).click();
  for(const [state,duration]of [['listening',1700],['thinking',2200],['speaking',4300],['ended',600]]){await scenario(page,state);await page.waitForTimeout(duration);}
  const video=page.video();await context.close();await video.saveAs(`${out}/${concept}-motion-${width}.webm`);
 }
 assert.deepEqual(errors,[],'Browser errors');assert.deepEqual(glErrors,[],'WebGL validation errors');
 const hashes=JSON.parse(readFileSync(`${root}/preserved-hashes.json`));for(const [path,hash]of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),hash,path+' preserved');
 writeFileSync(`${out}/evidence.json`,JSON.stringify({results,motion,controls:'Passed at both widths for every study',resizing:'Field texture reallocation passed',errors,glErrors,preservedFiles:Object.keys(hashes).length},null,2),{flag:'wx'});
 console.log(`PASS: ${results.length} baseline/state comparisons; ${motion.length} motion sequences; controls, reduced motion, visibility pause, field resize, local-only boundaries, ${Object.keys(hashes).length} preserved files.`);
}finally{await browser.close();}
