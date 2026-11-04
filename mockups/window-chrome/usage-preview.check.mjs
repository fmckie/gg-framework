import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const shots = 'mockups/window-chrome/usage-checks';
mkdirSync(shots, { recursive: true });
// Reuse every approved Model regression against this page without altering baseline captures.
const regression = readFileSync('mockups/window-chrome/model-preview.check.mjs', 'utf8')
  .replaceAll('window-chrome/model-preview.html', 'window-chrome/usage-preview.html')
  .replaceAll('mockups/window-chrome/model-', `${shots}/model-`);
const result = spawnSync(process.execPath, ['--input-type=module'], { input: regression, encoding: 'utf8' });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'Approved Model regressions');
const browser = await chromium.launch();
try {
  for (const width of [1680, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4791/window-chrome/usage-preview.html');
    for (const state of ['conversation', 'empty']) {
      const root = page.locator(`#${state}`);
      await root.scrollIntoViewIfNeeded();
      const trigger = root.locator('.context-control');
      const popover = root.getByRole('dialog', { name: 'Usage' });
      const close = root.getByRole('button', { name: 'Close Usage' });
      const draft = root.locator('.field .input');
      const thinking = root.locator('.thinking');
      await draft.fill('Usage must preserve this draft.');
      await root.locator('input[type=file]').setInputFiles({ name: 'usage-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Local fixture') });
      const geometry = () => root.locator('.field, .panel-entry-bar, .status').evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y + scrollY, r.width, r.height]; }));
      const baseline = await geometry();
      await trigger.focus();
      await page.keyboard.press('Enter');
      assert(await popover.isVisible());
      assert(await close.evaluate(e => e === document.activeElement));
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      assert.equal(await popover.getAttribute('aria-modal'), 'false');
      assert.equal(await popover.getByRole('meter').getAttribute('aria-valuenow'), state === 'empty' ? '0' : '19');
      assert.match(await popover.textContent(), /Illustrative sample data/);
      assert(!/week|spending|health|XP|Starforge/i.test(await popover.textContent()));
      assert.equal(await popover.locator('button').count(), 1);
      assert.deepEqual(await geometry(), baseline);
      const checkAnchor = async () => {
        const p = await popover.boundingBox();
        const t = await trigger.boundingBox();
        assert(Math.abs(p.y + p.height + 8 - t.y) < 1);
        assert(p.x >= 0 && p.x + p.width <= width && p.y >= 0);
        assert(p.x <= t.x + t.width && p.x + p.width >= t.x);
        assert.equal(await popover.evaluate(e => e.scrollWidth > e.clientWidth), false);
      };
      await checkAnchor();
      assert.equal(await close.evaluate(e => getComputedStyle(e).outlineWidth), '2px');
      await root.locator('.kleio-code').screenshot({ path: `${shots}/usage-${state}-open-${width}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
      assert(await trigger.evaluate(e => e === document.activeElement));
      await root.locator('.kleio-code').screenshot({ path: `${shots}/usage-${state}-returned-${width}.png` });
      await trigger.click();
      await close.click();
      assert(await trigger.evaluate(e => e === document.activeElement));
      await trigger.click();
      await trigger.click();
      assert.equal(await popover.count(), 0);
      await trigger.click();
      await draft.click();
      assert(await draft.evaluate(e => e === document.activeElement));
      assert.equal(await popover.count(), 0);
      await trigger.click();
      await thinking.click();
      assert(await thinking.evaluate(e => e === document.activeElement));
      assert.equal(await thinking.textContent(), 'Thinking Medium');
      await trigger.click();
      await page.keyboard.press('Tab');
      assert(await thinking.evaluate(e => e === document.activeElement));
      assert.equal(await popover.count(), 0);
      await trigger.click();
      await page.keyboard.press('Shift+Tab');
      assert(await trigger.evaluate(e => e === document.activeElement));
      await page.keyboard.press('Escape');
      await trigger.click();
      await page.evaluate(() => scrollBy(0, 32));
      await checkAnchor();
      await page.keyboard.press('Escape');
      await root.locator('.model-trigger').click();
      await root.getByRole('radio', { name: 'High', exact: true }).check();
      await trigger.click();
      await page.keyboard.press('Escape');
      assert(await root.locator('.model-panel').isVisible());
      assert.equal(await thinking.textContent(), 'Thinking High');
      await root.locator('.model-use').click();
      assert.equal(await thinking.textContent(), 'Thinking High');
      assert.equal(await draft.evaluate(e => e.value ?? e.textContent), 'Usage must preserve this draft.');
      assert.equal(await root.locator('input[type=file]').evaluate(e => e.files[0].name), 'usage-note.txt');
      assert.deepEqual(await geometry(), baseline);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`PASS Usage ${width}px ${state}: dismissals, focus, anchoring, draft/files, Model coexistence`);
    }
    const sampleColors = [];
    for (const value of [10, 50, 95]) {
      await page.goto('about:blank');
      await page.route('**/usage-preview.html', async route => {
        const response = await route.fetch();
        const html = (await response.text()).replace('<span class="context-value">19%</span>', `<span class="context-value">${value}%</span>`);
        await route.fulfill({ response, body: html });
      });
      await page.goto('http://127.0.0.1:4791/window-chrome/usage-preview.html#conversation');
      const root = page.locator('#conversation');
      const trigger = root.locator('.context-control');
      const anchors = () => root.locator('.panel-entry-bar, .status').evaluateAll(es => es.map(e => e.getBoundingClientRect().top + scrollY));
      const baseline = await anchors();
      await trigger.click();
      const popover = root.getByRole('dialog', { name: 'Usage' });
      assert.equal(await trigger.locator('.context-value').textContent(), `${value}%`);
      assert.equal(await popover.locator('strong').textContent(), `${value}%`);
      assert.equal(await popover.getByRole('meter').getAttribute('aria-valuenow'), String(value));
      const fills = await root.locator('.context-track i, .usage-meter i').evaluateAll(es => es.map(e => ({
        color: getComputedStyle(e).backgroundColor,
        image: getComputedStyle(e).backgroundImage,
        width: e.style.width,
      })));
      assert.deepEqual(fills[0], fills[1]);
      assert.equal(fills[0].image, 'none');
      assert.equal(fills[0].width, `${value}%`);
      const rgb = fills[0].color.match(/[\d.]+/g).map(Number);
      if (value === 10) assert(rgb[1] > rgb[0] && rgb[0] > rgb[2]);
      if (value === 50) assert(rgb[0] === rgb[1] && rgb[1] > rgb[2]);
      if (value === 95) assert(rgb[0] > rgb[1] && rgb[1] > rgb[2]);
      sampleColors.push(fills[0].color);
      assert.deepEqual(await anchors(), baseline);
      const p = await popover.boundingBox();
      const t = await trigger.boundingBox();
      assert(Math.abs(p.y + p.height + 8 - t.y) < 1);
      assert(p.x >= 0 && p.x + p.width <= width && p.y >= 0);
      assert.equal(await popover.evaluate(e => e.scrollWidth > e.clientWidth), false);
      await root.locator('.kleio-code').screenshot({ path: `${shots}/usage-color-${value}-${width}.png` });
      await page.unroute('**/usage-preview.html');
    }
    assert.equal(new Set(sampleColors).size, 3);
    await page.goto('about:blank');
    await page.goto('http://127.0.0.1:4791/window-chrome/usage-preview.html#conversation');
    assert.equal(await page.locator('#conversation .context-value').textContent(), '19%');
    assert.equal(await page.locator('#empty .context-value').textContent(), '0%');
    console.log(`PASS Usage colors ${width}px: illustrative 10/50/95%, matching solid fills, numeric labels, geometry; defaults restored`);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
