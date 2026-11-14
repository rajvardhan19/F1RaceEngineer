import {KokoroTTS} from 'kokoro-js';
import {env} from '@huggingface/transformers';
import {voiceProfile,spokenText} from './radio-profile.ts';
import {audible} from './radio-audio.ts';
env.allowLocalModels=false;
const MODEL='onnx-community/Kokoro-82M-v1.0-ONNX';
// Measured in Chrome: q8 on the single-thread WASM runtime renders ~3x slower than real time, so
// live lines arrived late or went stale. fp32 on WebGPU renders 2.5–5x faster than real time.
// fp16 on WebGPU produced silent audio in testing, so it is not used.
const GPU_DTYPE='fp32';
type Device='webgpu'|'wasm';
let model:Promise<{tts:KokoroTTS;device:Device}>|null=null;
const progress=(p:{status:string;progress?:number})=>{if('progress' in p)self.postMessage({type:'progress',progress:p.progress});};
function useSelfHostedWasm(){
  if(!env.backends.onnx.wasm)return;
  env.backends.onnx.wasm.numThreads=1;
  env.backends.onnx.wasm.wasmPaths={mjs:new URL('/voice-runtime/ort-wasm-simd-threaded.mjs',self.location.origin).href,wasm:new URL('/voice-runtime/ort-wasm-simd-threaded.wasm',self.location.origin).href};
}
async function open(prefer:Device){
  if(prefer==='webgpu'){
    const gpu=(self.navigator as Navigator&{gpu?:{requestAdapter():Promise<unknown>}}).gpu;
    if(await gpu?.requestAdapter().catch(()=>null)){
      // WebGPU keeps transformers.js' default runtime from its CDN (too large to self-host).
      try{
        const tts=await KokoroTTS.from_pretrained(MODEL,{dtype:GPU_DTYPE,device:'webgpu',progress_callback:progress});
        // Warm-up render: compiles shaders before the race and proves this GPU produces real audio.
        const probe=await tts.generate('Radio check.',{voice:'am_michael'});
        if(audible(Float32Array.from(Array.isArray(probe.audio)?probe.audio[0]:probe.audio)))return {tts,device:'webgpu' as const};
      }catch{/* fall back to the CPU path below */}
    }else useSelfHostedWasm();
  }else useSelfHostedWasm();
  return {tts:await KokoroTTS.from_pretrained(MODEL,{dtype:'q8',device:'wasm',progress_callback:progress}),device:'wasm' as const};
}
function load(prefer:Device){
  if(!model)model=open(prefer).catch(e=>{model=null;throw e;});
  return model;
}
// Serial inference avoids overlapping runs. Jobs the UI cancelled while queued are skipped,
// so a reply to the player never waits behind stale lines.
let chain=Promise.resolve();
const cancelled=new Set<number>();
self.onmessage=(event:MessageEvent<{id:number;type:'load'|'speak'|'cancel';text:string;speaker:string;ids?:number[];prefer?:Device}>)=>{
  const {id,type,text,speaker,ids,prefer}=event.data;
  if(type==='cancel'){for(const x of ids??[])cancelled.add(x);return;}
  chain=chain.then(async()=>{
    if(cancelled.delete(id))return;
    try{
      const {tts,device}=await load(prefer??'wasm');
      if(type==='load'){self.postMessage({id,type:'ready',device});return;}
      const profile=voiceProfile(speaker);
      const result=await tts.generate(spokenText(text),{voice:profile.voice,speed:profile.rate});
      const audio=Float32Array.from(Array.isArray(result.audio)?result.audio[0]:result.audio);
      self.postMessage({id,type:'audio',audio,rate:result.sampling_rate},{transfer:[audio.buffer]});
    }catch(e){self.postMessage({id,type:'error',error:e instanceof Error?e.message:String(e)});}
  });
};
