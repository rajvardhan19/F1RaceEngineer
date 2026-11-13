import {createRace,step,applyCommand,playerCar,order,replay,TOTAL_LAPS} from './sim.ts';
import type {Race,Compound,Command} from './sim.ts';
export type Schedule=Race['decisions'];
export interface Result {positions:number[];times:number[];stops:number[];points:number;objectives:number}
export interface StrategyResult {name:string;result:Result;calls:Schedule;plan:string}
export interface Alternative {index:number;car:number;action:string;direction:'earlier'|'later';originalAt:number;shiftedAt:number|null;result:Result|null;secondsGained:number|null;note:string}
export interface DebriefAnalysis {actual:Result;baseline:StrategyResult;best:StrategyResult;candidates:number;alternatives:Alternative[]}
const POINTS=[25,18,15,12,10,8,6,4,2,1];
export function summarize(r:Race):Result {
  if(r.status!=='finished')throw new Error('Analysis requires a completed race.');
  const sorted=order(r),cars=[playerCar(r,1)!,playerCar(r,2)!];
  const positions=cars.map(c=>sorted.findIndex(x=>x.id===c.id)+1);
  return {positions,times:cars.map(c=>c.finishedAt!),stops:cars.map(c=>c.stops),points:positions.reduce((sum,p)=>sum+(POINTS[p-1]??0),0),objectives:Number(positions[0]<=3)+Number(positions[1]<=5)};
}
function simulate(seed:number,policy:(r:Race)=>void):Race {
  const r=createRace(seed);r.status='running';
  while(r.status==='running'&&r.tick<10000){policy(r);step(r);}
  if(r.cars.some(car=>car.finishedAt===null))throw new Error('Replay did not finish within the simulation limit.');
  return r;
}
export function defaultStrategy(seed:number):StrategyResult {
  const r=simulate(seed,r=>{
    for(const number of [1,2]) {
      const car=playerCar(r,number)!;
      if(car.finishedAt!==null||car.pitRemaining||car.pitOrder||TOTAL_LAPS-car.distance<=3)continue;
      if(car.wear>=(r.flag==='safety'?.5:.78)) {
        applyCommand(r,{car:number,action:'pit',compound:TOTAL_LAPS-car.distance<=21?'medium':'hard'});
      }
    }
  });
  return {name:'Default engineer',result:summarize(r),calls:r.decisions,plan:'Balanced pace. Pit at 78% tyre wear, or 50% under the safety car; fit mediums to reach the finish. Stay out for the final three laps.'};
}
export function better(a:Result,b:Result) {
  // Honour the scenario objectives, then constructor points, then combined finish time.
  return a.objectives>b.objectives || a.objectives===b.objectives&&(a.points>b.points || a.points===b.points&&a.times.reduce((x,y)=>x+y,0)<b.times.reduce((x,y)=>x+y,0));
}
interface Plan {lap:number;compound:Compound}
function plannedRace(seed:number,plans:Plan[]):StrategyResult {
  const issued=new Set<number>();
  const r=simulate(seed,r=>{
    for(const number of [1,2]){
      const car=playerCar(r,number)!,plan=plans[number-1];
      if(!issued.has(number)&&car.distance>=plan.lap-1){applyCommand(r,{car:number,action:'pit',compound:plan.compound});issued.add(number);}
    }
  });
  return {name:'One-stop search',result:summarize(r),calls:r.decisions,plan:plans.map((p,i)=>`${i===0?'Theo':'Nico'}: box at end of lap ${p.lap} for ${p.compound}s`).join(' · ')+'. Balanced pace.'};
}
function commandName(command:Command) {return command.action==='pit'?`box for ${command.compound}s`:command.action==='stay'?'stay out':command.action;}
export function alternatives(seed:number,decisions:Schedule,actual:Result):Alternative[] {
  // Capture each driver's original distance vs time. A lap is a distance delta of 1,
  // not a guessed 90 seconds (important during safety cars and pit stops).
  const r=createRace(seed);r.status='running';const traces:number[][]=[[],[]];let index=0;
  const distances:number[]=[];
  while(r.status==='running'&&r.tick<10000){
    traces[0][r.elapsed]=playerCar(r,1)!.distance;traces[1][r.elapsed]=playerCar(r,2)!.distance;
    while(index<decisions.length&&decisions[index].at<=r.elapsed){distances[index]=playerCar(r,decisions[index].command.car)!.distance;applyCommand(r,decisions[index].command);index++;}
    step(r);
  }
  const output:Alternative[]=[];
  for(let i=0;i<decisions.length;i++)for(const direction of ['earlier','later'] as const){
    const call=decisions[i],target=distances[i]+(direction==='earlier'?-1:1),trace=traces[call.command.car-1];
    const outside=!Number.isFinite(target)||target<trace[0]||target>=TOTAL_LAPS;
    const shiftedAt=outside?-1:trace.findIndex(d=>d>=target);
    if(shiftedAt<0){output.push({index:i,car:call.command.car,action:commandName(call.command),direction,originalAt:call.at,shiftedAt:null,result:null,secondsGained:null,note:direction==='earlier'?'A lap earlier falls before this scenario begins.':'A lap later falls beyond this driver’s race.'});continue;}
    const shifted=decisions.map((d,j)=>({at:j===i?shiftedAt:d.at,command:{...d.command}})).sort((a,b)=>a.at-b.at);
    const alternativeRace=replay(seed,shifted),result=summarize(alternativeRace);
    const executed=alternativeRace.decisions.some(d=>d.at===shiftedAt&&JSON.stringify(d.command)===JSON.stringify(call.command));
    const crossed=decisions.some((d,j)=>j!==i&&d.command.car===call.command.car&&d.at>=Math.min(call.at,shiftedAt)&&d.at<=Math.max(call.at,shiftedAt));
    output.push({index:i,car:call.command.car,action:commandName(call.command),direction,originalAt:call.at,shiftedAt,result,secondsGained:actual.times[call.command.car-1]-result.times[call.command.car-1],note:!executed?'The shifted call could not execute in the altered race (for example, already in the pit lane).':crossed?'This shift crosses another call for this driver; their order and interaction change.':'Only this call moved. All other calls keep their original simulation times.'});
  }
  return output;
}
export function analyze(seed:number,decisions:Schedule,progress?:(done:number,total:number)=>void):DebriefAnalysis {
  const actual=summarize(replay(seed,decisions)),baseline=defaultStrategy(seed);
  let best:StrategyResult={name:'Your strategy',result:actual,calls:structuredClone(decisions),plan:'Your recorded calls.'};
  if(better(baseline.result,best.result))best=baseline;
  const plans:Plan[]=[];for(const lap of [18,19,20,21,22,23,24])for(const compound of ['soft','medium','hard'] as Compound[])plans.push({lap,compound});
  let candidates=2;const total=plans.length**2+2;
  for(const first of plans)for(const second of plans){const candidate=plannedRace(seed,[first,second]);if(better(candidate.result,best.result))best=candidate;candidates++;if(candidates%20===0)progress?.(candidates,total);}
  progress?.(total,total);
  const shifts=alternatives(seed,decisions,actual);
  for(const shift of shifts){if(!shift.result)continue;candidates++;if(better(shift.result,best.result)){
    best={name:'Call-shift search',result:shift.result,calls:decisions.map((d,i)=>({at:i===shift.index?shift.shiftedAt!:d.at,command:{...d.command}})).sort((a,b)=>a.at-b.at),plan:`Your strategy, with ${shift.car===1?'Theo':'Nico'}’s ${shift.action} call one lap ${shift.direction}. All other calls unchanged.`};
  }}
  return {actual,baseline,best,candidates,alternatives:shifts};
}
