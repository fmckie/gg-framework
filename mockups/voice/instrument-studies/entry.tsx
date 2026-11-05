import { createRoot } from 'react-dom/client';
import { VoiceMode } from '../before/source/kleio/VoiceMode';
import { scenarios, selectScenario } from '../before/fixtures';
import '../before/source/App.css';
import '../before/source/glass.css';
import '../before/source/kleio/kleio-theme.css';
import './studies.css';
const params = new URLSearchParams(location.search);
selectScenario(params.get('state') || 'listening');
window.baseline = { scenarios: Object.keys(scenarios), selectScenario };
createRoot(document.getElementById('root')).render(<VoiceMode />);
if(params.get('demo') === '1') {
  const steps = [[0,'connecting'],[2,'listening'],[7,'thinking'],[12,'speaking'],[23,'listening']];
  let elapsed=0, previous, index=0, stopped=false, raf;
  const cancel=()=>{stopped=true;cancelAnimationFrame(raf);};
  document.addEventListener('pointerdown',cancel,{once:true,capture:true});
  document.addEventListener('keydown',cancel,{once:true,capture:true});
  const tick=(now)=>{
    if(stopped)return;
    if(!document.hidden&&previous!==undefined)elapsed+=Math.min((now-previous)/1000,.06);
    previous=now;
    if(index<steps.length&&elapsed>=steps[index][0])selectScenario(steps[index++][1]);
    if(index<steps.length)raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);
}
