import { env, pipeline } from '@huggingface/transformers';
env.allowLocalModels=false;
// One thread works without cross-origin isolation and keeps the UI responsive in a worker.
if(env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads=1;
  // The smaller synchronous runtime runs inside this worker, on our own origin.
  env.backends.onnx.wasm.wasmPaths={mjs:new URL('/voice-runtime/ort-wasm-simd-threaded.mjs',self.location.origin).href,wasm:new URL('/voice-runtime/ort-wasm-simd-threaded.wasm',self.location.origin).href};
}
let transcriber: Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>> | null = null;
let loading: Promise<void> | null = null;
async function load() {
  if(transcriber)return;
  if(!loading) loading=(async()=>{
    transcriber=await pipeline('automatic-speech-recognition','onnx-community/whisper-tiny.en',{
      device:'wasm',dtype:'q8',
      progress_callback:(p)=>{if('progress' in p)self.postMessage({type:'progress',file:'file' in p?p.file:'model',progress:p.progress});},
    });
  })().catch(error=>{loading=null;throw error;});
  await loading;
}
self.onmessage=async(event:MessageEvent<{id:number;type:'load'|'transcribe';audio?:Float32Array}>)=>{
  const {id,type,audio}=event.data;
  try {
    await load();
    if(type==='load'){self.postMessage({id,type:'ready'});return;}
    if(!audio?.length)throw new Error('No audio received.');
    const result=await transcriber!(audio,{max_new_tokens:64,temperature:0,do_sample:false});
    const text=Array.isArray(result)?result[0].text:result.text;
    self.postMessage({id,type:'result',text:text.trim()});
  }catch(error){self.postMessage({id,type:'error',error:error instanceof Error?error.message:String(error)});}
};
