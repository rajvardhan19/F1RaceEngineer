import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze,defaultStrategy,summarize,alternatives,better} from '../src/analysis.ts';
import {createRace,replay} from '../src/sim.ts';
import {driverNumber,layoutMarkers} from '../src/map.ts';

test('default engineer pits both player cars and can be reproduced from its decisions',()=>{
  for(const seed of [1,7,42,2049,9999]){
    const baseline=defaultStrategy(seed);
    assert(baseline.result.stops.every(n=>n>=1));assert(baseline.calls.some(d=>d.command.car===1));assert(baseline.calls.some(d=>d.command.car===2));
    assert.deepEqual(summarize(replay(seed,baseline.calls)),baseline.result);
  }
});
test('benchmark competes instead of handing points to a no-pit player',()=>{
  const baseline=defaultStrategy(2049),noPit=summarize(replay(2049,[]));
  assert(baseline.result.points>noPit.points);assert(baseline.result.positions.every(p=>p<9));
});
test('lap shifts reproduce independent replays and preserve other commands',()=>{
  const calls=defaultStrategy(2049).calls;const saved=structuredClone(calls);const actual=summarize(replay(2049,calls));
  const options=alternatives(2049,calls,actual);assert.equal(options.length,calls.length*2);
  for(const option of options.filter(a=>a.result)){
    const moved=calls.map((d,i)=>({at:i===option.index?option.shiftedAt!:d.at,command:{...d.command}})).sort((a,b)=>a.at-b.at);
    assert.deepEqual(option.result,summarize(replay(2049,moved)));
    assert.equal(option.secondsGained,actual.times[option.car-1]-option.result!.times[option.car-1]);
  }
  assert.deepEqual(calls,saved);
});
test('calls at scenario start cannot move a lap before the scenario',()=>{
  const calls=[{at:0,command:{car:2,action:'pit',compound:'medium'}}] as any;
  const options=alternatives(2049,calls,summarize(replay(2049,calls)));
  assert.equal(options[0].result,null);assert.match(options[0].note,/before/);assert(options[1].result);
});
test('best-found search includes actual, default and all tested call shifts',()=>{
  const calls=defaultStrategy(2049).calls;
  const result=analyze(2049,calls);
  assert(result.candidates>=443);
  assert(!better(result.actual,result.best.result));assert(!better(result.baseline.result,result.best.result));
  for(const alternative of result.alternatives)if(alternative.result)assert(!better(alternative.result,result.best.result));
  assert.deepEqual(summarize(replay(2049,result.best.calls)),result.best.result);
  console.log('Search result:',result.best.plan,result.best.result.positions,'Candidates:',result.candidates);
});
test('constructor colors agree for teammates and every map number is unique',()=>{
  const cars=createRace().cars,teams=[...new Set(cars.map(c=>c.team))];
  assert.equal(new Set(cars.map(driverNumber)).size,10);
  assert.equal(new Set(cars.map(c=>c.color)).size,teams.length);
  for(const team of teams)assert.equal(new Set(cars.filter(c=>c.team===team).map(c=>c.color)).size,1);
});
test('bunched map markers retain separate identities and true-position anchors',()=>{
  const cars=createRace().cars;cars.forEach(c=>c.distance=24);
  const markers=layoutMarkers(cars,()=>({x:200,y:140}));
  assert.equal(markers.length,10);
  for(let i=0;i<markers.length;i++){
    assert.deepEqual(markers[i].anchor,{x:200,y:140});
    for(let j=0;j<i;j++)assert(Math.hypot(markers[i].point.x-markers[j].point.x,markers[i].point.y-markers[j].point.y)>=20);
  }
});
test('bundled speech check contains actual audio rather than an empty WAV header',()=>{
  const wav=readFileSync(new URL('../public/audio/radio-check.wav',import.meta.url));
  const data=wav.indexOf(Buffer.from('data'));assert(data>0);assert(wav.readUInt32LE(data+4)>16000);
});
test('SVG DOMPoint-style non-enumerable coordinates remain visible on the map',()=>{
  const point=Object.create({get x(){return 200;},get y(){return 140;}});
  const markers=layoutMarkers(createRace().cars,()=>point);
  assert(markers.every(m=>Number.isFinite(m.point.x)&&Number.isFinite(m.point.y)));
  assert.deepEqual(markers[0].point,{x:200,y:140});
});
