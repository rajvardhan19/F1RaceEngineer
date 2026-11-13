import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRace,step,applyCommand,playerCar,replay,order,TOTAL_LAPS,lapPace} from '../src/sim.ts';
import {parseIntent} from '../src/intent.ts';

test('same seed and decisions reproduce the entire race exactly',()=>{
  const decisions=[{at:0,command:{car:2,action:'pit',compound:'medium'}},{at:275,command:{car:1,action:'pit',compound:'hard'}},{at:500,command:{car:1,action:'conserve'}}] as const;
  const a=replay(2049,structuredClone(decisions) as any),b=replay(2049,structuredClone(decisions) as any);
  assert.deepEqual(a,b);assert.equal(a.status,'finished');assert.equal(a.cars.length,10);assert(a.cars.every(c=>c.distance===TOTAL_LAPS&&Number.isFinite(c.finishedAt)));
});
test('recorded live commands can be replayed',()=>{
  const r=createRace();r.status='running';applyCommand(r,{car:2,action:'pit',compound:'medium'});
  while(r.elapsed<280)step(r);
  applyCommand(r,{car:1,action:'pit',compound:'medium'});
  while(r.status==='running')step(r);
  assert.deepEqual(replay(r.seed,r.decisions),r);
});
test('different seeds produce different race timing',()=>{
  const a=replay(1,[]),b=replay(2,[]);assert.notDeepEqual(a.cars.map(c=>c.finishedAt),b.cars.map(c=>c.finishedAt));
});
test('paused and unstarted races cannot advance',()=>{
  const r=createRace(),initial=structuredClone(r);step(r);assert.deepEqual(r,initial);
  r.status='paused';step(r);assert.equal(r.elapsed,0);
});
test('pit order executes once at a lap boundary and fits requested tyres',()=>{
  const r=createRace();r.status='running';const c=playerCar(r,2)!;
  applyCommand(r,{car:2,action:'pit',compound:'hard'});assert.equal(c.compound,'soft');
  while(c.stops===0)step(r);
  assert.equal(c.compound,'hard');assert.equal(c.age,0);assert.equal(c.wear,0);assert.equal(c.pitOrder,null);assert(c.pitRemaining>=21);
  const at=c.distance;step(r);assert.equal(c.distance,at);
  for(let i=0;i<200;i++)step(r);assert.equal(c.stops,1);
});
test('stay out cancels a queued pit stop',()=>{
  const r=createRace();r.status='running';applyCommand(r,{car:1,action:'pit',compound:'medium'});applyCommand(r,{car:1,action:'stay'});
  for(let i=0;i<130;i++)step(r);assert.equal(playerCar(r,1)!.stops,0);
});
test('cannot cancel a stop after entering pit lane',()=>{
  const r=createRace();r.status='running';applyCommand(r,{car:1,action:'pit',compound:'medium'});
  while(!playerCar(r,1)!.pitRemaining)step(r);
  const calls=r.decisions.length;assert.match(applyCommand(r,{car:1,action:'stay'}),/committed/);assert.equal(r.decisions.length,calls);
});
test('invalid car and compound cannot alter the simulation',()=>{
  const r=createRace();r.status='running';const before=structuredClone(r);
  applyCommand(r,{car:3,action:'push'});applyCommand(r,{car:1,action:'pit',compound:'bogus'} as any);assert.deepEqual(r,before);
});
test('scripted safety car deploys and clears on deterministic ticks',()=>{
  const r=createRace();r.status='running';while(r.elapsed<269)step(r);assert.equal(r.flag,'green');step(r);assert.equal(r.flag,'safety');while(r.elapsed<420)step(r);assert.equal(r.flag,'green');
});
test('wear cliff is nonlinear and pushing increases wear',()=>{
  const r=createRace();r.status='running';const a=playerCar(r,1)!,b=playerCar(r,2)!;
  a.wear=.5;const p1=lapPace(a,r);a.wear=.75;const p2=lapPace(a,r);a.wear=1;const p3=lapPace(a,r);assert(p3-p2>p2-p1);
  Object.assign(b,{pace:a.pace,compound:a.compound,wear:0,distance:a.distance-2});a.wear=0;a.mode='push';b.mode='conserve';for(let i=0;i<20;i++)step(r);assert(a.wear>b.wear);
});
test('finish order is sorted by actual finish time',()=>{
  const r=replay(2049,[]),sorted=order(r);for(let i=1;i<sorted.length;i++)assert(sorted[i].finishedAt!>=sorted[i-1].finishedAt!);
  const before=structuredClone(r);step(r);assert.deepEqual(r,before);
});
test('parser recognises natural calls and keeps car context',()=>{
  assert.deepEqual(parseIntent('Car two, box for mediums'),{kind:'command',command:{car:2,action:'pit',compound:'medium'}});
  assert.deepEqual(parseIntent('push',1),{kind:'command',command:{car:1,action:'push'}});
  assert.deepEqual(parseIntent('Nico, do not pit'),{kind:'command',command:{car:2,action:'stay'}});
});
test('parser asks for missing, conflicting cars and multiple actions',()=>{
  for(const text of ['box','car one and car two box','car one push and conserve','car one box for soft or hard'])assert.equal(parseIntent(text).kind,'clarify');
});
test('questions do not accidentally issue race commands',()=>{
  for(const text of ['Should car one box?','How are car two’s tyres?','What is the gap for Theo?','What is the weather?'])assert.equal(parseIntent(text).kind,'question');
});
test('timing snapshots remain coherent between sector updates',()=>{
  const r=createRace();r.status='running';const initial=r.cars.map(c=>c.shownDistance);
  for(let i=0;i<20;i++)step(r);assert.deepEqual(r.cars.map(c=>c.shownDistance),initial);
  while(r.elapsed<31)step(r);assert.notDeepEqual(r.cars.map(c=>c.shownDistance),initial);
  const sorted=order(r);assert(sorted[0].shownDistance>sorted[1].shownDistance);
});
test('safety-car catch-up closes large gaps without on-track overtaking',()=>{
  const r=createRace();r.status='running';r.elapsed=280;r.flag='safety';
  for(const c of r.cars){c.wear=0;c.age=0;c.pitOrder=null;}
  const sorted=order(r);const first=sorted[0],last=sorted.at(-1)!;const gap=first.distance-last.distance;
  for(let i=0;i<60;i++)step(r);
  assert(first.distance-last.distance<gap);assert.deepEqual(order(r).map(c=>c.id),sorted.map(c=>c.id));
});
test('team radio reacts to actual tyre state and does not repeat a cliff warning each tick',()=>{
  const r=createRace();r.status='running';const car=playerCar(r,1)!;car.wear=.8;
  for(let i=0;i<31;i++)step(r);
  assert.equal(r.messages.filter(m=>m.text.startsWith('LAU is reaching the tyre cliff')).length,1);
});
