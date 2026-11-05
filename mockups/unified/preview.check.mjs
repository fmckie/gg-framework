import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
const shots = 'mockups/unified/checks';
mkdirSync(shots, { recursive: true });
const regression = readFileSync('mockups/window-chrome/model-preview.check.mjs', 'utf8')
  .replaceAll('window-chrome/model-preview.html', 'unified/index.html')
  .replaceAll('mockups/window-chrome/model-', `${shots}/model-`)
  .replace('const root = page.locator(`#${state}`);', 'await page.selectOption("#preview-state", state); const root = page.locator(`#${state}`);')
  .replace("const root = page.locator('#conversation');", "await page.selectOption('#preview-state', 'conversation'); const root = page.locator('#conversation');");
const result = spawnSync(process.execPath, ['--input-type=module'], { input: regression, encoding: 'utf8' });
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
assert.equal(result.status, 0, 'Unmodified Model assertions against unified preview');
const browser = await chromium.launch();
try {
  for (const width of [1680, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto('http://127.0.0.1:4791/unified/index.html');
    const select = state => page.selectOption('#preview-state', state);
    const root = page.locator('#conversation');
    const draft = root.locator('.field .input');
    await draft.fill('Unified draft survives all samples.');
    assert.equal(await draft.evaluate(e => e.contentEditable), 'plaintext-only');
    assert(await draft.evaluate(e => [e, ...e.querySelectorAll('*')].every(node => getComputedStyle(node).webkitTextFillColor !== 'rgba(0, 0, 0, 0)')), 'Typed draft text remains visible after replacing a decorative mention');
    await root.locator('input[type=file]').setInputFiles({ name: 'preview.txt', mimeType: 'text/plain', buffer: Buffer.from('local mock fixture') });
    const anchors = () => root.locator('.panel-entry-bar, .status').evaluateAll(es => es.map(e => e.getBoundingClientRect().top + scrollY));
    const baseline = await anchors();
    for (const state of ['conversation', 'empty', 'chats', 'plan-pending', 'plan-approved', 'help', 'help-sent', 'home']) {
      await select(state);
      assert.equal(await page.locator('main > .panel-sample:visible, main > #home:visible').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (state !== 'home') {
        const window = page.locator('main > .panel-sample:visible .kleio-code');
        const box = await window.boundingBox();
        assert.equal(box.height, 788);
        assert.equal(box.width, width === 1680 ? 1560 : 952);
        assert.equal(await window.locator('.tools, .bar').count(), 0);
      } else {
        const home = page.frameLocator('#home iframe');
        await home.locator('.kleio-wordmark').waitFor();
        assert.deepEqual(await home.locator('.home').evaluate(e => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]), [1024, 720]);
        assert.equal(await home.locator('.kleio-wordmark').evaluate(e => getComputedStyle(e).fontSize), '46px');
        await home.getByRole('button', { name: 'Code', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert(await home.getByRole('button', { name: /Specialists/ }).evaluate(e => e === document.activeElement));
      }
      if (state === 'plan-pending') {
        await page.screenshot({ path: `${shots}/plan-pending-top-${width}.png`, fullPage: true });
        assert.equal(await root.locator('.plan-head-title').textContent(), 'Plan review');
        await root.locator('.plan-feedback').fill('Keep the boundary regression test.');
        await root.locator('.plan-feedback').focus();
        await page.keyboard.press('Tab'); assert(await root.locator('.plan-reject').evaluate(e => e === document.activeElement));
        await page.keyboard.press('Tab'); assert(await root.locator('.plan-approve').evaluate(e => e === document.activeElement));
        assert.equal(await root.locator('.plan-head-title').evaluate(e => getComputedStyle(e).color), 'color(srgb 0.743843 0.624784 0.404706)');
        await root.locator('.transcript').hover(); await page.mouse.wheel(0, 900);
        await page.waitForFunction(() => document.querySelector('#conversation .transcript').scrollTop > 0);
        assert(await root.locator('.plan-actions').evaluate(e => { const a=e.getBoundingClientRect(), t=e.closest('.transcript').getBoundingClientRect(); return a.top>=t.top && a.bottom<=t.bottom+1; }));
        assert.deepEqual(await anchors(), baseline);
      }
      if (state === 'help') {
        await root.locator('.send-kleio').focus();
        await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
        assert.equal(await root.locator('.send-kleio').evaluate(e => getComputedStyle(e).outlineWidth), '2px');
        assert.equal(await root.locator('.prompt').evaluate(e => getComputedStyle(e).borderRadius), '6px');
      }
      if (state === 'help-sent') assert.equal(await root.locator('.is-sent .i').evaluate(e => getComputedStyle(e).color), 'rgb(184, 151, 90)');
      await page.screenshot({ path: `${shots}/${state}-${width}.png`, fullPage: true });
    }
    await select('plan-pending');
    assert.equal(await root.locator('.plan-feedback').inputValue(), 'Keep the boundary regression test.');
    await root.locator('.model-trigger').click();
    assert.equal(await page.locator('#preview-state').inputValue(), 'conversation');
    assert(await root.locator('.model-panel').isVisible());
    await page.keyboard.press('Escape');
    await select('plan-pending');
    assert.equal(await root.locator('.plan-feedback').inputValue(), 'Keep the boundary regression test.');
    await select('conversation');
    assert.equal(await draft.textContent(), 'Unified draft survives all samples.');
    assert.equal(await root.locator('input[type=file]').evaluate(e => e.files[0].name), 'preview.txt');
    for (const state of ['conversation', 'empty']) {
      await select(state);
      const sample = page.locator(`#${state}`);
      const context = sample.locator('.context-control');
      const usage = sample.locator('.usage-popover');
      for (const dismissal of ['escape', 'close', 'toggle', 'outside', 'focus']) {
        await context.click(); assert(await usage.isVisible());
        assert(await sample.locator('.usage-close').evaluate(e => e === document.activeElement));
        await page.screenshot({ path: `${shots}/usage-${state}-${dismissal}-${width}.png`, fullPage: true });
        if (dismissal === 'escape') await page.keyboard.press('Escape');
        if (dismissal === 'close') await sample.locator('.usage-close').click();
        if (dismissal === 'toggle') await context.click();
        if (dismissal === 'outside') await sample.locator('.thinking').click();
        if (dismissal === 'focus') await sample.locator('.thinking').focus();
        assert(!(await usage.isVisible()));
        if (['escape','close','toggle'].includes(dismissal)) assert(await context.evaluate(e => e === document.activeElement));
        else assert(await sample.locator('.thinking').evaluate(e => e === document.activeElement));
      }
      await sample.locator('.more-entry').click();
      assert.deepEqual(await sample.locator('.more-panel .priority-actions button').allTextContents(), ['Checklist', 'Project Health']);
      await page.screenshot({ path: `${shots}/more-${state}-${width}.png`, fullPage: true });
      await context.click(); await page.keyboard.press('Escape');
      assert(await sample.locator('.more-panel').isVisible());
      await page.keyboard.press('Escape'); assert(!(await sample.locator('.more-panel').isVisible()));
      await sample.locator('.branch-entry').click();
      await sample.locator('.change-scroll').hover(); await page.mouse.wheel(0, 600);
      await page.waitForFunction(id => document.querySelector(`#${id} .change-scroll`).scrollTop > 0, state);
      await page.screenshot({ path: `${shots}/branch-${state}-${width}.png`, fullPage: true });
      await select('chats'); await select(state);
      assert(!(await sample.locator('.branch-panel').isVisible()));
    }
    await select('conversation'); assert.deepEqual(await anchors(), baseline);
    await root.locator('.context-control').click(); await select('home');
    assert.equal(await page.locator(':popover-open').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px: 8 states, fixed windows, plan/model separation, feedback/drafts/files, keyboard, scroll, panels and Usage dismissal`);
  }
} finally { await browser.close(); }
