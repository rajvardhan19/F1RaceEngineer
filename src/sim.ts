export type Compound = 'soft' | 'medium' | 'hard';
export type Mode = 'push' | 'balanced' | 'conserve';
export type Command = { car: number; action: 'pit'; compound: Compound } | { car: number; action: 'stay' | Mode };
export interface Car {
  id: number; name: string; code: string; team: string; color: string; player: boolean;
  distance: number; pace: number; compound: Compound; age: number; wear: number; mode: Mode;
  pitOrder: Compound | null; pitRemaining: number; stops: number; lastLap: number; lapStarted: number;
  lapTimes: number[]; trust: number; finishedAt: number | null; sector: number; shownDistance: number;
}
export interface Radio { at: number; speaker: string; text: string; kind: 'info' | 'warning' | 'driver' }
export interface Race {
  seed: number; random: number; elapsed: number; tick: number; status: 'ready' | 'running' | 'paused' | 'finished';
  flag: 'green' | 'safety'; cars: Car[]; messages: Radio[]; decisions: { at: number; command: Command }[];
  safetyTriggered: boolean; safetyEnded: boolean; radioMemory: string[]; positions: Record<number, number>;
}
export const TOTAL_LAPS = 36;
export const START_LAP = 18;
export const SCENARIO_SEED = 2049;
export const TYRES: Record<Compound, { life: number; pace: number; color: string }> = {
  soft: { life: 14, pace: -0.9, color: '#ed6d73' }, medium: { life: 23, pace: 0, color: '#e9ce64' }, hard: { life: 34, pace: 0.85, color: '#d9dfdf' },
};
// Counter-based draws: a changed pit call never reshuffles another car's luck.
export function raceRandom(seed:number,car:number,event:number,channel:number) {
  let x=(seed^Math.imul(car+1,0x9e3779b1)^Math.imul(event+1,0x85ebca6b)^Math.imul(channel+1,0xc2b2ae35))>>>0;
  x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);
  return ((x^(x>>>16))>>>0)/4294967296;
}
export function message(r: Race, speaker: string, text: string, kind: Radio['kind'] = 'info') {
  r.messages.push({ at: r.elapsed, speaker, text, kind });
}
export function createRace(seed = SCENARIO_SEED): Race {
  const grid = [
    ['Luca Voss','VOS','Rosso','#ed6d73',false,0,'medium',14,0],
    ['Theo Laurent','LAU','Apex','#c4f17b',true,1,'medium',16,3.8],
    ['Oscar Vega','VEG','Papaya','#e3aa6d',false,2,'hard',9,7.2],
    ['Max Keller','KEL','Cobalt','#7997eb',false,3,'medium',13,10.6],
    ['Nico Reyes','REY','Apex','#c4f17b',true,4,'soft',10,13.1],
    ['Alex Sato','SAT','Silver','#a8bdc8',false,5,'hard',12,17.4],
    ['Daniel Costa','COS','Rosso','#ed6d73',false,6,'medium',12,23.2],
    ['Elliot Ward','WAR','Papaya','#e3aa6d',false,7,'hard',8,28.6],
    ['Gabriel Moreau','MOR','Cobalt','#7997eb',false,8,'medium',14,34.4],
    ['Finn Rossi','ROS','Silver','#a8bdc8',false,9,'hard',10,40.1],
  ] as const;
  const cars: Car[] = grid.map(([name,code,team,color,player,id,compound,age,gap]) => ({
    id,name,code,team,color,player,distance: START_LAP - gap/86,pace: 85.5 + (id%4)*0.24,
    compound,age,wear: age/TYRES[compound].life,mode:'balanced',pitOrder:null,pitRemaining:0,stops:0,
    lastLap:87.2 + id*0.16,lapStarted:-gap,lapTimes:[],trust:78,finishedAt:null,sector:Math.floor((START_LAP-gap/86)*3),shownDistance:START_LAP-gap/86,
  }));
  const r: Race = {seed,random:seed>>>0,elapsed:0,tick:0,status:'ready',flag:'green',cars,messages:[],decisions:[],safetyTriggered:false,safetyEnded:false,radioMemory:[],positions:{1:2,4:5}};
  message(r,'STRATEGIST','Eighteen laps to go. Theo is P2; Nico is P5. Protect the podium and bring both cars into the top five.');
  message(r,'TYRE SPECIALIST','Nico’s softs are nearing the cliff. A fresh medium will reach the finish.','warning');
  return r;
}
export function order(r: Race) { return [...r.cars].sort((a,b) => (a.finishedAt ?? Infinity)-(b.finishedAt ?? Infinity) || b.distance-a.distance || a.id-b.id); }
export function playerCar(r: Race, number: number) { return r.cars.find(c => c.player && c.id === (number===1 ? 1 : number===2 ? 4 : -1)); }
export function applyCommand(r: Race, command: Command, record = true): string {
  const car = playerCar(r,command.car);
  if (!car) return 'Specify car one or car two.';
  if (r.status !== 'running' && r.status !== 'paused') return 'Start the session before issuing a call.';
  if (car.finishedAt !== null) return `${car.code} has already taken the chequered flag.`;
  if (car.pitRemaining > 0 && (command.action==='pit' || command.action==='stay')) return `${car.code} is already committed to the pit lane.`;
  let reply = '';
  if (command.action==='pit') {
    if (!Object.hasOwn(TYRES,command.compound)) return 'Unknown tyre compound.';
    car.pitOrder = command.compound;
    reply = car.id===1 ? `Understood. ${command.compound}s at the end of this lap. Make sure we have the gap.` : `Box, box. ${command.compound}s. Give me a clean stop and I’ll do the rest.`;
  } else if (command.action==='stay') { car.pitOrder = null; reply = car.id===1 ? 'Understood. Staying out. I’ll keep the tyres alive.' : 'Staying out. Okay, but don’t leave me out here too long.'; }
  else if (['push','balanced','conserve'].includes(command.action)) {
    car.mode = command.action;
    reply = command.action==='push' ? (car.id===1?'Understood. I can find a little more. Watch the fronts.':'Finally. Let’s go get them.') : command.action==='conserve' ? (car.id===1?'Copy. Short shifting, looking after the rears.':'Okay, backing off. Tell me when I can fight again.') : (car.id===1?'Copy. Back to our target pace.':'Normal pace. Understood.');
  } else return 'Command not recognised.';
  if (record) r.decisions.push({at:r.elapsed,command:{...command}});
  message(r,car.code,reply,'driver');
  return reply;
}
export function lapPace(car: Car, r: Race) {
  const cliff = Math.max(0,car.wear-0.78);
  const tyrePenalty = car.wear * 1.15 + cliff*cliff*48;
  return car.pace + TYRES[car.compound].pace + tyrePenalty - (car.distance-START_LAP)*0.035 + (car.mode==='push' ? -0.8 : car.mode==='conserve' ? 1.0 : 0);
}
// One simulation second per tick. Rendering speed never changes the RNG sequence.
export function step(r: Race) {
  if (r.status !== 'running') return;
  r.elapsed++; r.tick++;
  if (r.elapsed===270) { r.flag='safety'; r.safetyTriggered=true; message(r,'RACE CONTROL','SAFETY CAR DEPLOYED. Debris at turn 9. Pit lane remains open.','warning'); }
  if (r.elapsed===420) { r.flag='green'; r.safetyEnded=true; message(r,'RACE CONTROL','Safety car in. Green flag. Racing resumes.'); }
  const sorted = order(r);
  const leaderSector = Math.floor(sorted[0].distance * 3);
  for (let i=0;i<sorted.length;i++) {
    const car = sorted[i];
    if (car.finishedAt !== null) continue;
    if (car.pitRemaining>0) { car.pitRemaining--; if(car.pitRemaining===0&&car.player)message(r,'PIT CREW',`${car.code}, go, go! Pit exit clear. Build the temperature in those ${car.compound}s.`,'driver'); continue; }
    const previous = car.distance;
    const noise = (raceRandom(r.seed,car.id,r.tick,0)-0.5)*0.4;
    let advance = 1 / (lapPace(car,r)+noise) * (r.flag==='safety' ? (i>0 && sorted[i-1].distance-car.distance>0.025 ? 0.74 : 0.58) : 1);
    const ahead=sorted[i-1];
    if (ahead && ahead.pitRemaining===0 && ahead.finishedAt===null) {
      const gap=ahead.distance-car.distance;
      if(r.flag==='safety') advance=Math.max(0,Math.min(advance,gap-0.009));
      else if(gap>0 && gap<0.016 && lapPace(car,r)>lapPace(ahead,r)-0.65) advance=Math.max(0,Math.min(advance,gap-0.006));
    }
    car.distance+=advance;
    const ageDelta = advance * (car.mode==='push' ? 1.3 : car.mode==='conserve' ? 0.73 : 1) * (r.flag==='safety' ? 0.55 : 1);
    car.age+=advance; car.wear=Math.min(1.65,car.wear+ageDelta/TYRES[car.compound].life);
    if (Math.floor(car.distance*3)>car.sector) { car.sector=Math.floor(car.distance*3); }
    if (car.distance>=TOTAL_LAPS) {
      car.finishedAt=r.elapsed-1+(TOTAL_LAPS-previous)/Math.max(advance,0.000001); car.distance=TOTAL_LAPS;
      if(car.player) message(r,car.code,car.id===1?'Chequered flag. Good work on the wall today. Let’s see where we ended up.':'That’s the flag! I gave it everything. Where did we finish?','driver');
      continue;
    }
    if(Math.floor(car.distance)>Math.floor(previous)) {
      const lapTime=r.elapsed-car.lapStarted;
      if(car.lapStarted>=0) {car.lastLap=lapTime;car.lapTimes.push(lapTime);}
      car.lapStarted=r.elapsed;
      if(!car.player && !car.pitOrder && car.wear>(r.flag==='safety' ? 0.5 : 0.89) && TOTAL_LAPS-car.distance>3) car.pitOrder='medium';
      if(car.pitOrder) {
        const slow=raceRandom(r.seed,car.id,car.stops,1)<0.09 ? 3+raceRandom(r.seed,car.id,car.stops,2)*3 : 0;
        car.pitRemaining=Math.ceil(21+slow); car.compound=car.pitOrder; car.pitOrder=null; car.age=0;car.wear=0;car.stops++;
        // A second team car arriving before the first leaves queues behind it.
        const teammate=r.cars.find(c=>c.id!==car.id && c.team===car.team && c.pitRemaining>0);
        if(teammate) car.pitRemaining+=Math.max(0,teammate.pitRemaining-17);
        message(r,car.player?car.code:'RACE CONTROL',`${car.code} pits for ${car.compound}s.${slow>0?' Slow stop at the rear.':''}`,car.player?'driver':'info');
      } else if(car.player && car.wear>0.95) message(r,car.code,'Tyres are falling away. We need to consider boxing.','warning');
    }
  }
  // Snapshot the entire field together so stale leader and fresh follower positions cannot produce false zero gaps.
  if (Math.floor(order(r)[0].distance * 3) !== leaderSector) {
    for (const car of r.cars) car.shownDistance = car.distance;
  }
  updateTeamRadio(r);
  if(r.cars.every(c=>c.finishedAt!==null)) {
    r.status='finished';
    for(const c of r.cars.filter(c=>c.player)) { const pos=order(r).findIndex(x=>x.id===c.id)+1; c.trust=Math.max(30,Math.min(100,78+((c.id===1?2:5)-pos)*3)); }
    message(r,'STRATEGIST','Session complete. The debrief is ready.');
  }
}
export function replay(seed: number, decisions: Race['decisions']) {
  const r=createRace(seed);r.status='running';let next=0;
  while(r.status==='running' && r.tick<10000) {
    while(next<decisions.length && decisions[next].at<=r.elapsed) applyCommand(r,decisions[next++].command);
    step(r);
  }
  return r;
}
export function formatTime(n: number) { return `${Math.floor(n/60)}:${(n%60).toFixed(1).padStart(4,'0')}`; }

export function pitForecast(r:Race,car:Car) {
  const loss=r.flag==='safety'?12.2:21;
  const projected=car.distance-loss/lapPace(car,r);
  const traffic=r.cars.filter(c=>c.id!==car.id&&c.finishedAt===null).sort((a,b)=>b.distance-a.distance);
  const position=1+traffic.filter(c=>c.distance>projected).length;
  const ahead=traffic.filter(c=>c.distance>projected).at(-1);
  return {loss,position,ahead:ahead?.code??'clear air',gap:ahead?Math.max(0,(ahead.distance-projected)*lapPace(car,r)):0};
}
function updateTeamRadio(r:Race) {
  const once=(key:string,speaker:string,text:string,kind:Radio['kind']='info')=>{
    if(r.radioMemory.includes(key))return;r.radioMemory.push(key);message(r,speaker,text,kind);
  };
  if(r.elapsed===12){const c=playerCar(r,1)!;message(r,'LAU',c.pitRemaining?'On the limiter. Ready when the crew is.':c.wear>.7?'Radio check. The fronts are starting to slide through turn three.':'Radio check. Balance is okay. I’m watching the tyres.','driver');}
  if(r.elapsed===34){const c=playerCar(r,2)!;message(r,'REY',c.pitRemaining?'Still on the limiter. I’m ready to get back in this fight.':'Radio check. Let’s get the strategy right. I want to fight for this.','driver');}
  if(r.elapsed===271)message(r,'STRATEGIST','This is our window. Stops cost less under the safety car. Watch the double stack.','warning');
  if(r.elapsed===405)message(r,'RACE CONTROL','Safety car in this lap. Prepare for the restart.','warning');
  if(r.elapsed===421)message(r,'REY','Green, green. Tyres are ready. Let me attack.','driver');
  if(r.elapsed%15!==0)return;
  const sorted=order(r);
  for(const car of sorted.filter(c=>c.player&&c.finishedAt===null)) {
    const position=sorted.findIndex(c=>c.id===car.id)+1;
    if(r.positions[car.id]!==position){
      const previous=r.positions[car.id];r.positions[car.id]=position;
      if(car.pitRemaining===0)message(r,'DATA ENGINEER',`${car.code}, now P${position}. ${position<previous?'Position gained.':'We’ve lost track position.'}`);
    }
    if(car.pitRemaining>0)continue;
    if(car.wear>=.78&&car.wear<.95&&!car.pitOrder)once(`${car.id}-cliff-${car.stops}`,'TYRE SPECIALIST',`${car.code} is reaching the tyre cliff. ${Math.ceil(TOTAL_LAPS-car.distance)} laps remain. We need a plan.`, 'warning');
    if(car.wear>.95)once(`${car.id}-gone-${car.stops}`,car.code,car.id===1?'Fronts are gone now. I’m losing time every corner. Recommend we box.':'These tyres are finished! I can’t fight like this. Box me.','driver');
    const remaining=Math.ceil(TOTAL_LAPS-car.distance);
    if(remaining<=5)once(`${car.id}-five`,'STRATEGIST',`${car.code}, five laps or fewer. ${position<=(car.id===1?3:5)?'We’re on target. Bring it home.':'We need to find a position. Decide how much tyre you can spend.'}`);
    const ahead=sorted[position-2];
    if(r.flag==='green'&&ahead&&r.elapsed%90===(car.id===1?0:45)) {
      const gap=(ahead.distance-car.distance)*lapPace(car,r);
      if(gap<2.5&&gap>0)message(r,car.code,car.id===1?`${ahead.code} is ${gap.toFixed(1)} ahead. I can put pressure on, but it will cost tyre life.`:`I’m right behind ${ahead.code}. ${gap.toFixed(1)} seconds. Can I push?`,'driver');
    }
  }
}
