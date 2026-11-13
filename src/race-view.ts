// Read-only helpers that describe the race the way the pit wall talks about it.
// Shared by the conversation layer, the in-browser model's fact sheet and the UI.
import { order, playerCar, lapPace, TOTAL_LAPS, TYRES } from './sim.ts';
import type { Car, Race } from './sim.ts';

export const DRIVER = { 1: 'LAU', 2: 'REY' } as const;
export type DriverKey = (typeof DRIVER)[1 | 2];
export const OBJECTIVE: Record<1 | 2, number> = { 1: 3, 2: 5 };

export function carNumber(car: Car): 1 | 2 | 0 {
  return car.id === 1 ? 1 : car.id === 4 ? 2 : 0;
}

export function firstName(car: Car) {
  return car.name.split(' ')[0];
}

export function surname(car: Car) {
  return car.name.split(' ').slice(1).join(' ');
}

/** Our drivers by first name, everyone else by surname — how an engineer says it. */
export function callName(car: Car) {
  return car.player ? firstName(car) : surname(car);
}

export function positionOf(r: Race, car: Car) {
  return order(r).findIndex(c => c.id === car.id) + 1;
}

export function currentLap(r: Race) {
  return Math.min(TOTAL_LAPS, Math.floor(order(r)[0].distance) + 1);
}

export function lapsRemaining(car: Car) {
  return Math.max(0, Math.ceil(TOTAL_LAPS - car.distance));
}

/** Live gap in seconds to the car directly ahead on the road, or null when leading. */
export function gapAhead(r: Race, car: Car): { car: Car; seconds: number } | null {
  const sorted = order(r);
  const ahead = sorted[sorted.findIndex(c => c.id === car.id) - 1];
  if (!ahead) return null;
  return { car: ahead, seconds: Math.max(0, (ahead.distance - car.distance) * lapPace(car, r)) };
}

export function gapBehind(r: Race, car: Car): { car: Car; seconds: number } | null {
  const sorted = order(r);
  const behind = sorted[sorted.findIndex(c => c.id === car.id) + 1];
  if (!behind) return null;
  return { car: behind, seconds: Math.max(0, (car.distance - behind.distance) * lapPace(behind, r)) };
}

export function tyreLife(car: Car) {
  return Math.max(0, Math.round((1 - car.wear) * 100));
}

/** Laps before this set reaches the point where it falls away, at the current pace mode. */
export function lapsOfLife(car: Car) {
  const rate = car.mode === 'push' ? 1.3 : car.mode === 'conserve' ? 0.73 : 1;
  return Math.max(0, ((0.95 - car.wear) * TYRES[car.compound].life) / rate);
}

export function tyresReachFinish(car: Car) {
  return lapsOfLife(car) >= TOTAL_LAPS - car.distance;
}

export function seconds(n: number) {
  return n.toFixed(1);
}

export function teammate(r: Race, number: 1 | 2) {
  return playerCar(r, number === 1 ? 2 : 1)!;
}
