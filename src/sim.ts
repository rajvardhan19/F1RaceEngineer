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
  safetyTriggered: boolean; safetyEnded: boolean;
}
export const TOTAL_LAPS = 36;
export const START_LAP = 18;
export const SCENARIO_SEED = 2049;
export const TYRES: Record<Compound, { life: number; pace: number; color: string }> = {
  soft: { life: 14, pace: -0.9, color: '#ed6d73' }, medium: { life: 23, pace: 0, color: '#e9ce64' }, hard: { life: 34, pace: 0.85, color: '#d9dfdf' },
};
function random(r: Race) { r.random = (Math.imul(r.random, 1664525) + 1013904223) >>> 0; return r.random / 4294967296; }
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
  const r: Race = {seed,random:seed>>>0,elapsed:0,tick:0,status:'ready',flag:'green',cars,messages:[],decisions:[],safetyTriggered:false,safetyEnded:false};
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
    reply = `Copy. Box at the end of this lap for ${command.compound}s.`;
  } else if (command.action==='stay') { car.pitOrder = null; reply = 'Copy, staying out. Pit call cancelled.'; }
  else if (['push','balanced','conserve'].includes(command.action)) {
    car.mode = command.action;
    reply = command.action==='push' ? 'Understood. Pushing now.' : command.action==='conserve' ? 'Copy. Managing the tyres.' : 'Copy. Back to normal pace.';
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
    if (car.pitRemaining>0) { car.pitRemaining--; continue; }
    const previous = car.distance;
    const noise = (random(r)-0.5)*0.4;
    let advance = 1 / (lapPace(car,r)+noise) * (r.flag==='safety' ? 0.58 : 1);
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
      if(car.player) message(r,car.code,'Chequered flag. That’s the race. Thanks, everyone.','driver');
      continue;
    }
    if(Math.floor(car.distance)>Math.floor(previous)) {
      const lapTime=r.elapsed-car.lapStarted;
      if(car.lapStarted>=0) {car.lastLap=lapTime;car.lapTimes.push(lapTime);}
      car.lapStarted=r.elapsed;
      if(!car.player && !car.pitOrder && car.wear>(r.flag==='safety' ? 0.5 : 0.89) && TOTAL_LAPS-car.distance>3) car.pitOrder='medium';
      if(car.pitOrder) {
        const slow=random(r)<0.09 ? 3+random(r)*3 : 0;
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
