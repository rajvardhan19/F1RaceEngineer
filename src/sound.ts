// Procedural audio only: no third-party recordings, no looping download.
export class PitwallSound {
  private context:AudioContext|null=null;private master:GainNode|null=null;private engine:GainNode|null=null;
  private oscillators:OscillatorNode[]=[];private enabled=false;private talking=false;private running=false;
  setEnabled(enabled:boolean){this.enabled=enabled;if(enabled)this.ensure();this.mix();}
  setTalking(talking:boolean){this.talking=talking;this.mix();}
  update(running:boolean,safety:boolean,phase:number){this.running=running;if(!this.context)return;const gear=(phase*7)%1;const base=(safety?58:82)+gear*(safety?26:65);this.oscillators.forEach((o,i)=>o.frequency.setTargetAtTime(base*(i?2.01:1),this.context!.currentTime,.12));this.mix();}
  cue(kind:'open'|'close'|'alert'='open') {
    if(!this.enabled)return;this.ensure();const ctx=this.context!;
    const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.value=kind==='alert'?740:kind==='open'?1320:880;
    gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(.055,ctx.currentTime+.008);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.1);
    osc.connect(gain);gain.connect(this.master!);osc.start();osc.stop(ctx.currentTime+.12);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  private ensure(){
    if(!this.context){
      const ctx=new AudioContext();this.context=ctx;this.master=ctx.createGain();this.master.gain.value=.35;this.master.connect(ctx.destination);
      const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=480;filter.Q.value=.6;
      this.engine=ctx.createGain();this.engine.gain.value=0;filter.connect(this.engine);this.engine.connect(this.master);
      for(let i=0;i<2;i++){const osc=ctx.createOscillator();osc.type='sawtooth';osc.frequency.value=90*(i+1);osc.connect(filter);osc.start();this.oscillators.push(osc);}
      const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);const data=buffer.getChannelData(0);let previous=0;
      for(let i=0;i<data.length;i++){previous=(previous+(Math.random()*2-1)*.02)/1.02;data[i]=previous;}
      const noise=ctx.createBufferSource();noise.buffer=buffer;noise.loop=true;const air=ctx.createGain();air.gain.value=.25;noise.connect(air);air.connect(filter);noise.start();
    }
    void this.context.resume().catch(()=>{});
  }
  private mix(){if(!this.context||!this.master||!this.engine)return;this.master.gain.setTargetAtTime(this.enabled?.35:0,this.context.currentTime,.12);this.engine.gain.setTargetAtTime(this.running?(this.talking?.014:.075):0,this.context.currentTime,.18);}
}
