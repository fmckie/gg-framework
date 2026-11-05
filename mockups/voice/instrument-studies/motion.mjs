const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { const n = clamp(x); return n * n * (3 - 2 * n); };
export function motionAt(mood, time, reduced = false) {
  const t = reduced ? 0 : Math.max(0, time);
  const rest = mood === 'muted' || mood === 'ended';
  const pose = { pitch: 0, yaw: 0, index: 0, opening: .32, energy: .17, strain: .025, axial: 0, muted: mood === 'muted' ? 1 : 0 };
  if (rest) return { ...pose, opening: .16, energy: .025, strain: .008 };
  if (mood === 'connecting') {
    const settle = reduced ? 1 : ease(t / 1.8);
    return { ...pose, opening: .18 + .08 * settle, energy: .09, axial: .06 * (1 - settle) };
  }
  if (mood === 'listening') {
    pose.pitch = reduced ? 0 : .018 * Math.sin(t * .43);
    pose.yaw = reduced ? 0 : .026 * Math.sin(t * .31);
    pose.strain = .025 + (reduced ? 0 : .004 * Math.sin(t * .53));
  }
  if (mood === 'thinking') {
    const step = reduced ? .5 : ease(((t % 6) - .4) / .8) - ease(((t % 6) - 3.5) / .8);
    pose.index = .14 * step;
    pose.opening = .22;
    pose.energy = .23;
    pose.strain = .07;
    pose.axial = .018 * step;
  }
  if (mood === 'speaking') {
    const phrase = t % 6.8;
    const syllables = [[.5,.7],[1,.9],[1.7,.55],[2.8,1],[3.4,.65],[4.3,.85],[5.1,.6]];
    const voice = reduced ? .5 : Math.min(1, syllables.reduce((v,[at,power]) => v + power * Math.exp(-(((phrase-at)/.27)**2)), 0));
    pose.opening = Math.min(.45, .28 + voice * .17);
    pose.energy = .19 + voice * .44;
    pose.strain = .04 + voice * .14;
    pose.axial = voice * .037;
    pose.pitch = voice * .012;
  }
  return pose;
}
