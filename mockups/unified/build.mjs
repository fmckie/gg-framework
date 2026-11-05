import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
const read = path => readFileSync(`mockups/${path}`, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ shell, plan, help, home }) => {
    const parse = html => new DOMParser().parseFromString(html, 'text/html');
    const doc = parse(shell);
    for (const el of doc.querySelectorAll('[src], link[href]')) {
      const attr = el.hasAttribute('src') ? 'src' : 'href';
      const value = el.getAttribute(attr);
      if (!value.startsWith('../')) el.setAttribute(attr, `../window-chrome/${value}`);
    }
    doc.title = 'Kleio · Unified approved preview';
    doc.querySelector('.page-head').innerHTML = `<span>KLEIO / UNIFIED APPROVED MOCKUP</span><h1>Approved UI preview</h1><label for="preview-state">Preview state </label><select id="preview-state"><option value="home">Home</option><option value="chats">Chats</option><option value="conversation" selected>Code session</option><option value="empty">Empty session</option><option value="plan-pending">Plan · pending</option><option value="plan-approved">Plan · approved</option><option value="help">@help · prompt</option><option value="help-sent">@help · sent</option></select><p class="preview-note">Local simulation only. Model/thinking, More/Branch, Usage and drafts are interactive. Other application actions are static; nothing is sent or run. Drafts/files/feedback are lost on reload.</p><p class="preview-note">Pending plan + Model: opening Model switches to Code session; return with this selector. Plan actions and helper handoff remain static; use the selector for approved/sent samples.</p><p id="preview-announcement" role="status" aria-live="polite"></p>`;
    for (const sample of doc.querySelectorAll('main > .panel-sample')) sample.hidden = sample.id !== 'conversation';
    const homeSection = doc.createElement('section');
    homeSection.id = 'home'; homeSection.hidden = true;
    homeSection.innerHTML = '<iframe src="home.html" title="Approved Home mockup" width="1024" height="720"></iframe>';
    doc.querySelector('main').append(homeSection);
    const addTemplate = (id, node) => {
      const template = doc.createElement('template'); template.id = id;
      template.content.append(node.cloneNode(true)); doc.body.append(template);
    };
    const plans = parse(plan).querySelectorAll('.transcript');
    addTemplate('plan-pending-template', plans[0]);
    addTemplate('plan-approved-template', plans[1]);
    const sent = parse(help).querySelector('.transcript');
    addTemplate('help-sent-template', sent);
    const pending = sent.cloneNode(true);
    const sentTurn = pending.querySelector('.is-sent').parentElement;
    while (sentTurn.nextElementSibling) sentTurn.nextElementSibling.remove();
    sentTurn.remove();
    addTemplate('help-template', pending);
    for (const href of ['../plan-mode/final.css', '../code-transcript/help-frame-window.css', 'preview.css', 'mukta-malar.css']) {
      const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; doc.head.append(link);
    }
    const script = doc.createElement('script'); script.src = 'preview.js'; script.defer = true; doc.head.append(script);
    const homeDoc = parse(home);
    const window = homeDoc.querySelector('.window').cloneNode(true);
    homeDoc.body.replaceChildren(window);
    const base = homeDoc.createElement('base'); base.href = '../wordmark/'; homeDoc.head.prepend(base);
    const style = homeDoc.createElement('style');
    style.textContent = 'html, body { margin:0; padding:0; width:1024px; height:720px; min-width:0; } body > .window { margin:0; }';
    homeDoc.head.append(style);
    return { index: '<!doctype html>\n'+doc.documentElement.outerHTML, home: '<!doctype html>\n'+homeDoc.documentElement.outerHTML };
  }, { shell: read('window-chrome/usage-preview.html'), plan: read('plan-mode/final.html'), help: read('code-transcript/help-frame-window.html'), home: read('wordmark/final.html') });
  for (const [name, html] of Object.entries(result)) {
    const path = `mockups/unified/${name}.html`;
    if (existsSync(path)) readFileSync(path, 'utf8');
    writeFileSync(path, html);
  }
} finally { await browser.close(); }
