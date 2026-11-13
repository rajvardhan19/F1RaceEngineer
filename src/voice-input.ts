import {recognitionConstructor} from './radio.ts';
import type {Recognition} from './radio.ts';
export type VoiceState='idle'|'loading'|'requesting'|'listening'|'processing'|'error';
export type VoiceEngine='local'|'browser';
export function voiceError(code:string):string {
  const errors:Record<string,string>={
    network:'The browser speech service could not connect. Select On-device voice to bypass that service.',
    'not-allowed':'Microphone access was blocked. Allow this site in your browser’s microphone settings, then try again.',
    'service-not-allowed':'This browser blocked its speech service. Select On-device voice instead.',
    'audio-capture':'No microphone signal is available. Check your input device and close apps using it.',
    'no-speech':'No speech was detected. Click Talk, speak after the listening indicator, then click Finish.',
    NotAllowedError:'Microphone access was blocked. Allow this site and check your system microphone permissions.',
    NotFoundError:'No microphone was found. Connect an input device and try again.',
    NotReadableError:'The microphone is busy or unavailable. Check your system input device.',
    EncodingError:'This browser could not decode the recorded audio. Try Browser speech service, or open the site in another browser.',
    NotSupportedError:'This browser does not support the required audio format. Try Browser speech service or another browser.',
    'language-not-supported':'The browser does not support this recognition language. Select On-device voice.',
  };
  return errors[code]??`Voice input could not start (${code}). Try On-device voice or run the voice check.`;
}
export function hasSpeech(samples:Float32Array) {
  if(samples.length<3200)return false;
  let energy=0;for(const value of samples)energy+=value*value;
  return Math.sqrt(energy/samples.length)>0.003;
}
export interface VoiceHooks {
  state:(state:VoiceState,text:string)=>void;
  transcript:(text:string,final:boolean)=>void;
  level:(value:number)=>void;
  error:(text:string)=>void;
}
export class VoiceInput {
  engine:VoiceEngine='local';state:VoiceState='idle';ready=false;
  private hooks:VoiceHooks;private worker:Worker|null=null;
  private pending=new Map<number,{resolve:(text:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private serial=0;private generation=0;private native:Recognition|null=null;
  private stream:MediaStream|null=null;private recorder:MediaRecorder|null=null;private context:AudioContext|null=null;
  private timeout:ReturnType<typeof setTimeout>|null=null;private meter=0;
  constructor(hooks:VoiceHooks){this.hooks=hooks;}
  private setState(state:VoiceState,text:string){this.state=state;this.hooks.state(state,text);}
  private fail(error:unknown){const name=error instanceof Error?error.name:'Error';const detail=error instanceof Error?error.message:String(error);const text=name==='Error'?detail:voiceError(name);this.setState('error',text);this.hooks.error(text);}
  private request(type:'load'|'transcribe',audio?:Float32Array):Promise<string> {
    if(!this.worker) {
      this.worker=new Worker(new URL('./speech-worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=(event:MessageEvent<{id:number;type:string;progress?:number;file?:string;text?:string;error?:string}>)=>{
        const data=event.data;
        if(data.type==='progress'){if(this.state==='loading')this.hooks.state('loading',`Loading voice model · ${data.file?.includes('onnx')?'speech weights':'setup'} ${Math.round(data.progress??0)}%`);return;}
        const pending=this.pending.get(data.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(data.id);
        if(data.type==='error')pending.reject(new Error(`On-device speech could not load or run. Check your connection for the initial model download. ${data.error??''}`));
        else pending.resolve(data.text??'');
      };
      this.worker.onerror=()=>this.resetWorker('Voice worker could not start. Reload the page and run the voice check.');
    }
    const id=++this.serial;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.resetWorker('Voice processing timed out. Check your connection and try again.'),type==='load'?180000:45000);
      this.pending.set(id,{resolve,reject,timer});
      this.worker!.postMessage({id,type,audio},audio?[audio.buffer]:[]);
    });
  }
  private resetWorker(reason:string) {
    this.worker?.terminate();this.worker=null;this.ready=false;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}this.pending.clear();
  }
  async prepare() {
    if(this.ready)return;
    this.setState('loading','Downloading on-device voice. First use needs a model download; your audio stays on this device.');
    await this.request('load');this.ready=true;
  }
  async check():Promise<string|null> {
    this.cancel();const generation=this.generation;
    try {
      await this.prepare();if(generation!==this.generation)return null;
      this.setState('processing','Transcribing a built-in radio sample. Microphone is off.');
      const response=await fetch('/audio/radio-check.wav');if(!response.ok)throw new Error('The radio check sample could not load.');
      const audio=await this.decode(await response.arrayBuffer());
      const text=await this.request('transcribe',audio);if(generation!==this.generation)return null;
      this.setState('idle',`Voice check heard: “${text}” · Ready for your microphone.`);return text;
    }catch(error){if(generation===this.generation)this.fail(error);return null;}
  }
  async start() {
    if(this.state==='listening'){this.stop();return;}
    if(['loading','requesting','processing'].includes(this.state))return;
    const generation=++this.generation;
    if(this.engine==='browser'){this.startNative(generation);return;}
    try {
      await this.prepare();if(generation!==this.generation)return;
      if(typeof MediaRecorder==='undefined')throw new Error('This browser cannot record audio for on-device voice. Try Browser speech service or another browser.');
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('This browser cannot capture audio here. Open the secure site in a browser with microphone support.');
      this.setState('requesting','Allow microphone access to open the radio channel.');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;const chunks:Blob[]=[];
      this.context=new AudioContext();await this.context.resume();
      if(generation!==this.generation){this.release();return;}
      const source=this.context.createMediaStreamSource(stream),analyser=this.context.createAnalyser();analyser.fftSize=256;source.connect(analyser);
      const signal=new Float32Array(analyser.fftSize);
      const meter=()=>{analyser.getFloatTimeDomainData(signal);let energy=0;for(const v of signal)energy+=v*v;this.hooks.level(Math.min(1,Math.sqrt(energy/signal.length)*8));this.meter=requestAnimationFrame(meter);};meter();
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);this.recorder=recorder;
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onerror=()=>{if(generation===this.generation){this.cancel();this.fail(new Error('Microphone recording failed. Check your input device.'));}};
      recorder.onstop=async()=>{
        if(generation!==this.generation)return;this.release();
        this.setState('processing','Decoding your radio call on this device…');
        try {
          const audio=await this.decode(await new Blob(chunks,{type:recorder.mimeType}).arrayBuffer());
          if(generation!==this.generation)return;
          if(!hasSpeech(audio))throw new Error(voiceError('no-speech'));
          const text=await this.request('transcribe',audio);if(generation!==this.generation)return;
          if(!text||/^\[.*\]$/.test(text))throw new Error(voiceError('no-speech'));
          this.setState('idle',`Heard: “${text}”`);this.hooks.transcript(text,true);
        }catch(error){if(generation===this.generation)this.fail(error);}
      };
      recorder.start();this.setState('listening','Channel open. Speak now; click Finish when done. Max 10 seconds.');
      this.timeout=setTimeout(()=>this.stop(),10000);
    }catch(error){if(generation===this.generation){this.release();this.fail(error);}}
  }
  private startNative(generation:number) {
    const Constructor=recognitionConstructor();
    if(!Constructor){this.fail(new Error('Browser recognition is unavailable. Select On-device voice.'));return;}
    const rec=new Constructor();this.native=rec;rec.lang='en-US';rec.continuous=false;rec.interimResults=true;
    let heard=false,failed=false,finalText='';
    rec.onstart=()=>{if(generation===this.generation){this.setState('listening','Channel open. Speak your call.');this.timeout=setTimeout(()=>this.stop(),10000);}};
    rec.onresult=e=>{
      if(generation!==this.generation)return;
      let interim='';
      for(let i=e.resultIndex;i<e.results.length;i++) {
        const result=e.results[i];
        if(result.isFinal){heard=true;finalText+=result[0].transcript;rec.stop();}else interim+=result[0].transcript;
      }
      if(interim)this.hooks.transcript(interim,false);
    };
    rec.onerror=e=>{if(generation!==this.generation||e.error==='aborted')return;failed=true;this.fail(new Error(voiceError(e.error)));};
    rec.onend=()=>{if(generation!==this.generation)return;this.native=null;if(this.timeout)clearTimeout(this.timeout);this.timeout=null;if(!failed){this.setState('idle',heard?'Call received. Radio standing by.':'No transcript received. Try On-device voice.');if(heard)this.hooks.transcript(finalText,true);}};
    this.setState('requesting','Connecting to browser speech service…');
    try{rec.start();}catch(error){this.fail(error);}
  }
  stop(){if(this.timeout)clearTimeout(this.timeout);this.timeout=null;if(this.recorder?.state==='recording')this.recorder.stop();this.native?.stop();}
  cancel(){this.generation++;if(this.pending.size)this.resetWorker('Voice operation cancelled.');this.native?.abort();this.native=null;if(this.recorder?.state==='recording')this.recorder.stop();this.release();this.setState('idle','Radio standing by.');}
  private release(){if(this.timeout)clearTimeout(this.timeout);this.timeout=null;cancelAnimationFrame(this.meter);this.hooks.level(0);this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;void this.context?.close();this.context=null;this.recorder=null;}
  private async decode(buffer:ArrayBuffer){const context=new AudioContext();try{const decoded=await context.decodeAudioData(buffer);const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();return (await offline.startRendering()).getChannelData(0);}finally{await context.close();}}
}
