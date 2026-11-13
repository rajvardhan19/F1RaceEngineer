import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRace,step,playerCar,order} from '../src/sim.ts';
import type {Race} from '../src/sim.ts';
import {parseIntent,parseAnswer} from '../src/intent.ts';
import {Conversation} from '../src/conversation.ts';

function race(){const r=createRace();r.status='running';const c=new Conversation(r);let wall=0;c.now=()=>wall;c.start(r);return {r,c,advance:(ms:number)=>{wall+=ms;}};}
function runUntil(r:Race,c:Conversation,until:(r:Race)=>boolean,limit=3000){for(let i=0;i<limit&&r.status==='running'&&!until(r);i++){step(r);c.observe(r);}}
const spoken=(c:Conversation)=>c.lines.filter(l=>l.voice);

test('speech-recognition slips and radio phrasing become the intended call',()=>{
  const call=(t:string)=>{const i=parseIntent(t);return i.kind==='command'?{...i.command,cars:i.cars}:i;};
  assert.deepEqual(call('Car to, box for mediums.'),{car:2,action:'pit',compound:'medium',cars:undefined});
  assert.deepEqual(call('Car won, stay out'),{car:1,action:'stay',cars:undefined});
  assert.deepEqual(call('Nicko, box box'),{car:2,action:'pit',compound:'medium',cars:undefined});
  assert.deepEqual(call('Theo, you can box now'),{car:1,action:'pit',compound:'medium',cars:undefined});
  assert.deepEqual(call('Car one, not now, box next lap'),{car:1,action:'pit',compound:'medium',cars:undefined});
  assert.deepEqual(call('Nico, come in this lap, reds'),{car:2,action:'pit',compound:'soft',cars:undefined});
  assert.deepEqual(call('Nico, lift and coast'),{car:2,action:'conserve',cars:undefined});
  assert.deepEqual(call('Theo, don’t push'),{car:1,action:'balanced',cars:undefined});
  assert.deepEqual(call('box both cars'),{car:1,action:'pit',compound:'medium',cars:[1,2]});
  assert.deepEqual(call('Theo, can you box this lap'),{car:1,action:'pit',compound:'medium',cars:undefined});
  assert.deepEqual(call('Nico, do not pit'),{car:2,action:'stay',cars:undefined});
  assert.deepEqual(parseIntent('Theo, let Nico through'),{kind:'swap',car:1});
  assert.deepEqual(parseIntent('Nico, give Theo the place'),{kind:'swap',car:2});
  assert.equal(parseIntent('Nico, inters this lap').kind,'clarify');
  assert.deepEqual(parseIntent('is Keller pitting?',2),{kind:'question',topic:'rival',car:2,rival:'Keller'});
  assert.equal(parseIntent('how many laps left?').kind,'question');
});
test('yes and no answers are recognised in radio language',()=>{
  for(const t of ['yes','copy','go for it','okay Nico, go','understood','affirmative','no problem'])assert.equal(parseAnswer(t),'yes',t);
  for(const t of ['no','negative','not yet','hold','stay out'])assert.equal(parseAnswer(t),'no',t);
  assert.equal(parseAnswer('box for softs'),null);
});
test('a driver asking to push can be answered with a plain yes, and the call is recorded',()=>{
  const {r,c}=race();
  runUntil(r,c,()=>c.questions.some(q=>q.kind==='push'));
  const q=c.questions.find(q=>q.kind==='push')!;assert(q,'Nico should ask to push behind Keller');
  c.hear(r,'yes');
  const car=playerCar(r,q.car)!;assert.equal(car.mode,'push');
  assert.deepEqual(r.decisions.at(-1)!.command,{car:q.car,action:'push'});
  assert.equal(c.questions.some(x=>x.id===q.id),false);
  assert.equal(c.lines.at(-1)!.speaker,q.car===2?'REY':'LAU');
});
test('a refusal is acknowledged in character and does not issue a call',()=>{
  const {r,c}=race();
  runUntil(r,c,()=>c.questions.some(q=>q.kind==='push'));
  const before=r.decisions.length;c.hear(r,'negative, hold position');
  assert.equal(r.decisions.length,before);assert.equal(c.questions.length,0);
  assert.equal(c.lines.at(-1)!.speaker,'REY');
});
test('nobody asks to push while already pushing, and silence gets a reaction, not a call',()=>{
  const {r,c}=race();c.hear(r,'Nico, push');c.hear(r,'Theo, push');
  const asked=c.asked;runUntil(r,c,r=>r.elapsed>=260);
  assert.equal(c.lines.filter(l=>l.kind==='question'&&/push|attack|go for it/i.test(l.text)).length,0);
  assert(c.asked>=asked);
  const {r:r2,c:c2}=race();runUntil(r2,c2,()=>c2.questions.some(q=>q.kind==='push'));
  const decisions=r2.decisions.length;runUntil(r2,c2,()=>!c2.questions.length);
  assert.equal(r2.decisions.length,decisions);assert.match(c2.lines.at(-1)!.text,/hold|Nothing|Hello/i);
});
test('the safety car brings a decision to the wall; “box both” orders both cars',()=>{
  const {r,c}=race();runUntil(r,c,r=>r.flag==='safety');
  const q=c.questions.find(q=>q.kind==='safety')!;assert(q);assert.equal(q.options[0].label,'Box both');
  c.hear(r,'box both');
  assert.equal(playerCar(r,1)!.pitOrder,'medium');assert.equal(playerCar(r,2)!.pitOrder,'medium');
  assert.equal(c.questions.some(x=>x.kind==='safety'),false);
  assert.match(c.lines.at(-1)!.text,/Double stack/);
});
test('drivers ask for their result at the flag and react to the real position',()=>{
  const {r,c,advance}=race();c.hear(r,'box both');
  runUntil(r,c,()=>c.questions.some(q=>q.kind==='result'),5000);
  const q=c.questions.find(q=>q.kind==='result')!;assert(q);
  const pos=order(r).findIndex(x=>x.id===playerCar(r,q.car)!.id)+1;
  c.hear(r,'great job');
  assert(c.lines.at(-1)!.text.includes(`P${pos}`)||/Top five|Podium|won/i.test(c.lines.at(-1)!.text));
  runUntil(r,c,()=>false,5000);advance(20000);c.tick(r);
  assert.equal(c.questions.length,0);assert.equal(c.lines.at(-1)!.speaker,'STRATEGIST');
});
test('a player who never answers is not nagged: no line repeats more than twice',()=>{
  const {r,c,advance}=race();runUntil(r,c,()=>false,5000);advance(30000);c.tick(r);
  const counts=new Map<string,number>();for(const l of spoken(c))counts.set(l.text,(counts.get(l.text)??0)+1);
  assert(Math.max(...counts.values())<=2,JSON.stringify([...counts].filter(([,n])=>n>2)));
  assert(c.lines.filter(l=>l.kind==='question').length<=12);
});
test('position milestones are announced once the order settles, not during pit shuffles',()=>{
  const {r,c}=race();c.hear(r,'box both');runUntil(r,c,()=>false,5000);
  const lead=c.lines.filter(l=>/leading the race/.test(l.text));assert(lead.length<=2);
  for(let i=1;i<c.lines.length;i++){const a=c.lines[i-1],b=c.lines[i];
    if(/drops to/.test(a.text)&&/into the top five|back on the podium/.test(b.text))assert(b.at-a.at>=8,'flapping milestone');}
});
test('free-form questions go to the model only when it is enabled, addressed to the right person',()=>{
  const {r,c}=race();
  assert.equal(c.hear(r,'Nico, how are you feeling?'),null);assert.equal(c.lines.at(-1)!.speaker,'REY');
  c.brainAvailable=()=>true;
  assert.deepEqual(c.hear(r,'Nico, how are you feeling?'),{speaker:'REY',car:2,text:'Nico, how are you feeling?'});
  assert.equal(c.hear(r,'James, what do you think?')!.speaker,'STRATEGIST');
  const before=r.decisions.length;
  c.brainReply(r,{speaker:'REY',car:2,text:'x'},'Feels good. Let me race!');
  assert.equal(c.lines.at(-1)!.text,'Feels good. Let me race!');assert.equal(r.decisions.length,before);
  c.brainReply(r,{speaker:'REY',car:2,text:'x'},null,'offline');
  assert.match(c.lines.at(-1)!.text,/Team chat model unavailable/);
});
test('unknown calls get an in-character “say again”, never a silent failure',()=>{
  const {r,c}=race();c.hear(r,'Nico, banana');
  const spokenLines=c.lines.filter(l=>l.voice);assert.match(spokenLines.at(-1)!.text,/Say again|Didn’t get that/);
});
test('asking about team orders never executes a swap',()=>{
  const {r,c}=race();
  for(const text of ['Should Theo let Nico through?','Do we swap them?','Theo, do not let Nico through']){c.hear(r,text);assert.equal(r.decisions.length,0,text);}
});
test('answering a car clarification retains the original instruction',()=>{
  const {r,c}=race();c.hear(r,'box for softs');assert.equal(r.decisions.length,0);c.hear(r,'Nico');
  assert.deepEqual(r.decisions.at(-1)?.command,{car:2,action:'pit',compound:'soft'});
});
test('clarified instructions expire instead of executing a forgotten call',()=>{
  const {r,c,advance}=race();c.hear(r,'box for softs');advance(31000);c.hear(r,'Nico');assert.equal(r.decisions.length,0);
});
test('follow-ups retain the topic and can switch drivers',()=>{
  const {r,c}=race();c.hear(r,'How are Nico’s tyres?');c.hear(r,'what about Theo?');assert.equal(c.recentCar,1);assert.match(c.lines.at(-1)!.text,/Theo.*mediums/);
  c.hear(r,'why?');assert.match(c.lines.at(-1)!.text,/laps of tyre life/);assert.equal(r.decisions.length,0);
});
test('a named reply cannot accidentally answer the other driver',()=>{
  const {r,c}=race();runUntil(r,c,()=>c.questions.some(q=>q.kind==='push'));
  const q=c.questions.find(q=>q.kind==='push')!;assert.equal(q.car,2);
  c.hear(r,'Theo, yes');assert.equal(r.decisions.length,0);assert(c.questions.includes(q));
  c.hear(r,'no, Theo conserve');assert.deepEqual(r.decisions.at(-1)?.command,{car:1,action:'conserve'});assert(c.questions.includes(q));
});
test('a question containing a refusal word does not dismiss the driver',()=>{
  const {r,c}=race();runUntil(r,c,()=>c.questions.some(q=>q.kind==='push'));const q=c.questions.at(-1)!;
  c.hear(r,'Nico, why not stay out?');assert(c.questions.includes(q));assert.equal(r.decisions.length,0);
});
test('an AI follow-up keeps the engineer being addressed',()=>{
  const {r,c}=race();c.brainAvailable=()=>true;c.hear(r,'Nico, how are you feeling?');
  assert.equal(c.hear(r,'James, what do you think?')?.speaker,'STRATEGIST');
  assert.equal(c.hear(r,'why?')?.speaker,'STRATEGIST');
});
