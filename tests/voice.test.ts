import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VoiceInput,voiceError,hasSpeech} from '../src/voice-input.ts';
import {voiceProfile} from '../src/radio.ts';

class FakeRecognition {
  static last:FakeRecognition;
  lang='';continuous=false;interimResults=false;
  onstart:any;onresult:any;onerror:any;onend:any;stops=0;aborts=0;
  constructor(){FakeRecognition.last=this;}
  start(){this.onstart?.();}
  stop(){this.stops++;}
  abort(){this.aborts++;}
}
function setup(){
  Object.assign(globalThis,{window:{SpeechRecognition:FakeRecognition},cancelAnimationFrame:()=>{}});
  const transcripts:{text:string;final:boolean}[]=[],states:string[]=[],errors:string[]=[];
  const input=new VoiceInput({state:(s)=>states.push(s),transcript:(text,final)=>transcripts.push({text,final}),error:t=>errors.push(t),level:()=>{}});
  input.engine='browser';return {input,transcripts,states,errors};
}
test('network failure gives a different recovery path, not endless retries',()=>{assert.match(voiceError('network'),/On-device/);assert.match(voiceError('NotAllowedError'),/permissions/);});
test('silence and very short clips cannot become race commands',()=>{assert.equal(hasSpeech(new Float32Array(16000)),false);assert.equal(hasSpeech(new Float32Array(100).fill(.5)),false);assert.equal(hasSpeech(new Float32Array(16000).fill(.06)),true);});
test('interim transcript does not issue a final command; final waits for capture to end',async()=>{
  const {input,transcripts}=setup();await input.start();const native=FakeRecognition.last;
  native.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'car two'}}]});
  assert.deepEqual(transcripts,[{text:'car two',final:false}]);
  native.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'car two box for mediums'}}]});
  assert.equal(transcripts.length,1);assert.equal(native.stops,1);native.onend();
  assert.deepEqual(transcripts.at(-1),{text:'car two box for mediums',final:true});input.cancel();
});
test('cancelled sessions cannot deliver stale transcript or error callbacks',async()=>{
  const {input,transcripts,errors}=setup();await input.start();const old=FakeRecognition.last;input.cancel();await input.start();
  old.onresult({resultIndex:0,results:[{isFinal:true,0:{transcript:'car one box'}}]});old.onerror({error:'network'});old.onend();
  assert.equal(transcripts.length,0);assert.equal(errors.length,0);assert.equal(input.state,'listening');input.cancel();
});
test('native network errors remain visible after the end event',async()=>{
  const {input,errors}=setup();await input.start();const native=FakeRecognition.last;native.onerror({error:'network'});native.onend();
  assert.equal(input.state,'error');assert.match(errors[0],/could not connect/);input.cancel();
});
test('double start while connecting or listening does not create concurrent sessions',async()=>{
  const {input}=setup();await input.start();const native=FakeRecognition.last;await input.start();assert.equal(FakeRecognition.last,native);assert.equal(native.stops,1);input.cancel();
});
test('driver voice profiles are distinct',()=>{assert.notDeepEqual(voiceProfile('LAU'),voiceProfile('REY'));assert.notEqual(voiceProfile('LAU').rate,voiceProfile('REY').rate);});
test('observed local-ASR car-number variants route to the intended driver',async()=>{
  const {parseIntent}=await import('../src/intent.ts');
  for(const text of ['Card II, Box for Mediums.','Car II box for mediums','card two box for mediums'])assert.deepEqual(parseIntent(text),{kind:'command',command:{car:2,action:'pit',compound:'medium'}});
  assert.equal(parseIntent('car one and card II box').kind,'clarify');
});
