// Runs inside the page. Returns everything the audit records for one screen:
// controls (size, variant, order, covered, clipped), fit, text cut off,
// desktop-only words, and hover-only reveals. No app code is touched.
export function measureInPage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r1 = (n) => Math.round(n * 10) / 10;
  const isIos = document.documentElement.classList.contains("platform-ios");

  const shown = (el) => {
    if (!el.isConnected) return false;
    if (el.closest("[inert]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    return true;
  };
  const cls = (el) =>
    (typeof el.className === "string" ? el.className : el.getAttribute("class") || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const tagOf = (el) => {
    const c = cls(el).slice(0, 4).join(".");
    return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (c ? `.${c}` : "");
  };
  const nameOf = (el) => {
    const label = el.labels && el.labels[0] ? el.labels[0].innerText : "";
    // A shortcut hint is not part of the control's name.
    let inner = el.innerText || "";
    if (el.querySelectorAll) for (const k of el.querySelectorAll("kbd")) inner = inner.replace(k.innerText, "");
    const raw =
      el.getAttribute("aria-label") ||
      inner.trim() ||
      label ||
      el.getAttribute("title") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("alt") ||
      el.getAttribute("name") ||
      "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 70);
  };

  // ── controls ──────────────────────────────────────────────────────────
  const CONTROL =
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const hitBox = (el) => {
    const r = el.getBoundingClientRect();
    const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    let widened = false;
    const ecs = getComputedStyle(el);
    if (ecs.position !== "static") {
      for (const pe of ["::before", "::after"]) {
        const cs = getComputedStyle(el, pe);
        if (cs.content === "none" || cs.content === "normal") continue;
        if (cs.position !== "absolute" || cs.pointerEvents === "none") continue;
        const top = parseFloat(cs.top);
        const left = parseFloat(cs.left);
        const w = parseFloat(cs.width);
        const h = parseFloat(cs.height);
        if ([top, left, w, h].some(Number.isNaN)) continue;
        const x = r.left + parseFloat(ecs.borderLeftWidth) + left;
        const y = r.top + parseFloat(ecs.borderTopWidth) + top;
        if (x < box.left - 0.5 || y < box.top - 0.5 || x + w > box.right + 0.5 || y + h > box.bottom + 0.5) {
          widened = true;
        }
        box.left = Math.min(box.left, x);
        box.top = Math.min(box.top, y);
        box.right = Math.max(box.right, x + w);
        box.bottom = Math.max(box.bottom, y + h);
      }
    }
    // A checkbox, radio or switch is tapped through its label.
    const label = el.closest("label") || (el.labels && el.labels[0]);
    if (label && /^(INPUT)$/.test(el.tagName) && /checkbox|radio/.test(el.type)) {
      const l = label.getBoundingClientRect();
      if (l.width > 0) {
        widened = true;
        box.left = Math.min(box.left, l.left);
        box.top = Math.min(box.top, l.top);
        box.right = Math.max(box.right, l.right);
        box.bottom = Math.max(box.bottom, l.bottom);
      }
    }
    return { w: r1(box.right - box.left), h: r1(box.bottom - box.top), widened };
  };
  const variantOf = (el) => {
    const c = cls(el);
    const v = c.filter((k) =>
      /^(btn-(primary|ghost|danger|secondary|outline|link|sm|lg|nav-icon|icon)|icon-circle.*|is-(primary|danger|active|selected|on)|kleio-cloisonne|primary|danger|ghost)$/.test(k),
    );
    const text = (el.innerText || "").trim();
    const hasIcon = Boolean(el.querySelector("svg, img"));
    if (!text && hasIcon) v.push("icon-only");
    else if (text && hasIcon) v.push("icon+text");
    return v.join(" ");
  };
  const GROUP =
    '[role="dialog"], [role="tablist"], [role="toolbar"], [role="menu"], .picker-head, header, footer, nav, form, [class*="-actions"], [class*="-head"], [class*="-foot"], [class*="tabbar"], section, aside';
  const clippedBy = (el) => {
    const r = el.getBoundingClientRect();
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      const cutX = /hidden|clip/.test(cs.overflowX) && (r.left < ar.left - 1 || r.right > ar.right + 1);
      const cutY = /hidden|clip/.test(cs.overflowY) && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1);
      if (cutX || cutY) {
        return {
          by: tagOf(a),
          px: r1(Math.max(ar.left - r.left, r.right - ar.right, ar.top - r.top, r.bottom - ar.bottom)),
        };
      }
      // Content of a scroller is reached by scrolling, not cut.
      if (/auto|scroll/.test(cs.overflowY) || /auto|scroll/.test(cs.overflowX)) return null;
    }
    return null;
  };
  const textShape = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = el.getBoundingClientRect();
    const tops = new Set();
    let spill = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      const pr = n.parentElement;
      if (pr && !shown(pr)) continue;
      const tr = document.createRange();
      tr.selectNodeContents(n);
      for (const q of tr.getClientRects()) {
        if (q.width < 1) continue;
        tops.add(Math.round(q.top / 4));
        spill = Math.max(spill, r.left - q.left, q.right - r.right, r.top - q.top, q.bottom - r.bottom);
      }
    }
    return { lines: tops.size, spill: r1(spill) };
  };
  const covered = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) return undefined;
    const top = document.elementFromPoint(cx, cy);
    if (!top || top === el || el.contains(top) || top.contains(el)) return null;
    const label = el.closest("label");
    if (label && label.contains(top)) return null;
    return tagOf(top);
  };

  const seen = new Set();
  const controls = [];
  for (const el of document.querySelectorAll(CONTROL)) {
    if (!shown(el) || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    const hit = hitBox(el);
    const group = el.parentElement ? el.parentElement.closest(GROUP) : null;
    const shape = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? { lines: 0, spill: 0 } : textShape(el);
    const c = {
      name: nameOf(el),
      el: tagOf(el),
      variant: variantOf(el),
      x: r1(r.left),
      y: r1(r.top),
      w: r1(r.width),
      h: r1(r.height),
      hit: hit.widened ? { w: hit.w, h: hit.h } : undefined,
      small: hit.w < 43.5 || hit.h < 43.5,
      disabled: el.disabled || el.getAttribute("aria-disabled") === "true" || undefined,
      group: group ? tagOf(group) : "",
      inView: r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw,
      covered: covered(el) || undefined,
      clipped: clippedBy(el) || undefined,
      lines: shape.lines > 1 ? shape.lines : undefined,
      spill: shape.spill > 1 ? shape.spill : undefined,
      kbd: el.getAttribute("aria-keyshortcuts") || undefined,
    };
    controls.push(c);
  }
  // Rows clicked without being a control: a pointer cursor nobody inherits from.
  const pointerRows = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(CONTROL) || !shown(el)) continue;
    if (getComputedStyle(el).cursor !== "pointer") continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer") continue;
    const r = el.getBoundingClientRect();
    pointerRows.push({ name: nameOf(el), el: tagOf(el), w: r1(r.width), h: r1(r.height) });
  }
  // Visual order: rows top to bottom, each left to right.
  controls.sort((a, b) => {
    const ay = a.y + a.h / 2;
    const by = b.y + b.h / 2;
    return Math.abs(ay - by) > 10 ? ay - by : a.x - b.x;
  });
  // Controls whose boxes overlap (neither inside the other in the DOM is not
  // known here, so nested ones are filtered by full containment).
  const overlaps = [];
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix <= 2 || iy <= 2) continue;
      const inside = (p, q) => p.x >= q.x - 1 && p.y >= q.y - 1 && p.x + p.w <= q.x + q.w + 1 && p.y + p.h <= q.y + q.h + 1;
      if (inside(a, b) || inside(b, a)) continue;
      overlaps.push({ a: `${a.name} <${a.el}>`, b: `${b.name} <${b.el}>`, px: `${r1(ix)}x${r1(iy)}` });
    }
  }

  // ── fit ───────────────────────────────────────────────────────────────
  const de = document.documentElement;
  const pastEdge = [];
  const clippedX = [];
  const hScrollers = [];
  const parked = [];
  const offenders = new Map();
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) continue;
    let kind = "pastEdge";
    let by = null;
    for (let a = el.parentElement; a && a !== de; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/auto|scroll/.test(cs.overflowX)) {
        kind = "scrolls";
        by = a;
        break;
      }
      if (/hidden|clip/.test(cs.overflowX)) {
        const ar = a.getBoundingClientRect();
        if (ar.right <= vw + 1 && ar.left >= -1) {
          kind = "clipped";
          by = a;
          break;
        }
      }
    }
    if (r.left >= vw - 1 || r.right <= 1) kind = "parked";
    offenders.set(el, kind);
    if (el.parentElement && offenders.get(el.parentElement) === kind) continue;
    const row = { el: tagOf(el), text: (el.innerText || "").trim().slice(0, 50), left: r1(r.left), right: r1(r.right), w: r1(r.width) };
    if (kind === "pastEdge") pastEdge.push(row);
    else if (kind === "clipped") clippedX.push({ ...row, by: tagOf(by) });
    else if (kind === "parked") parked.push(row);
    else if (by && !hScrollers.some((h) => h.node === by)) {
      hScrollers.push({ node: by, el: tagOf(by), clientWidth: by.clientWidth, scrollWidth: by.scrollWidth });
    }
  }
  for (const h of hScrollers) delete h.node;
  // Controls below the screen that no scroller reaches.
  const unreachable = [];
  for (const el of seen) {
    const r = el.getBoundingClientRect();
    if (r.top < vh - 1 && r.bottom <= vh + 1) continue;
    let reach = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) {
        reach = true;
        break;
      }
    }
    if (!reach) unreachable.push({ name: nameOf(el), el: tagOf(el), top: r1(r.top), bottom: r1(r.bottom) });
  }

  // ── text cut off ──────────────────────────────────────────────────────
  const truncated = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
    const ellipsis = cs.textOverflow === "ellipsis";
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
    if (/hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && (own || ellipsis)) {
      truncated.push({ how: ellipsis ? "ellipsis" : "cut", el: tagOf(el), text: text.slice(0, 80), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth });
    } else if (/hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && (own || clamp)) {
      truncated.push({ how: clamp ? `clamp ${cs.webkitLineClamp}` : "cut below", el: tagOf(el), text: text.slice(0, 80), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight });
    }
  }

  // ── desktop-only words and keys ───────────────────────────────────────
  const KEYS = /[⌘⌥⌃⇧⏎↵⎋⌫]|\b(Ctrl|Cmd|Command|Alt|Option)\s?[+-]|\b(Esc|Escape)\b|\bpress (Enter|Return|Tab|Space)\b|\b(Enter|Return) to\b/;
  const WORDS = /\b(right[- ]click|double[- ]click|hover|drag|drop|click|keyboard shortcut|Browse|Finder|Explorer|window)\b/i;
  const hints = [];
  for (const el of document.querySelectorAll("kbd")) {
    if (shown(el)) hints.push({ kind: "kbd", text: el.innerText.trim(), el: tagOf(el), in: nameOf(el.closest(CONTROL) || el.parentElement) });
  }
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n.data.replace(/\s+/g, " ").trim();
    if (!t || !n.parentElement || !shown(n.parentElement) || n.parentElement.closest("kbd, script, style")) continue;
    if (KEYS.test(t)) hints.push({ kind: "keys in text", text: t.slice(0, 120), el: tagOf(n.parentElement) });
    else if (WORDS.test(t)) hints.push({ kind: "desktop word", text: t.slice(0, 120), el: tagOf(n.parentElement) });
  }
  for (const el of document.querySelectorAll("[placeholder], [title], [aria-label]")) {
    if (!shown(el)) continue;
    for (const attr of ["placeholder", "title", "aria-label"]) {
      const v = el.getAttribute(attr);
      if (v && (KEYS.test(v) || (attr === "placeholder" && WORDS.test(v)))) {
        hints.push({ kind: `keys in ${attr}`, text: v.slice(0, 120), el: tagOf(el) });
      }
    }
  }

  // ── hover-only reveals ────────────────────────────────────────────────
  const hoverOnly = [];
  const hoverSeen = new Set();
  const splitSel = (s) => {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const walk = (rules, media) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) {
        const cond = rule.conditionText || rule.name || "";
        walk(rule.cssRules, cond ? [...media, cond] : media);
        continue;
      }
      if (!rule.selectorText || !rule.selectorText.includes(":hover")) {
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, media);
        continue;
      }
      const st = rule.style;
      const reveals =
        (st.opacity && parseFloat(st.opacity) > 0) ||
        st.visibility === "visible" ||
        (st.display && st.display !== "none") ||
        (st.pointerEvents && st.pointerEvents !== "none");
      if (!reveals) continue;
      for (const sel of splitSel(rule.selectorText)) {
        if (!sel.includes(":hover")) continue;
        const plain = sel.replace(/:hover/g, "");
        const ungated = plain.replace(/html:not\(\.platform-ios\)\s*/g, "").replace(/:not\(\.platform-ios\)/g, "");
        let found = [];
        try {
          found = [...document.querySelectorAll(ungated)];
        } catch {
          continue;
        }
        for (const el of found) {
          if (hoverSeen.has(el)) continue;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const hidden = parseFloat(cs.opacity) === 0 || cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none";
          if (!hidden) continue;
          // Its place on screen must itself be showing.
          const host = el.parentElement;
          if (cs.display !== "none" && (r.width < 1 || r.height < 1)) continue;
          if (host && !shown(host)) continue;
          hoverSeen.add(el);
          let ruleApplies = false;
          try {
            ruleApplies = el.matches(plain);
          } catch {
            ruleApplies = false;
          }
          hoverOnly.push({
            el: tagOf(el),
            name: nameOf(el),
            controls: el.matches(CONTROL) ? 1 : el.querySelectorAll(CONTROL).length,
            hiddenBy: `opacity ${cs.opacity}; visibility ${cs.visibility}; display ${cs.display}; pointer-events ${cs.pointerEvents}`,
            rule: sel,
            media: media.join(" & ") || undefined,
            // false: the reveal is gated off here, so nothing ever shows it.
            ruleApplies,
          });
        }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, []);
    } catch {
      // A sheet from another origin: not the app's.
    }
  }

  // ── scrollers, for the paged screenshots ──────────────────────────────
  const scrollers = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 24) continue;
    const r = el.getBoundingClientRect();
    scrollers.push({ el: tagOf(el), area: Math.round(r.width * r.height), clientHeight: el.clientHeight, scrollHeight: el.scrollHeight });
  }
  scrollers.sort((a, b) => b.area - a.area);

  return {
    viewport: { w: vw, h: vh },
    html: de.className,
    isIos,
    page: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, sideways: de.scrollWidth > de.clientWidth + 1, bodyScrollHeight: document.body.scrollHeight },
    controls,
    pointerRows,
    overlaps,
    pastEdge,
    clippedX,
    hScrollers,
    parked: parked.length,
    unreachable,
    truncated,
    hints,
    hoverOnly,
    scrollers,
  };
}

/** Controls on screen that something else covers, at the current scroll. */
export function coveredInPage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const CONTROL =
    'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], [role="link"]';
  const out = [];
  for (const el of document.querySelectorAll(CONTROL)) {
    if (el.closest("[inert]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
    const top = document.elementFromPoint(cx, cy);
    if (!top || top === el || el.contains(top) || top.contains(el)) continue;
    const label = el.closest("label");
    if (label && label.contains(top)) continue;
    const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    out.push({ name, by: `${top.tagName.toLowerCase()}.${String(top.className).split(/\s+/).slice(0, 3).join(".")}`, y: Math.round(r.top) });
  }
  return out;
}
