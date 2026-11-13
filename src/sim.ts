export type Compound = 'soft' | 'medium' | 'hard';
export type Mode = 'push' | 'balanced' | 'conserve';
// 'swap' is a team order: the addressed car lets its teammate through.
export type Command = { car: number; action: 'pit'; compound: Compound } | { car: number; action: 'stay' | Mode | 'swap' };
export type CommandOutcome = 'ok' | 'no-car' | 'not-running' | 'finished' | 'committed' | 'bad-compound' | 'no-swap' | 'unknown';
export interface Car {
  id: number; name: string; code: string; team: string; color: string; player: boolean;
  distance: number; pace: number; compound: Compound; age: number; wear: number; mode: Mode;
  pitOrder: Compound | null; pitRemaining: number; stops: number; lastLap: number; lapStarted: number;
  lapTimes: number[]; trust: number; finishedAt: number | null; sector: number; shownDistance: number;
  yieldTo: number | null; yieldUntil: number;
}
// Structured facts for the conversation layer. The simulation never writes radio prose.
export type RaceEvent =
  | { at: number; type: 'safety' | 'safety-ending' | 'green' }
  | { at: number; type: 'pit'; car: number; compound: Compound; slow: number; queued: number }
  | { at: number; type: 'pit-exit'; car: number }
  | { at: number; type: 'finish'; car: number; position: number };
export interface Race {
  seed: number; random: number; elapsed: number; tick: number; status: 'ready' | 'running' | 'paused' | 'finished';
  flag: 'green' | 'safety'; cars: Car[]; events: RaceEvent[]; decisions: { at: number; command: Command }[];
  safetyTriggered: boolean; safetyEnded: boolean;
}
export const TOTAL_LAPS = 36;
export const START_LAP = 18;
export const SCENARIO_SEED = 2049;
export const SAFETY_START = 270;
export const SAFETY_ENDING = 405;
export const SAFETY_END = 420;
export const TYRES: Record<Compound, { life: number; pace: number; color: string }> = {
  soft: { life: 14, pace: -0.9, color: '#ed6d73' }, medium: { life: 23, pace: 0, color: '#e9ce64' }, hard: { life: 34, pace: 0.85, color: '#d9dfdf' },
};
// Counter-based draws: a changed pit call never reshuffles another car's luck.
export function raceRandom(seed:number,car:number,event:number,channel:number) {
  let x=(seed^Math.imul(car+1,0x9e3779b1)^Math.imul(event+1,0x85ebca6b)^Math.imul(channel+1,0xc2b2ae35))>>>0;
  x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);
  return ((x^(x>>>16))>>>0)/4294967296;
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
    yieldTo:null,yieldUntil:0,
  }));
  return {seed,random:seed>>>0,elapsed:0,tick:0,status:'ready',flag:'green',cars,events:[],decisions:[],safetyTriggered:false,safetyEnded:false};
}
export function order(r: Race) { return [...r.cars].sort((a,b) => (a.finishedAt ?? Infinity)-(b.finishedAt ?? Infinity) || b.distance-a.distance || a.id-b.id); }
export function playerCar(r: Race, number: number) { return r.cars.find(c => c.player && c.id === (number===1 ? 1 : number===2 ? 4 : -1)); }
/** Applies a player call. Returns 'ok' or the reason it could not be carried out; never writes radio text. */
export function applyCommand(r: Race, command: Command, record = true): CommandOutcome {
  const car = playerCar(r,command.car);
  if (!car) return 'no-car';
  if (r.status !== 'running' && r.status !== 'paused') return 'not-running';
  if (car.finishedAt !== null) return 'finished';
  if (car.pitRemaining > 0 && (command.action==='pit' || command.action==='stay' || command.action==='swap')) return 'committed';
  if (command.action==='pit') {
    if (!Object.hasOwn(TYRES,command.compound)) return 'bad-compound';
    car.pitOrder = command.compound;
  } else if (command.action==='stay') car.pitOrder = null;
  else if (command.action==='push' || command.action==='balanced' || command.action==='conserve') car.mode = command.action;
  else if (command.action==='swap') {
    const mate = playerCar(r, command.car===1 ? 2 : 1)!;
    const sorted = order(r), index = sorted.indexOf(car);
    if (sorted[index+1] !== mate || mate.pitRemaining>0 || mate.finishedAt!==null || car.distance-mate.distance>0.035) return 'no-swap';
    car.yieldTo = mate.id; car.yieldUntil = r.elapsed + 90;
  } else return 'unknown';
  if (record) r.decisions.push({at:r.elapsed,command:{...command}});
  return 'ok';
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
  if (r.elapsed===SAFETY_START) { r.flag='safety'; r.safetyTriggered=true; r.events.push({at:r.elapsed,type:'safety'}); }
  if (r.elapsed===SAFETY_ENDING) r.events.push({at:r.elapsed,type:'safety-ending'});
  if (r.elapsed===SAFETY_END) { r.flag='green'; r.safetyEnded=true; r.events.push({at:r.elapsed,type:'green'}); }
  const sorted = order(r);
  const leaderSector = Math.floor(sorted[0].distance * 3);
  const finishing: Car[] = [];
  for (let i=0;i<sorted.length;i++) {
    const car = sorted[i];
    if (car.finishedAt !== null) continue;
    if (car.pitRemaining>0) { car.pitRemaining--; if(car.pitRemaining===0) r.events.push({at:r.elapsed,type:'pit-exit',car:car.id}); continue; }
    const previous = car.distance;
    const noise = (raceRandom(r.seed,car.id,r.tick,0)-0.5)*0.4;
    let advance = 1 / (lapPace(car,r)+noise) * (r.flag==='safety' ? (i>0 && sorted[i-1].distance-car.distance>0.025 ? 0.74 : 0.58) : 1);
    if (car.yieldTo !== null) {
      const mate = r.cars.find(c=>c.id===car.yieldTo)!;
      // Team order: lift until the teammate is through, or abandon it if they drop back or stop.
      if (mate.distance>car.distance || r.elapsed>car.yieldUntil || mate.pitRemaining>0 || mate.finishedAt!==null || car.distance-mate.distance>0.04) car.yieldTo=null;
      else advance *= 0.93;
    }
    const ahead=sorted[i-1];
    if (ahead && ahead.pitRemaining===0 && ahead.finishedAt===null && ahead.yieldTo!==car.id) {
      const gap=ahead.distance-car.distance;
      if(r.flag==='safety') advance=Math.max(0,Math.min(advance,gap-0.009));
      else if(gap>0 && gap<0.016 && lapPace(car,r)>lapPace(ahead,r)-0.65) advance=Math.max(0,Math.min(advance,gap-0.006));
    }
    car.distance+=advance;
    const ageDelta = advance * (car.mode==='push' ? 1.3 : car.mode==='conserve' ? 0.73 : 1) * (r.flag==='safety' ? 0.55 : 1);
    car.age+=advance; car.wear=Math.min(1.65,car.wear+ageDelta/TYRES[car.compound].life);
    if (Math.floor(car.distance*3)>car.sector) { car.sector=Math.floor(car.distance*3); }
    if (car.distance>=TOTAL_LAPS) {
      car.finishedAt=r.elapsed-1+(TOTAL_LAPS-previous)/Math.max(advance,0.000001); car.distance=TOTAL_LAPS;car.yieldTo=null;
      finishing.push(car);
      continue;
    }
    if(Math.floor(car.distance)>Math.floor(previous)) {
      const lapTime=r.elapsed-car.lapStarted;
      if(car.lapStarted>=0) {car.lastLap=lapTime;car.lapTimes.push(lapTime);}
      car.lapStarted=r.elapsed;
      if(!car.player && !car.pitOrder && car.wear>(r.flag==='safety' ? 0.5 : 0.89) && TOTAL_LAPS-car.distance>3) car.pitOrder='medium';
      if(car.pitOrder) {
        const slow=raceRandom(r.seed,car.id,car.stops,1)<0.09 ? 3+raceRandom(r.seed,car.id,car.stops,2)*3 : 0;
        car.pitRemaining=Math.ceil(21+slow); car.compound=car.pitOrder; car.pitOrder=null; car.age=0;car.wear=0;car.stops++;car.yieldTo=null;
        // A second team car arriving before the first leaves queues behind it.
        const teammate=r.cars.find(c=>c.id!==car.id && c.team===car.team && c.pitRemaining>0);
        const queued=teammate?Math.max(0,teammate.pitRemaining-17):0;
        car.pitRemaining+=queued;
        r.events.push({at:r.elapsed,type:'pit',car:car.id,compound:car.compound,slow,queued});
      }
    }
  }
  // Snapshot the entire field together so stale leader and fresh follower positions cannot produce false zero gaps.
  if (Math.floor(order(r)[0].distance * 3) !== leaderSector) {
    for (const car of r.cars) car.shownDistance = car.distance;
  }
  if (finishing.length) {
    const classified = order(r);
    for (const car of finishing) r.events.push({at:r.elapsed,type:'finish',car:car.id,position:classified.indexOf(car)+1});
  }
  if(r.cars.every(c=>c.finishedAt!==null)) {
    r.status='finished';
    for(const c of r.cars.filter(c=>c.player)) { const pos=order(r).findIndex(x=>x.id===c.id)+1; c.trust=Math.max(30,Math.min(100,78+((c.id===1?2:5)-pos)*3)); }
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
  return {loss,position,ahead:ahead?.code??'clear air',aheadCar:ahead??null,gap:ahead?Math.max(0,(ahead.distance-projected)*lapPace(car,r)):0};
}
