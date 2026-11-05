import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
const shots = 'mockups/unified/checks/final';
mkdirSync(shots, { recursive: true });
const suite = readFileSync('mockups/unified/preview.check.mjs', 'utf8')
  .replace("const shots = 'mockups/unified/checks';", `const shots = '${shots}/regression';`);
const result = spawnSync(process.execPath, ['--input-type=module'], { input: suite, encoding: 'utf8' });
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'Existing unified and Model regressions pass with Mukta Malar');
const browser = await chromium.launch();
const states = ['conversation', 'empty', 'chats', 'plan-pending', 'plan-approved', 'help', 'help-sent', 'home'];
const snapshot = () => [...document.querySelectorAll('main > .panel-sample:not([hidden]) .kleio-code *')].map(e => {
  const s = getComputedStyle(e);
  const targeted = Boolean(e.closest('.prose, .field .input')) && !e.closest('code, pre, kbd');
  return { tag: e.tagName, class: e.className.baseVal ?? e.className, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, color: s.color, background: s.backgroundColor, family: targeted ? 'compared separately' : s.fontFamily };
});
try {
  for (const width of [1680, 1024]) {
    const pages = [];
    const errors = [];
    for (const [i, file] of ['index', 'index'].entries()) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      page.on('request', r => { assert.equal(new URL(r.url()).hostname, '127.0.0.1', 'No runtime external requests'); });
      if (i === 0) await page.route('**/unified/mukta-malar.css', route => route.fulfill({ contentType: 'text/css', body: '' }));
      await page.goto(`http://127.0.0.1:4791/unified/${file}.html`);
      await page.evaluate(() => document.fonts.ready);
      pages.push(page);
    }
    const [baseline, option] = pages;
    await option.evaluate(async () => {
      for (const weight of [400, 500, 600, 700]) await document.fonts.load(weight + ' 15px "Mukta Malar"');
    });
    assert(await option.evaluate(() => [...document.fonts].filter(f => f.family === 'Mukta Malar').every(f => f.status === 'loaded')));
    const cdp = await option.context().newCDPSession(option);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    for (const state of states) {
      for (const [i, page] of pages.entries()) {
        await page.selectOption('#preview-state', state);
        await page.evaluate(() => document.fonts.ready);
        if (state === 'home') {
          await page.frameLocator('#home iframe').locator('.kleio-wordmark').evaluate(e => e.ownerDocument.fonts.ready);
          await page.waitForLoadState('networkidle');
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${state}: page overflow`);
        assert(await page.locator('.panel-sample:visible .prose, .panel-sample:visible .field .input').evaluateAll(es => es.every(e => e.scrollWidth <= e.clientWidth + 1)), `${state}: text overflow`);
        if (i === 1) await page.screenshot({ path: `${shots}/${state}-${width}.png`, fullPage: true });
      }
      assert.deepEqual(await option.evaluate(snapshot), await baseline.evaluate(snapshot), `${state}: metrics, color, non-target families`);
      if (state !== 'home') {
        const geometry = page => page.locator('.panel-sample:visible .kleio-code, .panel-sample:visible .panel-entry-bar, .panel-sample:visible .status').evaluateAll(es => es.map(e => { const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; }));
        assert.deepEqual(await geometry(option), await geometry(baseline), `${state}: frame and anchored controls`);
      } else {
        assert.deepEqual(await option.frameLocator('#home iframe').locator('.kleio-wordmark').evaluate(e => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize]), await baseline.frameLocator('#home iframe').locator('.kleio-wordmark').evaluate(e => [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize]));
      }
      if (!['home', 'chats'].includes(state)) {
        const { root } = await cdp.send('DOM.getDocument');
        const selector = state === 'empty' ? '#empty .field .input' : '#conversation .field .input';
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        assert(fonts.some(f => f.isCustomFont && f.familyName.startsWith('Mukta Malar') && f.glyphCount > 0), `${state}: rendered local composer font`);
      }
      if (state === 'plan-pending') {
        for (const [selector, size, weight] of [['.plan-banner-title', '24px', '400'], ['.plan-head-title', '28px', '600']]) {
          assert.deepEqual(await option.locator(`#conversation ${selector}`).evaluate(e => { const s=getComputedStyle(e); return [s.fontSize,s.fontWeight,s.color]; }), [size,weight,'color(srgb 0.743843 0.624784 0.404706)']);
        }
        assert.equal(await option.locator('#conversation .plan-approve').evaluate(e => getComputedStyle(e).color), 'rgb(184, 151, 90)');
        await option.locator('#conversation .plan-head-title').scrollIntoViewIfNeeded();
        await option.screenshot({ path: `${shots}/plan-review-${width}.png`, fullPage: true });
      }
      console.log(`PASS ${width}px ${state}: local font, unchanged metrics/chrome/colors/anchors, wrapping and overflow`);
    }
    await option.selectOption('#preview-state', 'conversation');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#conversation .prose p' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert(fonts.some(f => f.isCustomFont && f.familyName.startsWith('Mukta Malar') && f.glyphCount > 0), 'Rendered local response font');
    await option.selectOption('#preview-state', 'empty');
    const cursor = option.locator('.wake-cursor');
    assert.equal(await cursor.evaluate(e => getComputedStyle(e).color), 'rgb(237, 115, 128)');
    await option.emulateMedia({ reducedMotion: 'no-preference' });
    await option.reload();
    await option.evaluate(() => document.fonts.ready);
    await option.waitForFunction(() => document.querySelector('.wake-treatment').textContent.includes('Talk to me. I’m listening.'));
    await option.waitForFunction(() => getComputedStyle(document.querySelector('.wake-cursor')).animationName === 'session-wake-blink');
    assert.equal(await cursor.evaluate(e => getComputedStyle(e).animationDuration), '1s');
    await option.screenshot({ path: `${shots}/empty-active-${width}.png`, fullPage: true });
    await option.emulateMedia({ reducedMotion: 'reduce' });
    await option.waitForFunction(() => !document.querySelector('.wake-running'));
    assert.equal(await cursor.evaluate(e => getComputedStyle(e).animationName), 'none');
    assert.equal(await option.locator('.wake-treatment').isVisible(), false);
    assert(await option.locator('.wake-static').isVisible());
    assert.deepEqual(errors, []);
    for (const page of pages) await page.close();
  }
} finally { await browser.close(); }
