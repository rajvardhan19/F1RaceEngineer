import {defineConfig} from 'vite';
export default defineConfig({worker:{format:'es'},build:{chunkSizeWarningLimit:2000},plugins:[{
  name:'omit-unused-default-onnx-runtime',
  generateBundle(_options,bundle){
    // speech-worker pins the self-hosted synchronous runtime prepared before builds.
    // ORT's unused asyncify fallback exceeds static hosts' per-file size limit.
    for(const file of Object.keys(bundle))if(file.endsWith('.wasm')&&file.includes('asyncify'))delete bundle[file];
  },
}]});
