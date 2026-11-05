import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base='http://127.0.0.1:4793/voice/';
const browser=await chromium.launch();
const evidence=[], errors=[];
let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
try {
 for(const width of [1680,1024]) {
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():(errors.push('External request'),route.abort()));
  await page.addInitScript(()=>{const blocked=()=>{throw Error('Forbidden integration');}; navigator.mediaDevices.getUserMedia=blocked;window.fetch=blocked;window.WebSocket=blocked;window.RTCPeerConnection=blocked;window.SpeechRecognition=blocked;window.webkitSpeechRecognition=blocked;window.speechSynthesis.speak=blocked;Storage.prototype.setItem=blocked;});
  await page.clock.install();
  await page.goto(base); await page.evaluate(()=>document.fonts.ready);
  const state=()=>page.locator('#voice-surface').getAttribute('data-state');
  const select=key=>page.selectOption('#scenario',key);
  const capture=async name=>{const path=`mockups/voice/after/${name}-${width}.png`;await page.screenshot({path});evidence.push({name,width,height:1000,path});};
  const options=await page.locator('#scenario option').evaluateAll(nodes=>nodes.map(n=>n.value));
  for(const key of options) {
   await select(key);
   check(await state()===key,key);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow '+key);
   check(await page.locator('#voice-surface').evaluate(e=>e.scrollWidth<=e.clientWidth),'surface overflow '+key);
   check(await page.locator('.voice-controls').evaluate(e=>e.getBoundingClientRect().bottom<innerHeight),'pinned controls '+key);
   if(key==='long')check(await page.locator('#turns').evaluate(e=>e.scrollHeight>e.clientHeight),'long transcript scrolls');
   if(key==='show-image'){await page.locator('.shown img').evaluate(i=>i.decode());await page.locator('#latest').click();}
   await capture(key);
  }
  await select('show-content');
  const typography=await page.locator('.voice-turn .prose').first().evaluate(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight];});
  check(typography[0].includes('Mukta Malar')&&typography.slice(1).join()==='15px,400,23.25px','response typography');
  check(await page.locator('.shown h3').evaluate(e=>{const s=getComputedStyle(e);return s.fontSize==='17.55px'&&s.fontWeight==='700'&&Math.abs(parseFloat(s.lineHeight)-27.2025)<.01;}),'heading typography');
  await select('listening');await page.locator('#guide-open').focus();await page.keyboard.press('Enter');
  check(await page.locator('#guide').evaluate(e=>e.open),'Enter opens guide');await capture('guide');
  await page.keyboard.press('Escape');check(await state()==='listening','Escape closes guide first');check(await page.locator('#guide-open').evaluate(e=>e===document.activeElement),'guide focus return');
  await page.locator('#mute').focus();await page.keyboard.press('Space');check(await state()==='muted','Space mutes');await page.keyboard.press('Enter');check(await state()==='listening','Enter unmutes');
  await page.locator('#play').click();await page.clock.runFor(3100);check(await state()==='speaking','simulation speaking');check(await page.locator('#scenario').inputValue()==='speaking','scenario follows simulation');
  await page.locator('#interrupt').click();check(await state()==='interrupted','immediate interruption');await page.clock.runFor(9000);check(await state()==='interrupted','no stale timer');
  check(await page.locator('#retry').evaluate(e=>e===document.activeElement),'interruption focus');check(await page.locator('.voice-turn .prose').last().innerText()==='Start with the smallest useful change.','interrupted response stops at progress');
  check(await page.locator('#turns').innerText().then(t=>t.includes('Interrupted · partial response')),'partial retained');
  await page.locator('#retry').click();check(await state()==='listening','resume');
  for(const key of ['no-speech','denied','unavailable','failure','show-failure']){await select(key);const count=await page.locator('.voice-turn').count();await page.locator('#retry').click();check(await state()==='listening'&&await page.locator('.voice-turn').count()===count,'retry retains '+key);}
  await page.locator('#play').click();await page.clock.runFor(1900);await page.locator('#interrupt').click();await page.clock.runFor(9000);check(await state()==='interrupted','processing cancellation');
  await page.locator('#play').click();await page.clock.runFor(1000);await page.locator('#play').click();await page.clock.runFor(7300);check(await state()==='listening','restart completes');
  await page.locator('#play').click();await page.clock.runFor(3100);await page.locator('#mute').click();await page.clock.runFor(9000);check(await state()==='muted','mute cancels');
  await page.locator('#play').click();await page.clock.runFor(3100);await page.locator('#end').click();await page.clock.runFor(9000);check(await state()==='ended','end cancels');
  await page.locator('#retry').click();await page.keyboard.press('Escape');check(await page.locator('#entry').evaluate(e=>e===document.activeElement),'exit focus return');await capture('chat');
  check(await page.locator('.input').first().evaluate(e=>{const s=getComputedStyle(e);return s.fontFamily.includes('Mukta Malar')&&s.fontSize==='15.5px'&&s.fontWeight==='400'&&s.lineHeight==='23.25px';}),'composer typography');
  await page.keyboard.press('Enter');check(await state()==='listening','entry keyboard');
  await page.keyboard.press('Tab');check(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle!=='none'),'visible focus');
  check(await page.locator('#voice-surface *').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationName==='none'&&getComputedStyle(n).transitionDuration==='0s')),'reduced motion');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#play').click();await page.clock.runFor(4600);check(await page.locator('#progress').getAttribute('aria-valuenow')==='2','progress');await capture('speaking-motion');
  await page.close();
 }
 check(errors.length===0,errors.join('\n'));
 for(const file of ['mockups/voice/after/reference-hashes.json','mockups/voice/before/source-hashes.json'])for(const [path,hash]of Object.entries(JSON.parse(readFileSync(file))))check(createHash('sha256').update(readFileSync(path)).digest('hex')===hash,path+' unchanged');
 writeFileSync('mockups/voice/after/evidence.json',JSON.stringify({checks,engine:'Chromium',evidence},null,2));
 console.log(`PASS: ${checks} assertions; ${evidence.length} captures. Chromium only.`);
} finally {await browser.close();}
