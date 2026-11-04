// Adapted from fmckie/gg-framework WakeScreen.tsx, 9a89e75c6a8ba4f1e372bbdd2b9ca87b1468c1af.
// Copyright (c) 2025 KenKai. MIT license: session-wake-LICENSE.txt.
(() => {
  const screen = document.querySelector('.session-preview #empty .session-wake');
  if (!screen) return;
  const canvas = screen.querySelector('canvas');
  const line = screen.querySelector('.wake-line');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const lines = ['Take a breath…', 'What’s on your mind?', 'Talk to me. I’m listening.'];
  const glyphs = 'アカサタナハマヤラワン0123456789<>[]{}=+*';
  const size = 20;
  const overscan = 160;
  const rainColor = '#ed7380';
  const wash = getComputedStyle(screen).getPropertyValue('--bg').trim();
  let width = 0;
  let height = 0;
  let drops = [];
  let raf = 0;
  let visible = false;
  let last = 0;
  let rainTime = 0;
  let timer = null;
  let deadline = 0;
  let remaining = 450;
  let delay = 450;
  let index = 0;
  let position = 0;
  let phase = 'typing';

  function resize() {
    const w = screen.clientWidth;
    const h = screen.clientHeight + overscan * 2;
    if (w < 2 || h < 2 || (w === width && h === height)) return;
    width = w;
    height = h;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drops = Array.from({ length: Math.max(1, Math.floor(w / size)) }, () =>
      Math.floor(Math.random() * h / size));
  }

  function rain() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillStyle = rainColor;
    drops.forEach((drop, i) => {
      ctx.globalAlpha = 1;
      ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * size, drop * size);
      // Reset only after the head and trail have passed the visible bottom gutter.
      drops[i] = drop * size > height && Math.random() > 0.975 ? -1 : drop + 1;
    });
    ctx.globalAlpha = 1;
  }

  function type() {
    if (phase === 'typing') {
      position++;
      line.textContent = lines[index].slice(0, position);
      delay = 55;
      if (position === lines[index].length) {
        phase = index === lines.length - 1 ? 'done' : 'holding';
        delay = 1400;
      }
    } else if (phase === 'holding') {
      phase = 'erasing';
      delay = 22;
    } else if (phase === 'erasing') {
      position--;
      line.textContent = lines[index].slice(0, position);
      delay = 22;
      if (position === 0) {
        index++;
        phase = 'typing';
        delay = 220;
      }
    }
  }

  function scheduleTyping() {
    if (phase === 'done') return;
    deadline = performance.now() + remaining;
    timer = setTimeout(() => {
      timer = null;
      type();
      remaining = delay;
      scheduleTyping();
    }, remaining);
  }

  function pauseTyping() {
    if (timer === null) return;
    // Keep the unspent part of the delay rather than restarting it on resume.
    remaining = Math.max(0, deadline - performance.now());
    clearTimeout(timer);
    timer = null;
  }

  function frame(now) {
    const delta = last ? Math.min(now - last, 100) : 0;
    last = now;
    rainTime += delta;
    if (rainTime >= 70) {
      rain();
      rainTime = 0;
    }
    raf = requestAnimationFrame(frame);
  }

  function sync() {
    pauseTyping();
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    const run = visible && !document.hidden && !reduced.matches;
    screen.classList.toggle('wake-running', run);
    screen.classList.toggle('wake-animated', !reduced.matches);
    if (reduced.matches) {
      line.textContent = lines[lines.length - 1];
      phase = 'done';
      ctx.clearRect(0, 0, width, height);
    }
    if (run) {
      scheduleTyping();
      resize();
      raf = requestAnimationFrame(frame);
    }
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  const sizing = new ResizeObserver(() => {
    if (!document.hidden && visible && !reduced.matches) resize();
  });
  observer.observe(screen);
  sizing.observe(screen);
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => {
    pauseTyping();
    cancelAnimationFrame(raf);
    raf = 0;
    screen.classList.remove('wake-running');
  });
  window.addEventListener('pageshow', sync);
  sync();
})();
