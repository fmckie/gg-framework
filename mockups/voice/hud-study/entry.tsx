import { createRoot } from 'react-dom/client';
import { VoiceMode } from '../before/source/kleio/VoiceMode';
import { scenarios, selectScenario } from '../before/fixtures';
import '../before/source/App.css';
import '../before/source/glass.css';
import '../before/source/kleio/kleio-theme.css';
import './hud.css';
const params = new URLSearchParams(location.search);
selectScenario(params.get('state') || 'listening');
window.baseline = { scenarios: Object.keys(scenarios), selectScenario };
createRoot(document.getElementById('root')).render(<VoiceMode />);
if (params.get('demo') === '1') {
  // One connecting pass, then the hands-free loop; any real input hands control back to the fixtures.
  const START = 2.8, PERIOD = 21, LOOP = [[0, 'listening'], [4.5, 'thinking'], [10.5, 'speaking']];
  let elapsed = 0, previous, current = 'connecting', stopped = false, raf;
  selectScenario('connecting');
  const cancel = () => { stopped = true; cancelAnimationFrame(raf); };
  document.addEventListener('pointerdown', cancel, { once: true, capture: true });
  document.addEventListener('keydown', cancel, { once: true, capture: true });
  const tick = now => {
    if (stopped) return;
    if (!document.hidden && previous !== undefined) elapsed += Math.min((now - previous) / 1000, .06);
    previous = now;
    if (elapsed >= START) {
      const local = (elapsed - START) % PERIOD;
      const next = LOOP.filter(([at]) => local >= at).at(-1)[1];
      if (next !== current) { current = next; selectScenario(next); }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
