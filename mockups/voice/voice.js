'use strict';
const $ = id => document.getElementById(id);
const states = {
  connecting: ['Connecting', 'Preparing this local sample. No service is contacted.'],
  listening: ['Listening', 'Take your time. This sample cannot hear you.'],
  processing: ['Preparing a response', 'Your thought is here. Kleio is considering the next step — simulated.'],
  speaking: ['Speaking', 'A response, one thought at a time. Simulated; no audio plays.'],
  interrupted: ['Interrupted', 'Stopped immediately. Your unfinished response stays in the conversation.'],
  muted: ['Microphone muted', 'Simulated capture is paused. Nothing is being recorded.'],
  ending: ['Ending', 'Stopping this simulated conversation.'],
  ended: ['Conversation ended', 'Your sample turns remain here until reload.'],
  'no-speech': ['No speech received', 'Simulated silence. Try the sample again when you are ready.'],
  denied: ['Microphone permission denied', 'Simulated failure. In a real call, check microphone permission before trying again. No permission was checked here.'],
  unavailable: ['Microphone unavailable', 'Simulated failure. In a real call, check that a microphone is connected and available. No hardware was checked here.'],
  failure: ['Connection interrupted', 'Simulated service failure. Your turns are retained. Retry the sample or return to chat; no network check was made.'],
  'show-content': ['Listening', 'A local reading sample is in the conversation.'],
  'show-image': ['Listening', 'A local image sample is in the conversation.'],
  'show-loading': ['Preparing shown content', 'Simulated loading. No file is being fetched.'],
  'show-failure': ['Content unavailable', 'Simulated content failure. Retry the sample or return to chat.'],
  long: ['Listening', 'A long transcript sample. Scroll to review earlier turns.']
};
const segments = ['Start with the smallest useful change.', 'Keep the existing behaviour intact, then verify the new path with a focused test.', 'We can review the result together before deciding what comes next.'];
let state = 'listening', generation = 0, timers = [], progress = 0, activeTurn = null;
const turns = [{speaker:'You', text:'Before we change anything, can we talk through the next step?'}, {speaker:'Kleio', text:'Of course. Let’s make the next step clear, and keep the rest of your work undisturbed.'}];
function cancelPendingTransitions() { generation++; timers.forEach(clearTimeout); timers = []; }
function later(callback, delay) { const token = generation; timers.push(setTimeout(() => { if (token === generation) callback(); }, delay)); }
function finishPartial() { if (activeTurn && progress < 3) { activeTurn.partial = true; activeTurn.text = segments.slice(0, progress).join(' '); } activeTurn = null; }
function drawTurns() {
  const box = $('turns'), top = box.scrollTop, atEnd = box.scrollHeight - top - box.clientHeight < 30;
  box.replaceChildren();
  for (const turn of turns) {
    const article = document.createElement('article'); article.className = 'voice-turn';
    const label = document.createElement('p'); label.className = 'speaker'; label.textContent = turn.speaker.toUpperCase();
    if (turn.partial) { const note = document.createElement('span'); note.textContent = 'Interrupted · partial response'; label.append(note); }
    const text = document.createElement('div'); text.className = turn.speaker === 'You' ? 'bubble' : 'prose';
    const p = document.createElement('p'); p.textContent = turn.text; text.append(p); article.append(label,text); box.append(article);
  }
  if (state.startsWith('show-')) {
    const shown = document.createElement('aside'); shown.className = 'shown prose';
    const h = document.createElement('h3'); h.textContent = 'A small, verifiable next step'; shown.append(h);
    const p = document.createElement('p'); p.textContent = state === 'show-loading' ? 'Loading — simulated.' : state === 'show-failure' ? 'This sample could not be shown — simulated. No file was requested.' : 'Read the current path. Make one focused change. Check the behaviour before moving on.'; shown.append(p);
    if(state === 'show-image') { const img = document.createElement('img'); img.alt = 'Sample three-step diagram: read, change, verify'; img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="#1d1819"/><text x="32" y="68" font-family="sans-serif" font-size="20" fill="#e8e0dc">01 Read → 02 Change → 03 Verify</text></svg>'); shown.append(img); }
    box.append(shown);
  }
  box.scrollTop = atEnd ? box.scrollHeight : top;
}
function renderState() {
  const focus = document.activeElement;
  $('voice-surface').dataset.state = state;
  $('scenario').value = state;
  $('state-title').textContent = states[state][0]; $('state-detail').textContent = states[state][1];
  $('progress').setAttribute('aria-valuenow', String(progress));
  [...$('progress').children].forEach((node,i) => node.classList.toggle('complete', i < progress));
  $('progress').hidden = state !== 'speaking';
  $('progress-label').textContent = state === 'speaking' ? `${progress} of 3 response segments · simulated` : 'SIMULATED / NO AUDIO';
  $('mute').hidden = ['ended','ending','denied','unavailable','failure','no-speech','show-failure'].includes(state);
  $('mute').textContent = state === 'muted' ? 'Unmute' : 'Mute';
  $('interrupt').hidden = !['processing','speaking'].includes(state);
  $('retry').hidden = !['interrupted','ended','no-speech','denied','unavailable','failure','show-failure'].includes(state);
  $('retry').textContent = state === 'interrupted' ? 'Resume listening' : state === 'ended' ? 'Talk again' : 'Retry simulation';
  $('end').hidden = state === 'ended';
  $('announcement').textContent = `${states[state][0]} — simulated.`;
  drawTurns();
  if (focus?.hidden) ($('retry').hidden ? $('mute').hidden ? $('return') : $('mute') : $('retry')).focus();
}
function transition(next) { if (!Object.hasOwn(states,next)) return; state = next; renderState(); }
function startSimulation() {
  cancelPendingTransitions(); finishPartial(); progress = 0;
  $('voice-surface').hidden = false; $('chat-surface').hidden = true; transition('connecting');
  later(() => transition('listening'), 700);
  later(() => { turns.push({speaker:'You',text:'What is the smallest useful change we can verify?'}); transition('processing'); }, 1800);
  later(() => { activeTurn = {speaker:'Kleio',text:segments.join(' ')}; turns.push(activeTurn); progress = 1; transition('speaking'); }, 3000);
  later(() => { progress = 2; renderState(); }, 4500);
  later(() => { progress = 3; renderState(); }, 6000);
  later(() => { activeTurn = null; transition('listening'); }, 7200);
}
function interrupt() { if (!['processing','speaking'].includes(state)) return; cancelPendingTransitions(); finishPartial(); transition('interrupted'); }
function retry() { cancelPendingTransitions(); finishPartial(); progress = 0; transition('listening'); }
function endSession(returnToChat = false) {
  cancelPendingTransitions(); finishPartial(); transition('ending'); transition('ended');
  if (returnToChat) { $('voice-surface').hidden = true; $('chat-surface').hidden = false; $('announcement').textContent = 'Returned to local chat. Sample turns retained until reload.'; $('entry').focus(); }
}
function selectScenario(next) {
  if (!Object.hasOwn(states,next)) return;
  cancelPendingTransitions(); finishPartial(); progress = next === 'speaking' ? 1 : 0;
  $('voice-surface').hidden = false; $('chat-surface').hidden = true;
  if (next === 'speaking') { activeTurn = {speaker:'Kleio',text:segments.join(' ')}; turns.push(activeTurn); }
  if (next === 'long') for(let i=0;i<12;i++) turns.push({speaker:i%2?'Kleio':'You',text:`Sample turn ${i+1}. ${segments.join(' ')} ${'A long reference should wrap without losing the earlier context. '.repeat(5)}`});
  transition(next);
}
for (const [key,value] of Object.entries(states)) { const option = document.createElement('option'); option.value = key; option.textContent = value[0] + (key.startsWith('show-') ? ` · ${key}` : key === 'long' ? ' · long transcript' : ''); $('scenario').append(option); }
$('scenario').value = 'listening';
$('scenario').onchange = event => selectScenario(event.target.value);
$('play').onclick = startSimulation;
$('interrupt').onclick = interrupt;
$('retry').onclick = retry;
$('end').onclick = () => endSession();
$('return').onclick = () => endSession(true);
$('mute').onclick = () => { cancelPendingTransitions(); finishPartial(); transition(state === 'muted' ? 'listening' : 'muted'); };
$('entry').onclick = () => { $('chat-surface').hidden = true; $('voice-surface').hidden = false; retry(); $('mute').focus(); };
$('latest').onclick = () => { $('turns').scrollTop = $('turns').scrollHeight; $('turns').focus(); };
$('guide-open').onclick = () => $('guide').showModal();
$('guide-close').onclick = () => $('guide').close();
$('guide').addEventListener('close', () => $('guide-open').focus());
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('guide').open && !$('voice-surface').hidden) { event.preventDefault(); endSession(true); } });
window.addEventListener('pagehide', cancelPendingTransitions);
renderState();
