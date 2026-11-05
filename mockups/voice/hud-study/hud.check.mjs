import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = 'mockups/voice/hud-study';
const name = process.argv[2] || 'verification-1';
assert.match(name, /^verification-[a-z0-9-]+$/);
const out = resolve(root, name);
mkdirSync(out);
const origin = 'http://127.0.0.1:4794';
const study = `${origin}/voice/hud-study/hud.html`;
const browser = await chromium.launch({ headless: true });
const errors = [], glErrors = [], results = [], motion = [], controls = [];
const selectors = ['.voice-mode', '.voice-stage', '.voice-orb', '.voice-words', '.voice-controls', '.voice-status', '.voice-line', '.voice-error', '.voice-show', '.voice-corner', '.voice-button'];
const metrics = page => page.evaluate(selectors => ({
  boxes: selectors.flatMap(s => [...document.querySelectorAll(s)].map(e => {
    const r = e.getBoundingClientRect(), c = getComputedStyle(e);
    return { s, x: r.x, y: r.y, w: r.width, h: r.height, font: c.fontFamily, size: c.fontSize, line: c.lineHeight, weight: c.fontWeight, spacing: c.letterSpacing, opacity: c.opacity, text: ['.voice-mode', '.voice-stage', '.voice-orb'].includes(s) ? '' : e.textContent, role: e.getAttribute('role'), label: e.getAttribute('aria-label') };
  })),
  overflowX: document.documentElement.scrollWidth > innerWidth,
  overflowY: document.documentElement.scrollHeight > innerHeight,
}), selectors);
const settle = async page => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(350); };
async function prepare(page) {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
    if (/GL_INVALID|Shader Error|VALIDATE_STATUS|CONTEXT_LOST/.test(m.text())) glErrors.push(m.text());
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    errors.push('Unexpected request ' + url);
    return route.abort();
  });
  await page.addInitScript(() => {
    const no = () => { throw Error('Forbidden integration'); };
    navigator.mediaDevices.getUserMedia = no; window.fetch = no; window.WebSocket = no; window.RTCPeerConnection = no;
    window.AudioContext = no; window.webkitAudioContext = no; window.SpeechRecognition = no;
    Storage.prototype.setItem = no; Storage.prototype.getItem = no; indexedDB.open = no;
  });
}
const scenario = async (page, state) => { await page.evaluate(s => window.baseline.selectScenario(s), state); await settle(page); };
const orbPixels = page => page.locator('.hud-canvas').evaluate(c => c.toDataURL());
const mood = page => page.locator('.voice-mode').getAttribute('data-mood');
const MAIN = ['connecting', 'listening', 'thinking', 'speaking', 'muted', 'ended', 'failed', 'show-text', 'long-caption'];
try {
  for (const width of [1680, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await prepare(page);
    await page.goto(origin + '/voice/before/');
    await page.locator('.voice-orb canvas').waitFor();
    await settle(page);
    const states = await page.evaluate(() => window.baseline.scenarios), baseline = {};
    for (const state of states) { await scenario(page, state); baseline[state] = await metrics(page); }
    await page.goto(study);
    await page.locator('.hud-canvas[data-ready]').waitFor();
    await settle(page);
    assert.equal(await page.locator('.voice-orb canvas').count(), 1, 'Only the study renderer; no hidden baseline orb');
    for (const state of states) {
      await scenario(page, state);
      const m = await metrics(page);
      assert.deepEqual(m, baseline[state], `${state} ${width}: surrounding UI identical to baseline`);
      assert.equal(m.overflowX, false, 'No horizontal overflow');
      const a = await orbPixels(page);
      await page.waitForTimeout(150);
      assert.equal(await orbPixels(page), a, `Reduced motion static: ${state}`);
      if (MAIN.includes(state)) await page.screenshot({ path: `${out}/${state}-reduced-${width}.png` });
      results.push({ state, width, baselineMatch: true, overflowX: false, overflowYMatchesBaseline: m.overflowY === baseline[state].overflowY, reducedMotionStatic: true });
    }
    // Existing controls, mouse and keyboard.
    await scenario(page, 'listening');
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    assert.equal(await mood(page), 'muted');
    await page.getByRole('button', { name: 'Unmute', exact: true }).click();
    assert.equal(await mood(page), 'listening');
    await page.getByRole('button', { name: 'What Kleio Voice can do', exact: true }).click();
    await page.getByRole('dialog', { name: 'What Kleio Voice can do' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: 'What Kleio Voice can do' }).count(), 0);
    assert.equal(await page.locator('.voice-mode').count(), 1, 'Escape closes only the guide');
    await page.getByRole('button', { name: 'Hang up', exact: true }).click();
    assert.equal(await mood(page), 'ended');
    await page.getByRole('button', { name: 'Talk again', exact: true }).click();
    assert.equal(await mood(page), 'listening');
    await page.getByRole('button', { name: 'Mute', exact: true }).focus();
    await page.keyboard.press('Space');
    assert.equal(await mood(page), 'muted');
    await page.keyboard.press('Space');
    assert.equal(await mood(page), 'listening');
    // Live motion.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => window.hud.snapshot().reduced === false);
    const plans = { connecting: [0.3, 0.9, 1.5, 2.1, 2.9, 4.0], listening: [0.4, 1.55, 2.6, 5.2], thinking: [0.2, 0.5, 0.8, 1.2, 2.4, 3.6], speaking: [0.42, 0.86, 2.55, 3.1, 4.05, 6.5] };
    for (const [state, frames] of Object.entries(plans)) {
      await scenario(page, state);
      const a = await page.evaluate(() => window.hud.snapshot());
      const pa = await orbPixels(page);
      await page.waitForTimeout(500);
      const b = await page.evaluate(() => window.hud.snapshot());
      assert(b.age > a.age && b.drawn > a.drawn, `${state}: live clock advances and renders`);
      assert.notEqual(await orbPixels(page), pa, `${state}: live pixels change`);
      const shots = [];
      for (const t of frames) {
        await page.evaluate(t => window.hud.seek(t), t);
        await page.waitForTimeout(90);
        await page.locator('.voice-stage').screenshot({ path: `${out}/${state}-t${t}-${width}.png` });
        shots.push(await orbPixels(page));
      }
      assert.equal(new Set(shots).size, frames.length, `${state}: each sampled moment renders differently`);
      await page.evaluate(() => window.hud.seek(null));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/${state}-live-${width}.png` });
      motion.push({ state, width, frames, liveClock: true, renderedChanges: true });
    }
    // Muted and ended settle and then hold still even with motion enabled.
    for (const state of ['muted', 'ended']) {
      await scenario(page, state);
      await page.waitForTimeout(1300);
      const a = await orbPixels(page);
      await page.waitForTimeout(400);
      assert.equal(await orbPixels(page), a, `${state}: still after settling`);
    }
    // Indexed rings stay put when thinking hands over to speaking.
    await scenario(page, 'thinking');
    await page.waitForTimeout(2300);
    const before = (await page.evaluate(() => window.hud.snapshot())).pose;
    await scenario(page, 'speaking');
    const after = (await page.evaluate(() => window.hud.snapshot())).pose;
    for (const key of ['seg', 'dots', 'outer']) assert(Math.abs(after[key] - before[key]) < 1e-3, `${key} continuous across state change`);
    assert(Math.abs(before.seg) > .4, 'Thinking indexed at least one detent');
    // A live switch to reduced motion stops the orb.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle(page);
    const still = await orbPixels(page);
    await page.waitForTimeout(300);
    assert.equal(await orbPixels(page), still, 'Live reduced-motion preference stops the orb');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => window.hud.snapshot().reduced === false);
    // Hidden page pauses.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const hidden = await page.evaluate(() => window.hud.snapshot());
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => window.hud.snapshot()), hidden, 'Hidden page pauses');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.voice-mode').count(), 0, 'Escape closes voice mode');
    controls.push({ width, mute: true, unmute: true, guide: true, hangUp: true, talkAgain: true, keyboard: true, escape: true });
    await page.close();
  }
  // Retina detail crops (extra evidence, not a requirement).
  const detail = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 2 });
  await prepare(detail);
  for (const [state, t] of [['listening', 3], ['thinking', 2.4], ['speaking', 2.55], ['connecting', 0.9], ['muted', 0], ['ended', 0]]) {
    await detail.goto(`${study}?state=${state}&frame=${t}`);
    await detail.locator('.hud-canvas[data-ready]').waitFor();
    await detail.waitForTimeout(700);
    assert.equal(await detail.locator('.hud-canvas').evaluate(c => c.width), 760, 'Canvas follows device pixel ratio');
    await detail.locator('.voice-stage').screenshot({ path: `${out}/${state}-detail@2x.png` });
  }
  await detail.close();
  // Real-time recordings of the looping preview, then the existing controls taking over.
  for (const width of [1680, 1024]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'no-preference', recordVideo: { dir: out, size: { width, height: 1000 } } });
    const page = await context.newPage();
    await prepare(page);
    const t0 = Date.now();
    await page.goto(`${study}?demo=1`);
    await page.locator('.hud-canvas[data-ready]').waitFor();
    const loaded = (Date.now() - t0) / 1000;
    await page.waitForTimeout(25500);
    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await page.waitForTimeout(3200);
    assert.equal(await mood(page), 'muted', 'Using a control stops the preview loop');
    await page.getByRole('button', { name: 'Unmute', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Hang up', exact: true }).click();
    await page.waitForTimeout(1500);
    const video = page.video();
    await context.close();
    await video.saveAs(`${out}/demo-${width}.webm`);
    controls.push({ width, demoCancelledByControl: true, loadedAfterSeconds: loaded });
  }
  assert.deepEqual(errors, [], 'Browser errors');
  assert.deepEqual(glErrors, [], 'WebGL validation errors');
  writeFileSync(`${out}/evidence.json`, JSON.stringify({ results, motion, controls, errors, glErrors }, null, 2), { flag: 'wx' });
  console.log(`PASS: ${results.length} baseline/state comparisons; ${motion.length} live motion checks; controls at both widths; reduced motion; hidden pause; continuity; local-only.`);
} finally { await browser.close(); }
