import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const url = 'http://127.0.0.1:4791/window-chrome/session-preview.html';
const output = 'mockups/window-chrome/session-wake';
try {
  for (const width of [1680, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      window.rainDraws = [];
      CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
        if (this.canvas.matches('.wake-rain')) {
          window.rainDraws.push({ x, y });
          if (window.rainDraws.length > 30000) window.rainDraws.shift();
        }
        return fillText.call(this, text, x, y, ...rest);
      };
    });
    await page.clock.install();
    await page.goto(url);
    assert.equal(await page.locator('#chats .toolbar').count(), 0);
    assert.equal(await page.locator('#chats .browser-controls .new-chat').count(), 1);
    assert.equal(await page.locator('.title-row .session-identity').count(), 2);
    assert.equal(await page.locator('.kleio-code > .session-identity').count(), 0);
    assert.equal(await page.locator('canvas').count(), 1);
    assert.equal(await page.locator('#empty canvas[aria-hidden=true]').count(), 1);
    assert.equal(await page.locator('#empty canvas').evaluate(e => getComputedStyle(e).opacity), '0.85');
    assert.equal(await page.locator('.wake-copy p').evaluate(e => getComputedStyle(e).color), 'rgb(211, 201, 202)');
    assert.equal(await page.locator('#empty .wake-treatment[aria-hidden=true]').count(), 1);
    assert.equal(await page.locator('#empty .wake-copy').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
    const geometry = () => page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      clipped: [...document.querySelectorAll('.session-title,.session-identity h3,.toolbar,.title-row,.browser-heading,.wake-copy')]
        .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className),
      collisions: [...document.querySelectorAll('.title-row')].flatMap(row => [...row.children].slice(1)
        .filter(e => e.getBoundingClientRect().left < e.previousElementSibling.getBoundingClientRect().right - 1).map(e => e.className)),
    }));
    const cleanGeometry = { overflow: false, clipped: [], collisions: [] };
    assert.deepEqual(await geometry(), cleanGeometry);
    const controls = page.locator('.session-identity button, .browser-controls .new-chat, .session-item');
    for (const control of await controls.all()) {
      await control.hover();
      assert.equal(await control.evaluate(e => getComputedStyle(e).color), 'rgb(148, 162, 196)');
      await control.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      assert(await control.evaluate(e => e === document.activeElement && e.matches(':focus-visible')));
      assert.equal(await control.evaluate(e => getComputedStyle(e).outlineWidth), '2px');
    }
    for (const state of ['conversation', 'empty']) {
      await page.locator(`#${state} .session-identity button`).focus();
      await page.locator(`#${state} .kleio-code`).screenshot({ path: `${output}-${state}-focus-${width}.png` });
    }
    await page.locator('#chats .session-item').nth(7).hover();
    await page.locator('#chats .kleio-code').screenshot({ path: `${output}-list-hover-${width}.png` });
    const heading = page.locator('#conversation .session-identity h3');
    const title = await heading.textContent();
    await heading.evaluate(e => { e.textContent += ' — compare creator partnerships, conversion results and lessons for a recipe app before deciding what to try next'; });
    assert.deepEqual(await geometry(), cleanGeometry);
    await page.locator('#conversation .kleio-code').screenshot({ path: `${output}-long-title-${width}.png` });
    await heading.evaluate((e, text) => { e.textContent = text; }, title);
    await page.locator('#empty .session-wake').scrollIntoViewIfNeeded();
    await page.locator('#empty .wake-running').waitFor();
    await page.clock.runFor(1800);
    const capture = () => page.locator('#empty canvas').evaluate(e => e.toDataURL());
    const first = await capture();
    assert.equal(await page.locator('#empty canvas').evaluate(e => e.getContext('2d').fillStyle), '#ed7380');
    assert.match(await page.locator('#empty canvas').evaluate(e => e.getContext('2d').font), /^(700|bold) 20px /);
    assert.equal(await page.locator('.wake-treatment').evaluate(e => getComputedStyle(e).color), 'rgb(232, 224, 220)');
    assert.equal(await page.locator('.wake-cursor').evaluate(e => getComputedStyle(e).color), 'rgb(166, 156, 157)');
    assert(await page.locator('#empty canvas').evaluate(e => {
      const pixels = e.getContext('2d').getImageData(0, 0, e.width, e.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 180 && pixels[i] - pixels[i + 1] > 60 && pixels[i] - pixels[i + 2] > 60) red++;
      }
      return red > 100;
    }));
    const firstText = await page.locator('.wake-line').textContent();
    assert(firstText.length > 0);
    await page.locator('.session-scroll').evaluate(e => { e.scrollTop = 0; });
    await page.screenshot({ path: `${output}-all-${width}.png`, fullPage: true });
    await page.locator('#empty .kleio-code').screenshot({ path: `${output}-early-${width}.png` });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const midTyping = await page.locator('.wake-line').textContent();
    const midRain = await capture();
    await page.clock.runFor(2000);
    assert.equal(await page.locator('.wake-line').textContent(), midTyping);
    assert.equal(await capture(), midRain);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(16000);
    assert.notEqual(await capture(), first);
    assert.equal(await page.locator('.wake-line').textContent(), 'Talk to me. I’m listening.');
    await page.locator('#empty .kleio-code').screenshot({ path: `${output}-final-${width}.png` });
    const fieldGeometry = await page.locator('.session-wake').evaluate(screen => {
      const field = screen.querySelector('.wake-field').getBoundingClientRect();
      const canvas = screen.querySelector('canvas').getBoundingClientRect();
      const dock = document.querySelector('#empty .dock').getBoundingClientRect();
      const chrome = document.querySelector('#empty .chrome').getBoundingClientRect();
      return { width: screen.clientWidth, height: screen.clientHeight,
        fillWidth: field.width, fillHeight: field.height, topGap: field.top - chrome.bottom,
        bottomGap: dock.top - field.bottom, overscanTop: field.top - canvas.top,
        overscanBottom: canvas.bottom - field.bottom };
    });
    assert.equal(fieldGeometry.fillWidth, fieldGeometry.width);
    assert.equal(fieldGeometry.fillHeight, fieldGeometry.height);
    assert(Math.abs(fieldGeometry.topGap) <= 1);
    assert.equal(fieldGeometry.bottomGap, 0);
    assert.equal(fieldGeometry.overscanTop, 160);
    assert.equal(fieldGeometry.overscanBottom, 160);
    assert(await page.evaluate(height => window.rainDraws.some(d => d.y > height + 180), fieldGeometry.height));
    console.log(width, 'full background / 160px overscan / drops beyond visible bottom PASS');
    const canvasRect = await page.locator('#empty .wake-field').boundingBox();
    const clip = { x: canvasRect.x + 30, y: canvasRect.y + 30, width: 420, height: 180 };
    await page.screenshot({ path: `${output}-glyphs-close-${width}.png`, clip });
    const rendered = await page.locator('#empty .wake-field').screenshot();
    const lightRedCount = await page.evaluate(async base64 => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const surface = new OffscreenCanvas(image.width, image.height);
      const context = surface.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 180 && pixels[i + 1] > 70 && pixels[i + 2] > 70 &&
          pixels[i] - pixels[i + 1] > 60 && pixels[i] - pixels[i + 2] > 60) count++;
      }
      return count;
    }, rendered.toString('base64'));
    assert(lightRedCount > 100, `Only ${lightRedCount} rendered light-red pixels`);
    await page.clock.runFor(700);
    await page.screenshot({ path: `${output}-glyphs-later-${width}.png`, clip });
    const bottomClip = { x: canvasRect.x + 30, y: canvasRect.y + canvasRect.height - 160, width: Math.min(600, canvasRect.width - 60), height: 175 };
    for (let tick = 0; tick < 3; tick++) {
      await page.screenshot({ path: `${output}-bottom-${width}-${tick}.png`, clip: bottomClip });
      await page.clock.runFor(350);
    }
    const protectedText = await page.locator('.session-wake').evaluate(screen => {
      const bounds = screen.querySelector('.wake-field').getBoundingClientRect();
      return [...screen.querySelectorAll('.wake-line, .wake-copy p')].every(e => {
        const range = document.createRange();
        range.selectNodeContents(e);
        const rect = range.getBoundingClientRect();
        return [rect.left, rect.right].every(x => [rect.top, rect.bottom].every(y =>
          Math.hypot((x - bounds.x - bounds.width / 2) / 260,
            (y - bounds.y - bounds.height / 2) / 80) < .7));
      });
    });
    assert(protectedText, 'Foreground text must fit inside the fully transparent mask center');
    assert.equal(await page.locator('.wake-field').evaluate(e => getComputedStyle(e).maskComposite), 'intersect, intersect, intersect');
    console.log(`${width}px: ${lightRedCount} visible light-red pixels; foreground inside rain-free center`);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const paused = await capture();
    assert.equal(await page.locator('.wake-running').count(), 0);
    await page.clock.runFor(5000);
    assert.equal(await capture(), paused);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(500);
    assert.notEqual(await capture(), paused);
    // An opaque red canvas tests a stricter peak than any glyph frame.
    await page.locator('#empty canvas').evaluate(e => {
      const ctx = e.getContext('2d');
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ed7380';
      ctx.fillRect(0, 0, e.width, e.height);
    });
    await page.locator('#empty .kleio-code').screenshot({ path: `${output}-peak-${width}.png` });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.wake-rain').evaluate(e => getComputedStyle(e).display), 'none');
    assert.equal(await page.locator('.wake-treatment').evaluate(e => getComputedStyle(e).display), 'none');
    assert.equal(await page.locator('.wake-static').evaluate(e => getComputedStyle(e).position), 'static');
    await page.clock.runFor(32);
    await page.locator('.wake-animated').waitFor({ state: 'detached' });
    const still = await capture();
    await page.clock.runFor(2000);
    assert.equal(await capture(), still);
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length), 0);
    await page.screenshot({ path: `${output}-reduced-${width}.png`, fullPage: true });
    await page.reload();
    assert.equal(await page.locator('.wake-static').textContent(), 'Talk to me. I’m listening.');
    assert((await page.locator('.session-wake').ariaSnapshot()).includes('heading "Talk to me. I’m listening."'));
    assert.equal(await page.locator('.wake-animated').count(), 0);
    assert.deepEqual(await geometry(), cleanGeometry);
    assert.deepEqual(errors, []);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      window.wakeTiming = { start: null, changes: [] };
      document.addEventListener('DOMContentLoaded', () => {
        const screen = document.querySelector('.session-wake');
        const line = screen.querySelector('.wake-line');
        new MutationObserver(() => {
          if (screen.classList.contains('wake-running') && window.wakeTiming.start === null) {
            window.wakeTiming.start = performance.now();
          }
        }).observe(screen, { attributes: true, attributeFilter: ['class'] });
        new MutationObserver(() => {
          window.wakeTiming.changes.push({ time: performance.now(), text: line.textContent });
        }).observe(line, { childList: true });
      });
    });
    await page.goto(`${url}#empty`);
    await page.reload();
    await page.locator('.wake-running').waitFor();
    await page.clock.runFor(10000);
    const timing = await page.evaluate(() => window.wakeTiming);
    const expected = [];
    let at = 450;
    for (const [i, text] of ['Take a breath…', 'What’s on your mind?', 'Talk to me. I’m listening.'].entries()) {
      for (let n = 1; n <= text.length; n++) {
        expected.push({ time: at, text: text.slice(0, n) });
        if (n < text.length) at += 55;
      }
      if (i === 2) break;
      at += 1400 + 22;
      for (let n = text.length - 1; n >= 0; n--) {
        expected.push({ time: at, text: text.slice(0, n) });
        if (n > 0) at += 22;
      }
      at += 220;
    }
    assert.equal(timing.changes.length, expected.length);
    for (const [i, change] of timing.changes.entries()) {
      assert.equal(change.text, expected[i].text);
      assert(Math.abs(change.time - timing.start - expected[i].time) <= 1,
        `Typing event ${i}: ${change.time - timing.start}ms vs ${expected[i].time}ms`);
    }
    assert.deepEqual(errors, []);
    console.log(`${width}px: geometry, hover/focus, animation, hidden pause/resume, reduced motion, exact typing timeline (${expected.length} events), no browser errors PASS`);
    await page.close();
  }
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.goto(url);
  assert(await page.locator('.wake-static').isVisible());
  assert.equal(await page.locator('.wake-treatment').isVisible(), false);
  await page.close();
  console.log('No-JavaScript static invitation PASS');
} finally {
  await browser.close();
}
const rgb = hex => hex.match(/\w\w/g).map(value => parseInt(value, 16));
const luminance = values => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const ratio = (fg, bg) => (luminance(fg) + .05) / (luminance(bg) + .05);
// Geometry assertions above ensure peak rain is fully masked beneath foreground text.
const peak = rgb('431419');
const wakeMinimum = Math.min(...['e8e0dc', 'd3c9ca'].map(fg => ratio(rgb(fg), peak)));
assert(wakeMinimum >= 4.5);
let minimum = Infinity;
for (const fg of ['f6f1f1', 'e8e0dc', 'd3c9ca', 'a69c9d', '94a2c4', 'ae8848']) {
  for (const bg of ['100e0f', '161213', '431419', '1d1819', '241f20']) {
    minimum = Math.min(minimum, ratio(rgb(fg), rgb(bg)));
  }
}
assert(minimum >= 4.5);
console.log(`Peak rain text contrast ${wakeMinimum.toFixed(2)}:1; non-rain palette minimum ${minimum.toFixed(2)}:1 PASS`);
