import type {Car} from './sim.ts';
export function driverNumber(car:Car){return car.id===1?'01':car.id===4?'02':String(car.id+11);}
export interface MapPoint {x:number;y:number}
export interface Marker {car:Car;anchor:MapPoint;point:MapPoint}
export function layoutMarkers(cars:Car[],pointAt:(fraction:number)=>MapPoint):Marker[] {
  const placed:Marker[]=[];
  // Stable car order prevents identity swapping. Displaced dots retain a tether to true position.
  for(const car of [...cars].sort((a,b)=>a.id-b.id)) {
    const anchor=pointAt(((car.distance%1)+1)%1);let point={...anchor};
    for(let attempt=0;attempt<80;attempt++){
      if(!placed.some(other=>Math.hypot(other.point.x-point.x,other.point.y-point.y)<20))break;
      const angle=attempt*2.399963229728653, radius=12+Math.floor(attempt/6)*9;
      point={x:Math.max(51,Math.min(468,anchor.x+Math.cos(angle)*radius)),y:Math.max(16,Math.min(267,anchor.y+Math.sin(angle)*radius))};
    }
    placed.push({car,anchor,point});
  }
  return placed;
}
