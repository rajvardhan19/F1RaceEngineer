// Prompt construction and output cleanup for the optional in-browser language model.
// The model only talks. It never proposes or executes race calls: in testing, small
// in-browser models mapped plain questions to the wrong command too often to be trusted.
import { playerCar, TOTAL_LAPS } from './sim.ts';
import type { Race } from './sim.ts';
import {
  callName, currentLap, firstName, gapAhead, gapBehind, lapsRemaining, OBJECTIVE, positionOf, seconds, teammate, tyreLife, tyresReachFinish,
} from './race-view.ts';

export type BrainSpeaker = 'LAU' | 'REY' | 'STRATEGIST' | 'TYRE SPECIALIST' | 'DATA ENGINEER';
export interface BrainRequest { id: number; speaker: BrainSpeaker; car: 1 | 2; text: string; facts: string[]; recent: string[] }
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const DRIVERS: BrainSpeaker[] = ['LAU', 'REY'];
const NAMES: Record<BrainSpeaker, string> = { LAU: 'Theo', REY: 'Nico', STRATEGIST: 'James', 'TYRE SPECIALIST': 'Maya', 'DATA ENGINEER': 'Eli' };
const PERSONA: Record<BrainSpeaker, string> = {
  LAU: 'You are Theo Laurent, an experienced Formula 1 driver: calm, dry and precise. You drive car 1 for the Apex team.',
  REY: 'You are Nico Reyes, a young Formula 1 driver: fast, emotional and impatient. You drive car 2 for the Apex team.',
  STRATEGIST: 'You are James, head strategist of the Apex Formula 1 team: decisive and concise.',
  'TYRE SPECIALIST': 'You are Maya, the Apex Formula 1 tyre engineer: technical and calm.',
  'DATA ENGINEER': 'You are Eli, the Apex Formula 1 data engineer: crisp and factual.',
};
// Two worked examples per voice. Each carries its own facts, so the model learns to answer
// from the fact sheet in character rather than copying a stock line.
const EXAMPLE_FACTS = [
  (you: boolean, name: string) => `${you ? 'You are' : `${name} is`} P4. Keller is 0.8 seconds ahead. Sato is 2.1 seconds behind. ${you ? 'Your' : `${name}’s`} tyres: mediums, 60% life left. They should last to the finish.`,
  (you: boolean, name: string) => `${you ? 'You are' : `${name} is`} P2. Voss is 3.0 seconds ahead. ${you ? 'Your' : `${name}’s`} tyres: hards, 30% life left. They will not last to the finish.`,
];
const EXAMPLE_REPLIES: Record<BrainSpeaker, [string, string]> = {
  LAU: ['Steady. I’m close to Keller and the mediums still have grip.', 'The tyres are fading. Voss is three seconds up the road and I can’t close that on these.'],
  REY: ['Good! I’m right behind Keller and these mediums still have grip. Let me have a go!', 'These hards are dying! Voss is three seconds ahead and I can’t catch him like this!'],
  STRATEGIST: ['Nico is right behind Keller on good tyres. We can attack.', 'Theo’s hards won’t reach the end. We need to think about a stop.'],
  'TYRE SPECIALIST': ['Mediums at sixty percent. Plenty left if he stays smooth.', 'Hards at thirty percent. They won’t reach the finish.'],
  'DATA ENGINEER': ['P4. Keller is 0.8 ahead, Sato 2.1 behind.', 'P2. Voss is 3.0 ahead. The tyres are the problem.'],
};

/** What the speaker knows right now. Drivers hear it in the second person. */
export function raceFacts(r: Race, number: 1 | 2, speaker: BrainSpeaker): string[] {
  const car = playerCar(r, number)!;
  const mate = teammate(r, number);
  const you = DRIVERS.includes(speaker);
  const who = you ? 'You are' : `${firstName(car)} is`;
  const whose = you ? 'Your' : `${firstName(car)}’s`;
  const pos = positionOf(r, car);
  const ahead = gapAhead(r, car), behind = gapBehind(r, car);
  const facts = [
    `Lap ${currentLap(r)} of ${TOTAL_LAPS}, ${lapsRemaining(car)} laps to go. ${r.flag === 'safety' ? 'The safety car is out.' : 'Green flag.'}`,
    car.finishedAt !== null ? `${who} finished in P${pos}.` : `${who} P${pos}.${ahead ? ` ${callName(ahead.car)} is ${seconds(ahead.seconds)} seconds ahead.` : ' Leading the race.'}${behind ? ` ${callName(behind.car)} is ${seconds(behind.seconds)} seconds behind.` : ''}`,
    car.pitRemaining > 0 ? `${who} in the pit lane right now.` : `${whose} tyres: ${car.compound}s, ${Math.floor(car.age)} laps old, ${tyreLife(car)}% life left. ${tyresReachFinish(car) ? 'They should last to the finish.' : 'They will not last to the finish.'}`,
    `${whose} pace mode: ${car.mode === 'balanced' ? 'normal' : car.mode}. Pit stops made: ${car.stops}.${car.pitOrder ? ` A stop for ${car.pitOrder}s is planned this lap.` : ''}`,
    `${you ? 'Your teammate' : 'Teammate'} ${firstName(mate)} is P${positionOf(r, mate)}.`,
    `${you ? 'Your target' : `${firstName(car)}’s target`}: top ${OBJECTIVE[number]}.`,
  ];
  return facts;
}

export function buildPrompt(req: BrainRequest): ChatMessage[] {
  const self = NAMES[req.speaker];
  const driver = DRIVERS.includes(req.speaker);
  const subject = req.car === 1 ? 'Theo' : 'Nico';
  const system = `${PERSONA[req.speaker]}
You are on team radio during the race. The user is ${driver ? 'your' : 'the'} race engineer.
Reply as ${self}, in the first person, in one or two short sentences (under 20 words).
Use only the facts given. Never invent numbers, names or events.`;
  const turn = (facts: string, text: string, recent: string[] = []) =>
    `Facts: ${facts}${recent.length ? `\nRecent radio: ${recent.join(' / ')}` : ''}\nEngineer: ${text}`;
  const [a1, a2] = EXAMPLE_REPLIES[req.speaker];
  return [
    { role: 'system', content: system },
    { role: 'user', content: turn(EXAMPLE_FACTS[0](driver, subject), 'How’s it going?') },
    { role: 'assistant', content: a1 },
    { role: 'user', content: turn(EXAMPLE_FACTS[1](driver, subject), 'Talk to me.') },
    { role: 'assistant', content: a2 },
    { role: 'user', content: turn(req.facts.join(' '), req.text, req.recent) },
  ];
}

/** Drop any sentence quoting a number the facts do not contain: a wrong gap on the radio is worse than none. */
export function grounded(say: string, known: string[]) {
  const numbers = new Set<string>([...(known.join(' ').match(/\d+(?:\.\d+)?/g) ?? []), '1', '2']);
  // Split at sentence ends only (punctuation then space), so decimals like 1.2 stay whole.
  const sentences = say.split(/(?<=[.!?])\s+/);
  return sentences.filter(s => (s.match(/\d+(?:\.\d+)?/g) ?? []).every(n => numbers.has(n))).join(' ').trim();
}

export function cleanReply(raw: string, req: BrainRequest): string | null {
  const self = NAMES[req.speaker];
  let say = raw.replace(/<think>[\s\S]*?<\/think>/g, '').split('\n').map(l => l.trim()).find(Boolean) ?? '';
  say = say
    .replace(/^(say|reply|answer|theo|nico|james|maya|eli)\s*:\s*/i, '')
    .replace(/^["'“”*\s]+|["'“”*\s]+$/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    // A speaker addressing themselves by name is the commonest small-model slip.
    .replace(new RegExp(`^${self}[,!.]?\\s*`), '')
    .replace(new RegExp(`,\\s*${self}(?=[.!?]|$)`, 'g'), '')
    .replace(new RegExp(`\\s${self},\\s*`, 'g'), ' ')
    .replace(/^[,!.\s]+/, '').replace(/\s+/g, ' ').trim();
  if (say.length > 170) say = say.slice(0, 170);
  // Replies cut off by the token limit end at their last complete sentence.
  if (!/[.!?]$/.test(say)) {
    const end = Math.max(...[...say.matchAll(/[.!?](?=\s)/g)].map(m => m.index!));
    if (end > 0) say = say.slice(0, end + 1);
  }
  say = grounded(say, req.facts.concat(req.recent));
  if (say.length < 2) return null;
  return say[0].toUpperCase() + say.slice(1);
}
