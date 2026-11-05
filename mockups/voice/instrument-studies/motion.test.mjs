import test from 'node:test';
import assert from 'node:assert/strict';
import { motionAt } from './motion.mjs';
test('deterministic, finite and bounded without full rotations',()=>{
  for(const state of ['connecting','listening','thinking','speaking','muted','ended'])for(let t=0;t<60;t+=.13){
    const p=motionAt(state,t);assert.deepEqual(p,motionAt(state,t));
    assert(Object.values(p).every(Number.isFinite));assert(Math.abs(p.index)<=.14);assert(Math.abs(p.pitch)<.02);assert(Math.abs(p.yaw)<.03);assert(p.opening>=.16&&p.opening<=.45);
  }
});
test('listening parallax is quiet and thinking has true holds',()=>{
  assert.notDeepEqual(motionAt('listening',0),motionAt('listening',4));
  assert.deepEqual(motionAt('thinking',2),motionAt('thinking',3));
  assert.notDeepEqual(motionAt('thinking',.5),motionAt('thinking',1));
});
test('speaking opens and relaxes with a repeatable phrase envelope',()=>{
  assert(motionAt('speaking',2.8).opening>motionAt('speaking',6.5).opening+.14);
  assert(motionAt('speaking',2.8).strain>motionAt('listening',2.8).strain*4);
});
test('reduced motion and closed states stay static',()=>{
  for(const state of ['connecting','listening','thinking','speaking','muted','ended'])assert.deepEqual(motionAt(state,0,true),motionAt(state,100,true));
  for(const state of ['muted','ended'])assert.deepEqual(motionAt(state,0),motionAt(state,100));
});
