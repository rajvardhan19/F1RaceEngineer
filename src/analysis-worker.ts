import {analyze} from './analysis.ts';
import type {Race} from './sim.ts';
self.onmessage=(event:MessageEvent<{seed:number;decisions:Race['decisions']}>)=>{
  try {const result=analyze(event.data.seed,event.data.decisions,(done,total)=>self.postMessage({type:'progress',done,total}));self.postMessage({type:'complete',result});}
  catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});}
};
