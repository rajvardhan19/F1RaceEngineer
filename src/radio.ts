import {voiceProfile} from './radio-profile.ts';
export {voiceProfile} from './radio-profile.ts';
export interface VoiceLine {text:string;speaker:string;priority:number;expires:number}
type Clip={audio:Float32Array;rate:number};
export class RadioVoice {
  enabled=false;blocked=false;ready=false;
  onAir:(speaker:string,text:string)=>void=()=>{};onSilent:()=>void=()=>{};
  onStatus:(text:string,error?:boolean)=>void=()=>{};
  private queue:VoiceLine[]=[];private speaking=false;private generation=0;
  private worker:Worker|null=null;private serial=0;private loading:Promise<void>|null=null;
  private pending=new Map<number,{resolve:(clip:Clip)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private context:AudioContext|null=null;private source:AudioBufferSourceNode|null=null;
  private cache=new Map<string,Clip>();
  unlock(){
    if(!this.context)this.context=new AudioContext();
    void this.context.resume().catch(()=>this.onStatus('Click Audio on to enable playback.',true));
  }
  private request(type:'load'|'speak',text='',speaker='ENGINEER'):Promise<Clip>{
    if(!this.worker){
      this.worker=new Worker(new URL('./radio-worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=({data})=>{
        if(data.type==='progress'){if(!this.ready)this.onStatus(`Downloading neural voices · ${Math.round(data.progress)}%`);return;}
        const p=this.pending.get(data.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(data.id);
        if(data.type==='error')p.reject(new Error(data.error));else p.resolve({audio:data.audio,rate:data.rate});
      };
      this.worker.onerror=()=>this.resetWorker('Neural voice worker failed. Try Load voices again.');
    }
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.resetWorker('Neural voice loading or generation timed out. Try Load voices again.'),type==='load'?240000:60000);
      this.pending.set(id,{resolve,reject,timer});this.worker!.postMessage({id,type,text,speaker});
    });
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
      this.loading=this.request('load').then(()=>{this.ready=true;this.onStatus('Neural radio ready · generated on this device');}).catch(e=>{this.loading=null;this.onStatus(`Voices unavailable: ${e.message}`,true);throw e;});
    }
    return this.loading;
  }
  say(text:string,speaker='ENGINEER',urgent=false){
    if(!this.enabled||this.blocked)return;
    const priority=urgent?3:['LAU','REY'].includes(speaker)?2:1;
    this.queue.push({text,speaker,priority,expires:Date.now()+25000});this.queue.sort((a,b)=>b.priority-a.priority);this.queue=this.queue.slice(0,3);void this.next();
  }
  interrupt(){
    this.generation++;this.queue=[];this.speaking=false;
    if(this.source){this.source.stop();this.source=null;}
    // Retain the downloaded model, but never play a cancelled generation.
    this.onSilent();
  }
  private async next(){
    if(this.speaking||!this.queue.length||!this.enabled||this.blocked)return;
    this.queue=this.queue.filter(item=>item.expires>Date.now());const item=this.queue.shift();if(!item)return;
    this.speaking=true;const generation=this.generation;
    try{
      await this.prepare();
      if(generation!==this.generation||!this.enabled||this.blocked)return;
      const key=voiceProfile(item.speaker).voice+':'+item.text;
      this.onStatus('Preparing team transmission…');
      const clip=this.cache.get(key)??await this.request('speak',item.text,item.speaker);
      this.cache.set(key,clip);if(this.cache.size>24)this.cache.delete(this.cache.keys().next().value!);
      if(generation!==this.generation||!this.enabled||this.blocked||Date.now()>item.expires)return;
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
    }catch(e){if(generation===this.generation)this.onStatus(`Radio unavailable: ${e instanceof Error?e.message:String(e)}`,true);}
    finally{if(generation===this.generation){this.speaking=false;this.onSilent();void this.next();}}
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
