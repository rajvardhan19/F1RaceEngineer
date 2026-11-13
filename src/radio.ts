export interface VoiceLine {text:string;speaker:string;priority:number;expires:number}
export function voiceProfile(speaker:string) {
  if(speaker==='LAU')return {index:0,rate:.96,pitch:.84,label:'THEO LAURENT · CAR 01'};
  if(speaker==='REY')return {index:1,rate:1.13,pitch:1.04,label:'NICO REYES · CAR 02'};
  if(speaker==='TYRE SPECIALIST')return {index:2,rate:.98,pitch:.95,label:'MAYA · TYRE SPECIALIST'};
  if(speaker==='STRATEGIST')return {index:3,rate:1.04,pitch:.82,label:'JAMES · HEAD STRATEGIST'};
  return {index:4,rate:1.03,pitch:1,label:speaker==='DATA ENGINEER'?'ELI · DATA ENGINEER':speaker};
}
export class RadioVoice {
  enabled=false;blocked=false;
  onAir:(speaker:string,text:string)=>void=()=>{};onSilent:()=>void=()=>{};
  private queue:VoiceLine[]=[];private speaking=false;private generation=0;private watchdog:ReturnType<typeof setTimeout>|null=null;
  say(text:string,speaker='ENGINEER',urgent=false) {
    if(!this.enabled||this.blocked||!('speechSynthesis'in window))return;
    const priority=urgent?3:['LAU','REY'].includes(speaker)?2:1;
    this.queue.push({text,speaker,priority,expires:Date.now()+18000});this.queue.sort((a,b)=>b.priority-a.priority);this.queue=this.queue.slice(0,4);this.next();
  }
  interrupt(){this.generation++;this.queue=[];this.speaking=false;if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;if('speechSynthesis'in window)speechSynthesis.cancel();this.onSilent();}
  private next(){
    if(this.speaking||!this.queue.length||!this.enabled||this.blocked)return;
    this.queue=this.queue.filter(item=>item.expires>Date.now());const item=this.queue.shift();if(!item)return;
    const profile=voiceProfile(item.speaker),utterance=new SpeechSynthesisUtterance(item.text);
    const voices=speechSynthesis.getVoices().filter(v=>v.lang.startsWith('en'));
    if(voices.length)utterance.voice=voices[profile.index%voices.length];utterance.rate=profile.rate;utterance.pitch=profile.pitch;utterance.volume=.85;
    this.speaking=true;const generation=this.generation;this.onAir(item.speaker,item.text);
    const done=()=>{if(generation!==this.generation)return;if(this.watchdog)clearTimeout(this.watchdog);this.watchdog=null;this.speaking=false;this.onSilent();this.next();};
    utterance.onend=done;utterance.onerror=done;
    // Some browser engines omit the terminal callback after an interrupted utterance.
    this.watchdog=setTimeout(()=>{if(generation!==this.generation)return;speechSynthesis.cancel();done();},Math.max(15000,item.text.length*110));
    speechSynthesis.speak(utterance);
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
