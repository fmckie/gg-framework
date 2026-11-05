import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const output='mockups/voice/orb-studies/captures';
mkdirSync(output);
const browser=await chromium.launch({headless:true});
const errors=[], results=[];
const selectors=['.voice-stage','.voice-words','.voice-controls','.voice-status'];
async function metrics(page){return page.evaluate(selectors=>selectors.map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {s,x:r.x,y:r.y,w:r.width,h:r.height,font:c.fontFamily,size:c.fontSize,line:c.lineHeight,text:e.textContent};}),selectors);}
try {
 for(const width of [1680,1024]) {
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4794/')||route.request().url().startsWith('data:')?route.continue():(errors.push(route.request().url()),route.abort()));
  await page.addInitScript(()=>{const no=()=>{throw Error('Forbidden integration');};navigator.mediaDevices.getUserMedia=no;window.fetch=no;window.WebSocket=no;window.RTCPeerConnection=no;Storage.prototype.setItem=no;});
  const baseline={};
  for(const state of ['connecting','listening','thinking','speaking','muted','ended','failed','show-text']) {
   await page.goto(`http://127.0.0.1:4794/voice/before/?state=${state}`);await page.waitForTimeout(650);baseline[state]=await metrics(page);
  }
  for(const name of ['ruby','eclipse','filament']) {
   for(const state of Object.keys(baseline)) {
    await page.goto(`http://127.0.0.1:4794/voice/orb-studies/${name}.html?state=${state}`);
    await page.locator('.study-orb').waitFor();await page.waitForTimeout(650);
    assert.deepEqual(await metrics(page),baseline[state],`${name} ${state} baseline geometry/type/text`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const a=await page.locator('.study-orb').evaluate(c=>c.toDataURL());await page.waitForTimeout(120);
    assert.equal(await page.locator('.study-orb').evaluate(c=>c.toDataURL()),a,'reduced motion static');
    await page.screenshot({path:`${output}/${name}-${state}-${width}.png`});
    results.push({name,state,width,baselineMatch:true,reducedMotionStatic:true});
   }
   await page.evaluate(()=>window.baseline.selectScenario('listening'));
   await page.getByRole('button',{name:'Mute',exact:true}).click();assert.equal(await page.locator('.voice-mode').getAttribute('data-mood'),'muted');
   await page.getByRole('button',{name:'Unmute',exact:true}).click();
   await page.getByRole('button',{name:'Hang up',exact:true}).click();
   await page.getByRole('button',{name:'Talk again',exact:true}).click();
   await page.emulateMedia({reducedMotion:'no-preference'});
   for(const state of ['connecting','listening','thinking','speaking','muted','ended']) {
    await page.evaluate(s=>window.baseline.selectScenario(s),state);await page.waitForTimeout(500);
    const a=await page.locator('.study-orb').evaluate(c=>c.toDataURL());await page.waitForTimeout(300);
    const b=await page.locator('.study-orb').evaluate(c=>c.toDataURL());
    assert.equal(a===b,['muted','ended'].includes(state),`${state} motion`);
    if(state==='speaking')await page.screenshot({path:`${output}/${name}-motion-${width}.png`});
   }
   await page.keyboard.press('Escape');assert.equal(await page.locator('.voice-mode').count(),0);
   await page.emulateMedia({reducedMotion:'reduce'});
  }
  await page.close();
 }
 assert.deepEqual(errors,[]);
 writeFileSync(`${output}/evidence.json`,JSON.stringify(results,null,2),{flag:'wx'});
 console.log(`PASS: ${results.length} baseline comparisons; motion, reduced motion, controls, local-only requests, no page errors.`);
} finally {await browser.close();}
