import { useEffect, useRef, useState } from 'react';
import { createInstrument } from './stage';
export function VoiceOrb({ mood, reducedMotion, className }) {
  const host = useRef(null);
  const engine = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try { engine.current = createInstrument(host.current, document.body.dataset.concept); }
    catch (error) { console.error('Instrument renderer unavailable', error);setFailed(true); }
    return () => engine.current?.dispose();
  }, []);
  useEffect(() => { engine.current?.setState(mood, reducedMotion); }, [mood, reducedMotion]);
  return <div ref={host} className={`${className} instrument-orb`} aria-hidden="true">{failed && <span className="renderer-unavailable">WebGL unavailable</span>}</div>;
}
