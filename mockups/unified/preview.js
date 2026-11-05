const selector = document.querySelector('#preview-state');
const announcement = document.querySelector('#preview-announcement');
const conversation = document.querySelector('#conversation');
const sessionRoot = conversation.querySelector('.kleio-code');
// Prevent the decorative mention's transparent text fill leaking into typed drafts.
for (const draft of document.querySelectorAll('.field [contenteditable]')) draft.contentEditable = 'plaintext-only';
const transcripts = new Map([['conversation', sessionRoot.querySelector('.transcript')]]);
const scrollPositions = new Map();
for (const state of ['plan-pending', 'plan-approved', 'help', 'help-sent']) {
  transcripts.set(state, document.querySelector(`#${state}-template`).content.firstElementChild.cloneNode(true));
}
let state = 'conversation';
function dismissPanels() {
  for (const sample of document.querySelectorAll('#conversation, #empty')) {
    // Usage consumes the first Escape when a replacement panel is also open.
    for (let i = 0; i < 2; i++) sample.querySelector('.kleio-code').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }
}
function show(next, { dismiss = true, focus = false } = {}) {
  if (![...selector.options].some(option => option.value === next)) next = 'conversation';
  if (dismiss) dismissPanels();
  const current = sessionRoot.querySelector('.transcript');
  if (transcripts.has(state)) scrollPositions.set(state, current.scrollTop);
  const isSession = transcripts.has(next);
  for (const sample of document.querySelectorAll('main > .panel-sample, main > #home')) {
    sample.hidden = sample.id !== (isSession ? 'conversation' : next);
  }
  if (isSession) {
    const transcript = transcripts.get(next);
    current.replaceWith(transcript);
    sessionRoot.classList.toggle('is-viewport', next.startsWith('plan-'));
    transcript.scrollTop = scrollPositions.get(next) ?? (next.startsWith('help') ? transcript.scrollHeight : 0);
  }
  state = next;
  selector.value = next;
  document.body.dataset.previewState = next;
  history.replaceState(null, '', `#${next}`);
  announcement.textContent = `${selector.selectedOptions[0].textContent} — preview only.`;
  if (focus) selector.focus({ preventScroll: true });
}
selector.addEventListener('change', () => show(selector.value, { focus: true }));
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
conversation.querySelector('.model-trigger').addEventListener('click', () => {
  if (state !== 'plan-pending') return;
  show('conversation', { dismiss: false });
  announcement.textContent = 'Model preview uses the Code session. Pending plan feedback and your draft are preserved; return using Preview state.';
}, true);
for (const sample of document.querySelectorAll('#conversation, #empty')) {
  sample.querySelector('[aria-label="Back"]').addEventListener('click', () => show('chats', { focus: true }));
  for (const button of sample.querySelectorAll('.toolbar button')) {
    if (button.textContent.trim() === '+ New chat') button.addEventListener('click', () => show('empty', { focus: true }));
  }
}
document.querySelector('#chats .new-chat').addEventListener('click', () => show('empty', { focus: true }));
document.querySelector('#chats .session-item[aria-current]').addEventListener('click', () => show('conversation', { focus: true }));
show(location.hash.slice(1) || 'conversation');
