import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRace} from '../src/sim.ts';
import {buildPrompt,cleanReply,raceFacts} from '../src/brain-prompt.ts';
import type {BrainRequest} from '../src/brain-prompt.ts';
import {TeamBrain} from '../src/brain.ts';

const req=(over:Partial<BrainRequest>={}):BrainRequest=>({id:1,speaker:'REY',car:2,text:'How are you?',facts:['You are P4. Keller is 1.2 seconds ahead.'],recent:['Nico: Got him!'],...over});
test('drivers hear their own facts in the second person, engineers in the third',()=>{
  const r=createRace();
  assert.match(raceFacts(r,2,'REY').join(' '),/You are P5/);
  assert.match(raceFacts(r,2,'STRATEGIST').join(' '),/Nico is P5/);
});
test('prompt ends with the engineer’s words and carries the facts and recent radio',()=>{
  const m=buildPrompt(req({text:'Talk to me, Nico'}));
  assert.equal(m[0].role,'system');assert.match(m[0].content,/Reply as Nico/);
  assert.match(m.at(-1)!.content,/Facts: You are P4[\s\S]*Recent radio: Nico: Got him![\s\S]*Engineer: Talk to me, Nico$/);
});
test('model replies are cleaned: no self-address, no invented numbers, no cut-off sentence',()=>{
  assert.equal(cleanReply('Keep pushing, Nico! Feels good.',req()),'Keep pushing! Feels good.');
  assert.equal(cleanReply('Keller is 1.2 ahead. Sato is 0.4 behind me.',req()),'Keller is 1.2 ahead.');
  assert.equal(cleanReply('Tyres are good. I will try to get past him before the',req()),'Tyres are good.');
  assert.equal(cleanReply('P9 now.',req()),null);
});
class FakeWorker{static all:FakeWorker[]=[];onmessage:any;onerror:any;sent:any[]=[];constructor(){FakeWorker.all.push(this);}postMessage(d:any){this.sent.push(d);}terminate(){}reply(d:any){this.onmessage({data:d});}}
const flush=()=>new Promise(r=>setImmediate(r));
test('without WebGPU team chat explains itself and downloads nothing',async()=>{
  Object.assign(globalThis,{Worker:FakeWorker});FakeWorker.all=[];
  const brain=new TeamBrain();const statuses:string[]=[];brain.onStatus=t=>statuses.push(t);
  await assert.rejects(brain.enable(),/WebGPU/);
  assert.equal(FakeWorker.all.length,0);assert.equal(brain.ready,false);assert.match(statuses.at(-1)!,/scripted team radio/);
});
test('with WebGPU team chat loads once, then answers with a cleaned reply',async()=>{
  Object.assign(globalThis,{Worker:FakeWorker});FakeWorker.all=[];
  Object.defineProperty(globalThis.navigator,'gpu',{value:{},configurable:true});
  const brain=new TeamBrain();
  const ready=brain.enable();assert.equal(brain.enable(),ready,'a second click reuses the same load');
  const worker=FakeWorker.all[0];assert.equal(worker.sent[0].type,'load');
  worker.reply({id:worker.sent[0].id,type:'ready'});await ready;assert.equal(brain.ready,true);
  const answer=brain.reply(req());await flush();const chat=worker.sent.at(-1);assert.equal(chat.type,'chat');
  worker.reply({id:chat.id,type:'reply',text:'Nico: Feels mega, Nico!'});
  assert.equal(await answer,'Feels mega!');
  delete (globalThis.navigator as any).gpu;
});
test('interrupting discards active and queued model replies',async()=>{
  Object.assign(globalThis,{Worker:FakeWorker});FakeWorker.all=[];
  Object.defineProperty(globalThis.navigator,'gpu',{value:{},configurable:true});
  const brain=new TeamBrain();const ready=brain.enable();const worker=FakeWorker.all[0];worker.reply({id:worker.sent[0].id,type:'ready'});await ready;
  const first=brain.reply(req());const queued=brain.reply(req({id:2}));await flush();brain.cancelReplies();
  worker.reply({id:worker.sent.at(-1).id,type:'reply',text:'Old answer.'});assert.equal(await first,null);assert.equal(await queued,null);
  assert.equal(worker.sent.filter(x=>x.type==='chat').length,1);delete (globalThis.navigator as any).gpu;
});
