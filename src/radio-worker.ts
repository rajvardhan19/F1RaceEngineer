import {KokoroTTS} from 'kokoro-js';
import {env} from '@huggingface/transformers';
import {voiceProfile,spokenText} from './radio-profile.ts';
env.allowLocalModels=false;
if(env.backends.onnx.wasm){
  env.backends.onnx.wasm.numThreads=1;
  env.backends.onnx.wasm.wasmPaths={mjs:new URL('/voice-runtime/ort-wasm-simd-threaded.mjs',self.location.origin).href,wasm:new URL('/voice-runtime/ort-wasm-simd-threaded.wasm',self.location.origin).href};
}
let model:Promise<KokoroTTS>|null=null;
function load(){
  if(!model)model=KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{
    dtype:'q8',device:'wasm',progress_callback:p=>{if('progress' in p)self.postMessage({type:'progress',progress:p.progress});},
  }).catch(e=>{model=null;throw e;});
  return model;
}
// Serial inference avoids overlapping WASM runs. Jobs the UI cancelled while queued are skipped,
// so a reply to the player never waits behind stale lines.
let chain=Promise.resolve();
const cancelled=new Set<number>();
self.onmessage=(event:MessageEvent<{id:number;type:'load'|'speak'|'cancel';text:string;speaker:string;ids?:number[]}>)=>{
  const {id,type,text,speaker,ids}=event.data;
  if(type==='cancel'){for(const x of ids??[])cancelled.add(x);return;}
  chain=chain.then(async()=>{
    if(cancelled.delete(id))return;
    try{
      const tts=await load();
      if(type==='load'){self.postMessage({id,type:'ready'});return;}
      const profile=voiceProfile(speaker);
      const result=await tts.generate(spokenText(text),{voice:profile.voice,speed:profile.rate});
      const audio=Float32Array.from(Array.isArray(result.audio)?result.audio[0]:result.audio);
      self.postMessage({id,type:'audio',audio,rate:result.sampling_rate},{transfer:[audio.buffer]});
    }catch(e){self.postMessage({id,type:'error',error:e instanceof Error?e.message:String(e)});}
  });
};
