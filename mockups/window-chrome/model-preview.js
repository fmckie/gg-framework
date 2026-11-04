// Screenshot content is illustrative; no registry, authentication or model calls.
const catalogue = [
  ['Anthropic', ['Claude Fable 5.1', 'Claude Opus 5.5', 'Claude Opus 5.5 Fast', 'Claude Sonnet 5.5', 'Claude Haiku 5.5']],
  ['OpenAI', ['GPT-6 Astra', 'GPT-6 Astra Fast']],
  ['Tinfoil', ['deepseek-v4-1-flash', 'glm-5-3', 'kimi-k3', 'llama3-3-70b', 'gemma4-31b', 'gpt-oss-120b']],
  ['Ollama', ['gemma4:12b', 'gemma4:e4b', 'gemma4:e2b', 'sweaterdog/andy-4:micro-q8_0']],
];
const levels = ['Off', 'Low', 'Medium', 'High', 'X-High', 'Max', 'Ultra'];
const warnings = {
  'Claude Opus 5.5 Fast': 'Bills usage credits — reference copy, not verified pricing.',
  'GPT-6 Astra Fast': 'Reference: 2.5× ChatGPT plan usage; purchased credits at 2×. Not verified pricing.',
};
for (const sample of document.querySelectorAll('#conversation, #empty')) {
  sample.classList.add('model-study');
  const root = sample.querySelector('.kleio-code');
  const composer = root.querySelector('.composer');
  const field = composer.querySelector('.field');
  const draft = field.querySelector('.input');
  if (draft.tagName === 'P') {
    draft.contentEditable = 'true';
    draft.removeAttribute('aria-readonly');
    draft.setAttribute('aria-multiline', 'true');
  }
  const entries = composer.querySelector('.panel-entry-bar');
  entries.querySelector('.static-label').textContent = 'Local interaction study';
  const thinking = root.querySelector('.thinking');
  const trigger = thinking.nextElementSibling;
  trigger.classList.add('model-trigger');
  trigger.setAttribute('aria-expanded', 'false');
  const panelId = `${sample.id}-model`;
  trigger.setAttribute('aria-controls', panelId);
  const panel = document.createElement('section');
  panel.id = panelId;
  panel.className = 'composer-panel model-panel';
  panel.setAttribute('aria-label', 'Model');
  panel.hidden = true;
  panel.innerHTML = `<header class="panel-header"><h3>MODEL</h3><span class="panel-meta">From connected Settings providers</span><span class="escape">esc</span><button class="control model-close" aria-label="Close Model">×</button></header>
    <div class="model-summary"><strong class="model-current"></strong><small>4 connected · illustrative catalogue</small></div>
    <label class="model-search">Search<input type="search" aria-label="Search models or providers" placeholder="Models or providers"><output aria-live="polite"></output></label>
    <div class="model-list" role="group" aria-label="Available models"></div>
    <div class="model-thinking"><div class="thinking-heading"><span id="${panelId}-thinking-label">Thinking</span><small id="${panelId}-thinking-note">Shared with composer · applied on confirmation · support not verified</small></div><div class="thinking-levels" role="radiogroup" aria-labelledby="${panelId}-thinking-label" aria-describedby="${panelId}-thinking-note">${levels.map(level => `<label class="thinking-choice" data-level="${level}"><input type="radio" name="${panelId}-thinking" value="${level}" aria-label="${level}"><span>${level}</span></label>`).join('')}</div></div>
    <div class="model-review"><div class="model-review-copy" aria-live="polite"><strong class="candidate"></strong><p class="cost-warning"></p></div><button class="control model-cancel">Cancel</button><button class="control model-use">Use model</button></div>`;
  composer.insertBefore(panel, entries);
  const otherPanels = {};
  for (const name of ['more', 'branch']) {
    const clone = document.querySelector(`#${name}-template`).content.firstElementChild.cloneNode(true);
    clone.hidden = true;
    composer.insertBefore(clone, entries);
    otherPanels[name] = clone;
    clone.querySelector('.panel-header button').addEventListener('click', () => close());
    entries.querySelector(`.${name}-entry`).addEventListener('click', () => open(name));
  }
  const files = document.createElement('input');
  files.type = 'file';
  files.multiple = true;
  files.hidden = true;
  files.setAttribute('aria-label', 'Mock draft attachments');
  const fileNames = document.createElement('div');
  fileNames.className = 'mock-files';
  fileNames.hidden = true;
  composer.insertBefore(files, panel);
  composer.insertBefore(fileNames, panel);
  field.querySelector('[aria-label=Attach]').addEventListener('click', () => files.click());
  files.addEventListener('change', () => {
    fileNames.textContent = `Local draft attachments (not uploaded): ${[...files.files].map(file => file.name).join(', ')}`;
    fileNames.hidden = !files.files.length || Boolean(view);
  });
  let current = 'Claude Opus 5.5';
  let candidate = current;
  let level = 'Low';
  let pendingLevel = level;
  let view = '';
  let selection = null;
  const search = panel.querySelector('input');
  const list = panel.querySelector('.model-list');
  const levelInputs = [...panel.querySelectorAll('.thinking-choice input')];
  const use = panel.querySelector('.model-use');
  function updateThinking(value) {
    thinking.className = 'control thinking';
    thinking.dataset.level = value;
    thinking.textContent = `Thinking ${value}`;
    for (const input of levelInputs) input.checked = input.value === value;
  }
  function review() {
    panel.querySelector('.candidate').textContent = `${candidate === current ? 'Current' : 'Candidate'} · ${candidate}`;
    panel.querySelector('.cost-warning').textContent = warnings[candidate] || 'Cost information not supplied in this mockup; no free-use claim.';
    use.disabled = candidate === current && pendingLevel === level;
    use.textContent = candidate === current && pendingLevel !== level ? 'Apply thinking' : 'Use model';
  }
  function render() {
    list.replaceChildren();
    let count = 0;
    const query = search.value.trim().toLowerCase();
    for (const [provider, names] of catalogue) {
      const matches = names.filter(name => `${provider} ${name}`.toLowerCase().includes(query));
      if (!matches.length) continue;
      count += matches.length;
      const group = document.createElement('div');
      group.className = 'model-group';
      const heading = document.createElement('h4');
      heading.textContent = `${provider} · ${matches.length}`;
      group.append(heading);
      for (const name of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'model-option';
        button.dataset.model = name;
        button.setAttribute('aria-pressed', String(name === candidate));
        const label = document.createElement('span');
        label.textContent = name;
        const meta = document.createElement('small');
        meta.textContent = [name === current ? '✓ Current' : '', warnings[name] ? 'Billing caveat · reference' : ''].filter(Boolean).join(' · ');
        button.append(label, meta);
        button.addEventListener('click', () => {
          candidate = name;
          for (const row of list.querySelectorAll('button')) row.setAttribute('aria-pressed', String(row === button));
          review();
        });
        group.append(button);
      }
      list.append(group);
    }
    panel.querySelector('output').textContent = `${count} ${count === 1 ? 'model' : 'models'}`;
    if (!count) {
      const empty = document.createElement('p');
      empty.className = 'empty-results';
      empty.textContent = 'No matching models. Try another name or provider.';
      list.append(empty);
    }
  }
  function rememberDraft() {
    if (draft.tagName === 'TEXTAREA') selection = [draft.selectionStart, draft.selectionEnd];
    else {
      const range = window.getSelection();
      if (range.rangeCount && draft.contains(range.anchorNode)) selection = range.getRangeAt(0).cloneRange();
    }
  }
  function close(apply = false) {
    const previous = view;
    if (apply) { current = candidate; level = pendingLevel; }
    view = '';
    panel.hidden = true;
    for (const other of Object.values(otherPanels)) other.hidden = true;
    field.hidden = false;
    fileNames.hidden = !files.files.length;
    trigger.querySelector('span').textContent = current;
    trigger.setAttribute('aria-expanded', 'false');
    thinking.disabled = false;
    updateThinking(level);
    for (const name of ['more', 'branch']) {
      entries.querySelector(`.${name}-entry`).classList.remove('entry-active');
      entries.querySelector(`.${name}-entry`).setAttribute('aria-expanded', 'false');
    }
    if (apply) {
      draft.focus();
      if (selection && draft.tagName === 'TEXTAREA') draft.setSelectionRange(...selection);
      else if (selection) { const range = window.getSelection(); range.removeAllRanges(); range.addRange(selection); }
    } else if (previous === 'model') trigger.focus();
    else if (previous) entries.querySelector(`.${previous}-entry`).focus();
  }
  function open(next) {
    if (view === next) { close(); return; }
    if (!view) rememberDraft();
    view = next;
    candidate = current;
    pendingLevel = level;
    updateThinking(level);
    thinking.disabled = next === 'model';
    field.hidden = true;
    fileNames.hidden = true;
    panel.hidden = next !== 'model';
    trigger.setAttribute('aria-expanded', String(next === 'model'));
    for (const name of ['more', 'branch']) {
      otherPanels[name].hidden = next !== name;
      entries.querySelector(`.${name}-entry`).classList.toggle('entry-active', next === name);
      entries.querySelector(`.${name}-entry`).setAttribute('aria-expanded', String(next === name));
    }
    if (next === 'model') {
      search.value = '';
      panel.querySelector('.model-current').textContent = `Current · ${current} · ${catalogue.find(([, names]) => names.includes(current))[0]}`;
      render(); review(); list.scrollTop = 0; search.focus();
    } else otherPanels[next].querySelector('button').focus();
  }
  thinking.addEventListener('click', () => {
    level = levels[(levels.indexOf(level) + 1) % levels.length];
    updateThinking(level);
  });
  updateThinking(level);
  trigger.addEventListener('click', () => open('model'));
  panel.querySelector('.model-close').addEventListener('click', () => close());
  panel.querySelector('.model-cancel').addEventListener('click', () => close());
  use.addEventListener('click', () => close(true));
  search.addEventListener('input', () => { render(); list.scrollTop = 0; });
  for (const input of levelInputs) input.addEventListener('change', () => {
    pendingLevel = input.value; updateThinking(pendingLevel); review();
  });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && view) { event.preventDefault(); close(); }
    if (view === 'model' && ['ArrowDown', 'ArrowUp'].includes(event.key) && (event.target === search || event.target.closest('.model-list'))) {
      event.preventDefault();
      const rows = [...list.querySelectorAll('button')];
      const index = rows.indexOf(document.activeElement);
      rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus();
    }
  });
}
