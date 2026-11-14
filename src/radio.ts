import {voiceProfile} from './radio-profile.ts';
import {radioCue} from './radio-cues.ts';
export {voiceProfile} from './radio-profile.ts';

/** A line offered to the radio. `at` and `ttl` are race seconds, so staleness follows the race, not the wall clock. */
export interface RadioLine {text:string;speaker:string;priority:number;at:number;ttl:number}
type Clip={audio:Float32Array;rate:number};
interface Part {text:string;request?:number;clip?:Promise<Clip>}
interface Item extends RadioLine {parts:Part[]}

const MAX_QUEUE=12;        // anything further back would be stale by the time it played
const PREFETCH=2;         // synthesise the next line while the current one plays
const CACHE_SIZE=96;

/**
 * Long lines are spoken sentence by sentence, so the first sentence airs as soon as it is
 * rendered instead of waiting for the whole line. Fragments like “Copy.” stay attached to the
 * next sentence to keep the delivery natural.
 */
export function sentences(text:string):string[]{
  const raw=text.split(/(?<=[.!?…])\s+(?=[A-Z0-9“"])/);
  const parts:string[]=[];
  for(const piece of raw){
    if(parts.length&&parts[parts.length-1].length<12)parts[parts.length-1]+=' '+piece;
    else parts.push(piece);
  }
  // A short closing fragment (“Copy.”, “Box him?”) rides with the sentence before it: each render has a fixed GPU cost.
  if (parts.length > 1 && parts[parts.length - 1].length < 12) parts[parts.length - 2] += ' ' + parts.pop();
  return parts;
}

/**
 * The radio director: decides what goes on air. Highest priority first, stale lines dropped,
 * the next clip prepared while the current one plays, and queued work cancelled when the
 * player keys the mic.
 */
export class RadioVoice {
  enabled=false;blocked=false;ready=false;
  /** Where voices render: the GPU when the browser offers WebGPU, otherwise the CPU (about 3x slower than speech). */
  device:'webgpu'|'wasm'|null=null;
  /** Current race time in seconds. */
  clock:()=>number=()=>0;
  onAir:(speaker:string,text:string)=>void=()=>{};onSilent:()=>void=()=>{};
  onStatus:(text:string,error?:boolean)=>void=()=>{};
  private queue:Item[]=[];private current:Item|null=null;private speaking=false;private generation=0;
  private worker:Worker|null=null;private serial=0;private loading:Promise<void>|null=null;
  private pending=new Map<number,{resolve:(clip:Clip)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private context:AudioContext|null=null;private source:AudioBufferSourceNode|null=null;
  private cache=new Map<string,Clip>();
  /** Something is on air or waiting to be. */
  get busy(){return this.speaking||this.queue.length>0;}
  /** Hold the race while rendering; do not let accelerated time expire an unheard turn. */
  get buffering(){return this.busy&&this.source===null;}
  pace(requested:number){return !this.enabled?requested:this.blocked||this.buffering?0:this.busy?1:requested;}

  unlock(){
    if(!this.context)this.context=new AudioContext();
    void this.context.resume().catch(()=>this.onStatus('Click Audio on to enable playback.',true));
  }
  private request(type:'load'|'speak',text='',speaker='ENGINEER',onId?:(id:number)=>void):Promise<Clip>{
    if(!this.worker){
      this.worker=new Worker(new URL('./radio-worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        if(data.type==='progress'){if(!this.ready)this.onStatus(`Downloading neural voices · ${Math.round(data.progress)}%`);return;}
        if(data.type==='ready')this.device=data.device??'wasm';
        const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);
        if(data.type==='error')p.reject(new Error(data.error));else p.resolve({audio:data.audio,rate:data.rate});
      };
      this.worker.onerror=()=>this.resetWorker('Neural voice worker failed. Try Load voices again.');
    }
    const id=++this.serial;onId?.(id);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.resetWorker('Neural voice loading or generation timed out. Try Load voices again.'),type==='load'?240000:60000);
      const prefer=type==='load'?(typeof navigator!=='undefined'&&'gpu' in navigator?'webgpu':'wasm'):undefined;
      this.pending.set(id,{resolve,reject,timer});this.worker!.postMessage({id,type,text,speaker,prefer});
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
  async connect(){
    this.unlock();
    const text='Team, radio check. Theo, Nico. Talk to us.';
    this.remember(this.key('STRATEGIST',text),await this.loadCue('james-opening'));
    this.onStatus('Team radio connected · live reports load on this device');
    // Start loading the live voices now, so the first unscripted line is not stuck behind the download.
    await this.prepare();
  }
  prepare():Promise<void>{
    this.unlock();
    if(this.ready)return Promise.resolve();
    if(!this.loading){
      this.onStatus('Loading local neural voices. First download is about 90 MB on CPU, 310 MB with a GPU.');
      this.loading=this.request('load').then(()=>{this.ready=true;this.onStatus(this.device==='webgpu'?'Neural radio ready · rendered on this device’s GPU':'Neural radio ready · CPU mode, replies may lag');}).catch(e=>{this.loading=null;this.onStatus(`Voices unavailable: ${e.message}`,true);throw e;});
    }
    return this.loading;
  }
  private key(speaker:string,text:string){return voiceProfile(speaker).voice+':'+text;}
  private remember(key:string,clip:Clip){
    this.cache.delete(key);this.cache.set(key,clip);
    if(this.cache.size>CACHE_SIZE)this.cache.delete(this.cache.keys().next().value!);
  }
  private stale(item:Item){return this.clock()-item.at>item.ttl;}
  /** Start synthesis for the items that will play soonest, first sentence first. */
  private prefetch(){
    // Only the first sentence of each upcoming turn. Rendering every sentence at once
    // queued enough work to hit timeouts before later teammates got their first word.
    for(const item of this.queue.slice(0,PREFETCH))this.renderPart(item,item.parts[0]);
  }
  private renderPart(item:Item,part:Part){
    if(part.clip)return;
    const key=this.key(item.speaker,part.text),cached=this.cache.get(key);
    if(cached){part.clip=Promise.resolve(cached);return;}
    const generation=this.generation,cue=radioCue(item.speaker,part.text);
    const render=()=>this.prepare().then(()=>{
      if(generation!==this.generation)throw new Error('cancelled');
      return this.request('speak',part.text,item.speaker,id=>{part.request=id;});
    });
    part.clip=(cue?this.loadCue(cue.file).catch(()=>render()):render()).then(clip=>{this.remember(key,clip);return clip;});
    part.clip.catch(()=>{});
  }
  private async loadCue(file:string):Promise<Clip>{
    this.unlock();const response=await fetch(`/audio/team/${file}.wav`);if(!response.ok)throw new Error('Radio clip unavailable');
    const buffer=await this.context!.decodeAudioData(await response.arrayBuffer());
    return {audio:buffer.getChannelData(0),rate:buffer.sampleRate};
  }
  private drop(items:Item[]){this.cancel(items.flatMap(i=>i.parts.flatMap(p=>p.request?[p.request]:[])));}

  /** Offer a line to the radio. */
  line(l:RadioLine){
    if(!this.enabled||this.blocked)return;
    // A pre-rendered cue covers the whole line; otherwise speak it sentence by sentence.
    const parts=(radioCue(l.speaker,l.text)?[l.text]:sentences(l.text)).map(text=>({text}));
    const item:Item={...l,parts};
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
      this.onStatus(`Preparing ${voiceProfile(item.speaker).short??item.speaker}’s radio · race clock waiting`);
      // Wait for the head's first sentence. If a more urgent line was queued meanwhile, it goes first.
      let clip=await item.parts[0].clip!;
      for(;;){
        if(generation!==this.generation||!this.enabled||this.blocked)return;
        this.drop(this.queue.filter(i=>this.stale(i)));this.queue=this.queue.filter(i=>!this.stale(i));
        const head=this.queue[0];
        if(!head)return;
        if(head===item)break;
        item=head;this.current=item;this.prefetch();clip=await item.parts[0].clip!;
      }
      this.queue.shift();this.prefetch();
      const ctx=this.context!;
      if(ctx.state!=='running')throw new Error('Audio is suspended. Toggle Audio off, then on.');
      const high=ctx.createBiquadFilter();high.type='highpass';high.frequency.value=340;
      const low=ctx.createBiquadFilter();low.type='lowpass';low.frequency.value=['LAU','REY'].includes(item.speaker)?3200:4200;
      const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-25;compressor.knee.value=12;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.12;
      const gain=ctx.createGain();gain.gain.value=.85;
      high.connect(low).connect(compressor).connect(gain).connect(ctx.destination);
      this.onAir(item.speaker,item.text);this.onStatus('Neural radio · '+voiceProfile(item.speaker).label);
      try{
        for(let i=0;i<item.parts.length;i++){
          if(i>0){this.renderPart(item,item.parts[i]);clip=await item.parts[i].clip!;}
          if(i+1<item.parts.length)this.renderPart(item,item.parts[i+1]);
          if(generation!==this.generation)return;
          const buffer=ctx.createBuffer(1,clip.audio.length,clip.rate);buffer.copyToChannel(new Float32Array(clip.audio),0);
          const source=ctx.createBufferSource();source.buffer=buffer;this.source=source;source.connect(high);
          await new Promise<void>(resolve=>{source.onended=()=>{source.disconnect();if(this.source===source)this.source=null;resolve();};source.start();});
        }
      }finally{high.disconnect();low.disconnect();compressor.disconnect();gain.disconnect();}
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
