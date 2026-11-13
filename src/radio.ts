import {voiceProfile} from './radio-profile.ts';
export {voiceProfile} from './radio-profile.ts';

/** A line offered to the radio. `at` and `ttl` are race seconds, so staleness follows the race, not the wall clock. */
export interface RadioLine {text:string;speaker:string;priority:number;at:number;ttl:number}
type Clip={audio:Float32Array;rate:number};
interface Item extends RadioLine {queuedWall:number;request?:number;clip?:Promise<Clip>}

const MAX_QUEUE=4;        // anything further back would be stale by the time it played
const PREFETCH=2;         // synthesise the next line while the current one plays
const WALL_LIMIT=30000;   // a paused or throttled tab never plays half-minute-old news
const CACHE_SIZE=64;

/**
 * The radio director: decides what goes on air. Highest priority first, stale lines dropped,
 * the next clip prepared while the current one plays, and queued work cancelled when the
 * player keys the mic.
 */
export class RadioVoice {
  enabled=false;blocked=false;ready=false;
  /** Current race time in seconds. */
  clock:()=>number=()=>0;
  onAir:(speaker:string,text:string)=>void=()=>{};onSilent:()=>void=()=>{};
  onStatus:(text:string,error?:boolean)=>void=()=>{};
  private queue:Item[]=[];private current:Item|null=null;private speaking=false;private generation=0;
  private worker:Worker|null=null;private serial=0;private loading:Promise<void>|null=null;
  private pending=new Map<number,{resolve:(clip:Clip)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private context:AudioContext|null=null;private source:AudioBufferSourceNode|null=null;
  private cache=new Map<string,Clip>();
  private warmList:{text:string;speaker:string}[]=[];private warming=false;

  unlock(){
    if(!this.context)this.context=new AudioContext();
    void this.context.resume().catch(()=>this.onStatus('Click Audio on to enable playback.',true));
  }
  private request(type:'load'|'speak',text='',speaker='ENGINEER',onId?:(id:number)=>void):Promise<Clip>{
    if(!this.worker){
      this.worker=new Worker(new URL('./radio-worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        if(data.type==='progress'){if(!this.ready)this.onStatus(`Downloading neural voices · ${Math.round(data.progress)}%`);return;}
        const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);
        if(data.type==='error')p.reject(new Error(data.error));else p.resolve({audio:data.audio,rate:data.rate});
      };
      this.worker.onerror=()=>this.resetWorker('Neural voice worker failed. Try Load voices again.');
    }
    const id=++this.serial;onId?.(id);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.resetWorker('Neural voice loading or generation timed out. Try Load voices again.'),type==='load'?240000:60000);
      this.pending.set(id,{resolve,reject,timer});this.worker!.postMessage({id,type,text,speaker});
    });
  }
  private cancel(ids:number[]){
    const live=[...new Set(ids)].filter(id=>this.pending.has(id));
    if(!live.length)return;
    for(const id of live){const p=this.pending.get(id)!;clearTimeout(p.timer);this.pending.delete(id);p.reject(new Error('cancelled'));}
    this.worker?.postMessage({type:'cancel',ids:live});
  }
  private resetWorker(reason:string){
    this.worker?.terminate();this.worker=null;this.ready=false;this.loading=null;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}this.pending.clear();
  }
  prepare():Promise<void>{
    this.unlock();
    if(this.ready)return Promise.resolve();
    if(!this.loading){
      this.onStatus('Loading local neural voices. First download is about 90 MB.');
      this.loading=this.request('load').then(()=>{this.ready=true;this.onStatus('Neural radio ready · generated on this device');void this.pumpWarm();}).catch(e=>{this.loading=null;this.onStatus(`Voices unavailable: ${e.message}`,true);throw e;});
    }
    return this.loading;
  }
  private key(speaker:string,text:string){return voiceProfile(speaker).voice+':'+text;}
  private remember(key:string,clip:Clip){
    this.cache.delete(key);this.cache.set(key,clip);
    if(this.cache.size>CACHE_SIZE)this.cache.delete(this.cache.keys().next().value!);
  }
  private stale(item:Item){return this.clock()-item.at>item.ttl||Date.now()-item.queuedWall>WALL_LIMIT;}
  /** Start synthesis for the items that will play soonest. */
  private prefetch(){
    for(const item of this.queue.slice(0,PREFETCH)){
      if(item.clip)continue;
      const key=this.key(item.speaker,item.text),cached=this.cache.get(key);
      if(cached){item.clip=Promise.resolve(cached);continue;}
      const generation=this.generation;
      item.clip=this.prepare().then(()=>{
        if(generation!==this.generation)throw new Error('cancelled');
        return this.request('speak',item.text,item.speaker,id=>{item.request=id;});
      }).then(clip=>{this.remember(key,clip);return clip;});
      item.clip.catch(()=>{});
    }
  }
  private drop(items:Item[]){this.cancel(items.flatMap(i=>i.request?[i.request]:[]));}

  /** Offer a line to the radio. */
  line(l:RadioLine){
    if(!this.enabled||this.blocked)return;
    const item:Item={...l,queuedWall:Date.now()};
    this.drop(this.queue.filter(i=>this.stale(i)));
    this.queue=this.queue.filter(i=>!this.stale(i));
    this.queue.push(item);
    this.queue.sort((a,b)=>b.priority-a.priority||a.at-b.at);
    if(this.queue.length>MAX_QUEUE)this.drop(this.queue.splice(MAX_QUEUE));
    this.prefetch();void this.next();
  }
  /** Convenience for previews and one-off calls. */
  say(text:string,speaker='ENGINEER',urgent=false){
    this.line({text,speaker,priority:urgent?3:['LAU','REY'].includes(speaker)?2:1,at:this.clock(),ttl:30});
  }
  /** Synthesise fixed lines in the background while the radio is idle, so they start instantly later. */
  warm(lines:{text:string;speaker:string}[]){this.warmList=[...lines];void this.pumpWarm();}
  private async pumpWarm(){
    if(this.warming||!this.ready||!this.enabled)return;
    this.warming=true;
    try{
      while(this.warmList.length&&this.ready&&this.enabled){
        if(this.speaking||this.queue.length){await new Promise(resolve=>setTimeout(resolve,1500));continue;}
        const next=this.warmList.shift()!,key=this.key(next.speaker,next.text);
        if(this.cache.has(key))continue;
        try{this.remember(key,await this.request('speak',next.text,next.speaker));}catch{break;}
      }
    }finally{this.warming=false;}
  }
  interrupt(){
    this.generation++;
    this.drop(this.current&&!this.queue.includes(this.current)?[...this.queue,this.current]:this.queue);this.queue=[];this.current=null;this.speaking=false;
    if(this.source){this.source.stop();this.source=null;}
    // Retain the downloaded model, but never play a cancelled generation.
    this.onSilent();
  }
  private async next(){
    if(this.speaking||!this.queue.length||!this.enabled||this.blocked)return;
    const expired=this.queue.filter(i=>this.stale(i));this.drop(expired);
    this.queue=this.queue.filter(i=>!this.stale(i));
    this.prefetch();
    let item=this.queue[0];if(!item)return;
    this.speaking=true;this.current=item;const generation=this.generation;
    try{
      if(!this.ready)this.onStatus('Preparing team transmission…');
      // Wait for the head's audio. If a more urgent line was queued meanwhile, it goes first.
      let clip=await item.clip!;
      for(;;){
        if(generation!==this.generation||!this.enabled||this.blocked)return;
        this.drop(this.queue.filter(i=>this.stale(i)));this.queue=this.queue.filter(i=>!this.stale(i));
        const head=this.queue[0];
        if(!head)return;
        if(head===item)break;
        item=head;this.current=item;this.prefetch();clip=await item.clip!;
      }
      this.queue.shift();this.prefetch();
      const ctx=this.context!;
      if(ctx.state!=='running')throw new Error('Audio is suspended. Toggle Audio off, then on.');
      const buffer=ctx.createBuffer(1,clip.audio.length,clip.rate);buffer.copyToChannel(new Float32Array(clip.audio),0);
      const source=ctx.createBufferSource();source.buffer=buffer;this.source=source;
      const high=ctx.createBiquadFilter();high.type='highpass';high.frequency.value=340;
      const low=ctx.createBiquadFilter();low.type='lowpass';low.frequency.value=['LAU','REY'].includes(item.speaker)?3200:4200;
      const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-25;compressor.knee.value=12;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.12;
      const gain=ctx.createGain();gain.gain.value=.85;
      source.connect(high).connect(low).connect(compressor).connect(gain).connect(ctx.destination);
      this.onAir(item.speaker,item.text);this.onStatus('Neural radio · '+voiceProfile(item.speaker).label);
      await new Promise<void>(resolve=>{
        source.onended=()=>{source.disconnect();high.disconnect();low.disconnect();compressor.disconnect();gain.disconnect();if(this.source===source)this.source=null;resolve();};source.start();
      });
    }catch(e){
      // A failed clip must leave the queue; retrying its rejected promise loops forever.
      if(generation===this.generation)this.queue=this.queue.filter(queued=>queued!==item);
      const message=e instanceof Error?e.message:String(e);
      if(generation===this.generation&&message!=='cancelled')this.onStatus(`Radio unavailable: ${message}`,true);
    }
    finally{if(generation===this.generation){this.speaking=false;this.current=null;this.onSilent();void this.next();}}
  }
}
export interface Recognition {
  lang:string;continuous:boolean;interimResults:boolean;
  onstart:(()=>void)|null;
  onresult:((event:{resultIndex:number;results:{length:number;[key:number]:{isFinal:boolean;[key:number]:{transcript:string}}}})=>void)|null;
  onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;
  start():void;stop():void;abort():void;
}
export function recognitionConstructor():(new()=>Recognition)|undefined {
  const w=window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};return w.SpeechRecognition??w.webkitSpeechRecognition;
}
