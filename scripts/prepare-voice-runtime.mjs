import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('../public/voice-runtime/',import.meta.url),{recursive:true});
for(const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']) {
  await copyFile(new URL('../node_modules/onnxruntime-web/dist/'+name,import.meta.url),new URL('../public/voice-runtime/'+name,import.meta.url));
}
