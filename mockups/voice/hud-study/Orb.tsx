import { useEffect, useRef, useState } from 'react';
import { createHud } from './hud';
export function VoiceOrb({ mood, reducedMotion, className }) {
  const host = useRef(null);
  const engine = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try { engine.current = createHud(host.current); }
    catch (error) { console.error('HUD renderer unavailable', error); setFailed(true); }
    return () => engine.current?.dispose();
  }, []);
  useEffect(() => { engine.current?.setState(mood, reducedMotion); }, [mood, reducedMotion]);
  return <div ref={host} className={`${className} hud-orb`} aria-hidden="true">{failed && <span className="renderer-unavailable">WebGL2 unavailable</span>}</div>;
}
