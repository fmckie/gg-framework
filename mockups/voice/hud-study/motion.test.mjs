import test from 'node:test';
import assert from 'node:assert/strict';
import { poseAt, thinkingAt, voiceAt, inputAt, STEPS } from './motion.mjs';
const MOODS = ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'muted', 'ended'];
test('poses are deterministic, finite and bounded', () => {
  for (const mood of MOODS) for (let t = 0; t < 60; t += .17) {
    const p = poseAt(mood, t, t);
    assert.deepEqual(p, poseAt(mood, t, t));
    assert(Object.values(p).every(Number.isFinite));
    assert(Math.abs(p.yaw) <= .028 && Math.abs(p.pitch) <= .02, 'shallow parallax only');
    assert(p.amp <= .024 && p.assemble >= 0 && p.assemble <= 1);
  }
});
test('connecting assembles once, then steps between the brackets', () => {
  assert.equal(poseAt('connecting', 0, 0).assemble, 0);
  assert.equal(poseAt('connecting', 2, 2).assemble, 1);
  assert.equal(poseAt('connecting', 9, 9).assemble, 1);
  assert.notEqual(poseAt('connecting', 2.2, 2.2).seek, poseAt('connecting', 3.5, 3.5).seek);
});
test('listening stays quiet: no voice trace, no rotation, input only while the person speaks', () => {
  for (let t = 0; t < 30; t += .5) { const p = poseAt('listening', t, t); assert.equal(p.amp, 0); assert.equal(p.seg + p.dots + p.outer, 0); assert(p.inAmp <= .009); }
  assert(inputAt(1.55) > .8 && inputAt(.2) < .02 && inputAt(5) < .02);
  assert(poseAt('listening', 1.55, 1.55).inAmp > .007 && poseAt('listening', 5, 5).inAmp < 5e-4);
  assert.notDeepEqual(poseAt('listening', 1, 1), poseAt('listening', 5, 5));
});
test('thinking indexes by detents and truly holds between them', () => {
  assert.deepEqual(thinkingAt(1.8), thinkingAt(3.1));
  assert.notDeepEqual(thinkingAt(.2), thinkingAt(.6));
  assert.equal(thinkingAt(CYCLE_END()).seg, STEPS.seg * 2);
});
function CYCLE_END() { return 3.2 * 2; }
test('speaking follows the phrase envelope with rests', () => {
  assert(voiceAt(2.55) > .8 && voiceAt(6.5) < .05);
  assert(poseAt('speaking', 2.55, 2.55).amp > poseAt('speaking', 6.5, 6.5).amp + .018);
});
test('reduced motion and closed states are static', () => {
  for (const mood of MOODS) assert.deepEqual(poseAt(mood, 0, 0, true), poseAt(mood, 41, 41, true));
  for (const mood of ['muted', 'ended']) assert.deepEqual(poseAt(mood, 0, 0), poseAt(mood, 37, 37));
  assert.notDeepEqual(poseAt('thinking', 0, 0, true), poseAt('listening', 0, 0, true));
  assert.notDeepEqual(poseAt('speaking', 0, 0, true), poseAt('listening', 0, 0, true));
});
