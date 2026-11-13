import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RadioVoice} from '../src/radio.ts';
import {spokenText,voiceProfile} from '../src/radio-profile.ts';
class FakeWorker {
  static last:FakeWorker;onmessage:any;onerror:any;requests:any[]=[];
  constructor(){FakeWorker.last=this;}
  postMessage(data:any){this.requests.push(data);}
  terminate(){}
  reply(data:any){this.onmessage({data});}
}
class Node {
  frequency={value:0};gain={value:0};threshold={value:0};knee={value:0};ratio={value:0};attack={value:0};release={value:0};onended:any;
  connect(){return this;}disconnect(){}start(){}stop(){this.onended?.();}
}
class Context {
  state='running';destination={};resume(){return Promise.resolve();}
  createBuffer(){return {copyToChannel(){}};}createBufferSource(){return new Node();}createBiquadFilter(){return new Node();}createDynamicsCompressor(){return new Node();}createGain(){return new Node();}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){Object.assign(globalThis,{Worker:FakeWorker,AudioContext:Context});const radio=new RadioVoice();radio.enabled=true;return radio;}
test('radio calls pronounce driver codes, positions and timing units',()=>{assert.equal(spokenText('LAU P2 · REY 2.4s'),'Theo position 2 , Nico 2.4 seconds');});
test('all five team members have stable, distinct neural voices',()=>{assert.equal(new Set(['LAU','REY','STRATEGIST','TYRE SPECIALIST','DATA ENGINEER'].map(s=>voiceProfile(s).voice)).size,5);});
test('interrupt during inference never plays the stale response',async()=>{
  const radio=setup();let air=0;radio.onAir=()=>air++;radio.say('Box now.','LAU');const worker=FakeWorker.last;
  worker.reply({id:worker.requests[0].id,type:'ready'});await flush();const inference=worker.requests.at(-1);assert.equal(inference.type,'speak');radio.interrupt();
  worker.reply({id:inference.id,type:'audio',audio:new Float32Array(24000),rate:24000});await flush();assert.equal(air,0);
});
test('audio off during model loading prevents a synthesis request',async()=>{
  const radio=setup();radio.say('Box now.','LAU');const worker=FakeWorker.last;radio.enabled=false;radio.interrupt();worker.reply({id:worker.requests[0].id,type:'ready'});await flush();assert.equal(worker.requests.length,1);
});
test('ready voice plays PCM and interruption stops it without a stuck queue',async()=>{
  const radio=setup();let air=0;radio.onAir=()=>air++;radio.say('Copy.','REY');const worker=FakeWorker.last;worker.reply({id:worker.requests[0].id,type:'ready'});await flush();worker.reply({id:worker.requests.at(-1).id,type:'audio',audio:new Float32Array(24000),rate:24000});await flush();assert.equal(air,1);radio.interrupt();await flush();radio.say('Copy.','REY');await flush();assert.equal(air,2);radio.interrupt();
});
test('a model error is visible and a later load can retry',async()=>{
  const radio=setup();const statuses:string[]=[];radio.onStatus=t=>statuses.push(t);
  const first=radio.prepare();const worker=FakeWorker.last;worker.reply({id:worker.requests.at(-1).id,type:'error',error:'Download failed'});
  await assert.rejects(first,/Download failed/);assert.match(statuses.at(-1)!,/Voices unavailable/);
  const second=radio.prepare();worker.reply({id:worker.requests.at(-1).id,type:'ready'});await second;assert.equal(radio.ready,true);
});
test('every role on the radio has its own voice',()=>{assert.equal(new Set(['LAU','REY','STRATEGIST','TYRE SPECIALIST','DATA ENGINEER','RACE CONTROL','PIT CREW'].map(s=>voiceProfile(s).voice)).size,7);});
test('lines go stale in race time and urgent lines jump the queue',async()=>{
  const radio=setup();let now=0;radio.clock=()=>now;const aired:string[]=[];radio.onAir=(_s,t)=>aired.push(t);
  radio.line({text:'Old gap update.',speaker:'DATA ENGINEER',priority:1,at:0,ttl:10});
  radio.line({text:'Safety car!',speaker:'RACE CONTROL',priority:3,at:0,ttl:30});
  const worker=FakeWorker.last;worker.reply({id:worker.requests[0].id,type:'ready'});await flush();
  const speak=worker.requests.filter(r=>r.type==='speak');assert.equal(speak.length,2);
  const gap=speak.find(r=>r.text==='Old gap update.'),safety=speak.find(r=>r.text==='Safety car!');
  worker.reply({id:gap.id,type:'audio',audio:new Float32Array(240),rate:24000});await flush();
  assert.deepEqual(aired,[],'the urgent line is still synthesising, so nothing airs yet');
  worker.reply({id:safety.id,type:'audio',audio:new Float32Array(240),rate:24000});await flush();
  assert.deepEqual(aired,['Safety car!']);
  now=20;(radio as any).source.stop();await flush();
  assert.deepEqual(aired,['Safety car!'],'the gap update went stale in race time and never airs');
});
test('keying the mic cancels queued synthesis in the worker',async()=>{
  const radio=setup();radio.say('One.','LAU');radio.say('Two.','REY');
  const worker=FakeWorker.last;worker.reply({id:worker.requests[0].id,type:'ready'});await flush();
  const ids=worker.requests.filter(r=>r.type==='speak').map(r=>r.id);assert.equal(ids.length,2);
  radio.interrupt();const cancel=worker.requests.at(-1);
  assert.equal(cancel.type,'cancel');assert.deepEqual([...cancel.ids].sort(),[...ids].sort());
});
test('failed synthesis is dropped and the next transmission can play',async()=>{
  const radio=setup();let air=0;radio.onAir=()=>air++;
  radio.say('First call.','LAU');const worker=FakeWorker.last;
  worker.reply({id:worker.requests[0].id,type:'ready'});await flush();
  worker.reply({id:worker.requests.at(-1).id,type:'error',error:'synthesis failed'});await flush();
  radio.say('Second call.','REY');await flush();
  worker.reply({id:worker.requests.at(-1).id,type:'audio',audio:new Float32Array(24000),rate:24000});await flush();
  assert.equal(air,1);radio.interrupt();
});
