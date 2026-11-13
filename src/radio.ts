export class RadioVoice {
  enabled = false;
  private queue: {text:string;driver:boolean}[]=[];
  private speaking=false;
  private generation=0;
  say(text:string,driver=false) {
    if(!this.enabled || !('speechSynthesis' in window)) return;
    if(driver) this.queue.unshift({text,driver}); else this.queue.push({text,driver});
    if(this.queue.length>4) this.queue.length=4;
    this.next();
  }
  interrupt() { this.generation++;this.queue=[];this.speaking=false;if('speechSynthesis' in window) speechSynthesis.cancel(); }
  private next() {
    if(this.speaking || !this.queue.length || !this.enabled) return;
    const item=this.queue.shift()!;const utterance=new SpeechSynthesisUtterance(item.text);
    const voices=speechSynthesis.getVoices().filter(v=>v.lang.startsWith('en'));
    if(voices.length) utterance.voice=voices[item.driver?Math.min(1,voices.length-1):0];
    utterance.rate=item.driver?1.08:1; utterance.pitch=item.driver?0.92:1;
    this.speaking=true; const generation=this.generation;
    const done=()=>{if(generation!==this.generation)return;this.speaking=false;this.next();};
    utterance.onend=done;utterance.onerror=done;speechSynthesis.speak(utterance);
  }
}
export interface Recognition {
  lang:string;continuous:boolean;interimResults:boolean;
  onresult:((event:{results:{[key:number]:{[key:number]:{transcript:string}}}})=>void)|null;
  onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;
  start():void;stop():void;abort():void;
}
export function recognitionConstructor(): (new()=>Recognition)|undefined {
  const w=window as unknown as {SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
  return w.SpeechRecognition??w.webkitSpeechRecognition;
}
