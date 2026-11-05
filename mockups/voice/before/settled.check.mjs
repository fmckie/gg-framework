import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch();
const evidence=[];
try{
 for(const width of [1680,1024]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:4792/?state=connecting');
  await page.locator('.voice-orb canvas').waitFor();
  await page.waitForTimeout(2500);
  let path=`mockups/voice/before/connecting-settled-${width}.png`;assert(!existsSync(path));await page.screenshot({path});evidence.push({path,width,height:1000,reducedMotion:true});
  await page.getByRole('button',{name:'What Kleio Voice can do'}).click();
  await page.locator('.session-help-body').evaluate(el=>el.scrollTop=el.scrollHeight);
  path=`mockups/voice/before/guide-bottom-${width}.png`;assert(!existsSync(path));await page.screenshot({path});evidence.push({path,width,height:1000,reducedMotion:true});
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>window.baseline.selectScenario('speaking'));
  await page.waitForTimeout(1000);
  path=`mockups/voice/before/speaking-motion-${width}.png`;assert(!existsSync(path));await page.screenshot({path});evidence.push({path,width,height:1000,reducedMotion:false});
  const styles=await page.locator('.voice-line').evaluate(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,lineHeight:getComputedStyle(el).lineHeight}));
  assert.equal(styles.size,'19px');assert.equal(styles.lineHeight,'27.55px');
  evidence.push({width,captionStyles:styles});await page.close();
 }
 writeFileSync('mockups/voice/before/settled-evidence.json',JSON.stringify(evidence,null,2),{flag:'wx'});
 console.log('PASS: six supplementary captures; original caption typography verified at both widths.');
}finally{await browser.close();}
