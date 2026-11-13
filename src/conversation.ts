// The pit-wall conversation: turns simulation events into radio lines, keeps track of
// questions the team has asked the player, remembers earlier calls, and answers in
// character. It is presentation only — every race change goes through applyCommand.
import { applyCommand, lapPace, order, pitForecast, playerCar, raceRandom, TOTAL_LAPS, TYRES } from './sim.ts';
import type { Car, Command, CommandOutcome, Compound, Race, RaceEvent } from './sim.ts';
import { normalize, parseAnswer, parseIntent } from './intent.ts';
import type { Topic } from './intent.ts';
import {
  callName, currentLap, firstName, gapAhead, gapBehind, lapsOfLife, lapsRemaining, OBJECTIVE, positionOf, seconds,
  tyreLife, tyresReachFinish,
} from './race-view.ts';
import type { BrainSpeaker } from './brain-prompt.ts';

export type Speaker = 'LAU' | 'REY' | 'STRATEGIST' | 'TYRE SPECIALIST' | 'DATA ENGINEER' | 'RACE CONTROL' | 'PIT CREW' | 'YOU' | 'RADIO';
export type LineKind = 'info' | 'warning' | 'driver' | 'you' | 'question' | 'system';
export interface Line {
  id: number; at: number; speaker: Speaker; text: string; kind: LineKind;
  /** 0 chatter · 1 info · 2 reaction · 3 needs the player now */
  priority: number;
  /** Race seconds after which the line is no longer worth saying out loud. */
  ttl: number;
  voice: boolean;
  question?: number;
}
export type QuestionKind = 'push' | 'box' | 'safety' | 'swap' | 'result';
export interface QuickReply { label: string; reply: string }
export interface Question {
  id: number; kind: QuestionKind; car: 0 | 1 | 2; speaker: Speaker; asked: number; deadline: number; askedWall: number;
  prompt: string; options: QuickReply[]; commands?: Command[];
}
export interface BrainCall { speaker: BrainSpeaker; car: 1 | 2; text: string }

const DRIVER: Record<1 | 2, 'LAU' | 'REY'> = { 1: 'LAU', 2: 'REY' };
const SPEAKER_NAME: Record<Speaker, string> = {
  LAU: 'Theo', REY: 'Nico', STRATEGIST: 'James', 'TYRE SPECIALIST': 'Maya', 'DATA ENGINEER': 'Eli',
  'RACE CONTROL': 'Race control', 'PIT CREW': 'Pit crew', YOU: 'Engineer', RADIO: 'Radio',
};
/** An engineer named at the start of a call: “James, what do you think?” */
function addressee(text: string): BrainSpeaker | null {
  const t = text.trim().toLowerCase();
  return /^(hey )?james\b/.test(t) ? 'STRATEGIST' : /^(hey )?maya\b/.test(t) ? 'TYRE SPECIALIST' : /^(hey )?eli\b/.test(t) ? 'DATA ENGINEER' : null;
}
const RESULT_WAIT_MS = 12000;

function hash(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const numberOf = (car: Car): 1 | 2 => (car.id === 1 ? 1 : 2);

/** Lines with fixed wording, worth synthesising ahead of time so replies start instantly. */
export const STOCK_LINES: { speaker: Speaker; text: string }[] = [
  { speaker: 'LAU', text: 'Copy. Holding station.' },
  { speaker: 'LAU', text: 'Say again?' },
  { speaker: 'LAU', text: 'Understood. Pushing now.' },
  { speaker: 'LAU', text: 'Copy. Staying out.' },
  { speaker: 'REY', text: 'Ugh. Okay. Holding.' },
  { speaker: 'REY', text: 'Say again? I lost you.' },
  { speaker: 'REY', text: 'Finally! Let’s go!' },
  { speaker: 'REY', text: 'Staying out, yeah.' },
  { speaker: 'STRATEGIST', text: 'Which car, Theo or Nico?' },
  { speaker: 'STRATEGIST', text: 'Copy. Both cars stay out.' },
];

export class Conversation {
  lines: Line[] = [];
  questions: Question[] = [];
  recentCar: number | undefined;
  /** Compound selected on the strategy desk; used when a call does not name one. */
  compound: (car: number) => Compound = () => 'medium';
  brainAvailable: () => boolean = () => false;
  now: () => number = () => Date.now();
  /** Count of questions asked so far; lets the host slow the race when a new one opens. */
  asked = 0;

  private clarification: {text:string;until:number}|null=null;
  private lastTopic: Topic|null=null;
  private chatSpeaker: BrainSpeaker|null=null;
  private seed: number;
  private nextId = 1;
  private cursor = 0;
  private lastOrder: number[] = [];
  private counts = new Map<string, number>();
  private done = new Set<string>();
  private started = false;
  private pitInfo = new Map<number, { slow: number; queued: number }>();
  private mem = {
    lastPushAsk: { 1: -999, 2: -999 } as Record<number, number>,
    deniedPush: { 1: -999, 2: -999 } as Record<number, number>,
    lastBoxAsk: { 1: -999, 2: -999 } as Record<number, number>,
    deniedBox: { 1: 0, 2: 0 } as Record<number, number>,
    lastPass: { 1: -999, 2: -999 } as Record<number, number>,
    lastStuck: { 1: -999, 2: -999 } as Record<number, number>,
    lastRivalPit: -999,
    rivalPitLines: 0,
    swapAsked: -999,
    swap: null as null | { yielder: 1 | 2; beneficiary: 1 | 2 },
  };

  constructor(race: Race) {
    this.seed = race.seed;
  }

  // ───────────────────────────── lines and questions ─────────────────────────────

  private pick(key: string, variants: string[]) {
    const n = this.counts.get(key) ?? 0;
    this.counts.set(key, n + 1);
    const offset = Math.floor(raceRandom(this.seed, 31, hash(key) % 100000, 7) * variants.length);
    return variants[(offset + n) % variants.length];
  }

  private once(key: string) {
    if (this.done.has(key)) return false;
    this.done.add(key);
    return true;
  }

  private say(r: Race, speaker: Speaker, text: string, o: { kind?: LineKind; priority?: number; ttl?: number; voice?: boolean; question?: number } = {}) {
    const driver = speaker === 'LAU' || speaker === 'REY';
    const line: Line = {
      id: this.nextId++, at: r.elapsed, speaker, text,
      kind: o.kind ?? (driver ? 'driver' : 'info'), priority: o.priority ?? 1, ttl: o.ttl ?? 25,
      voice: o.voice ?? (speaker !== 'YOU' && speaker !== 'RADIO'), question: o.question,
    };
    this.lines.push(line);
    return line;
  }

  /** A line from outside the conversation (voice errors, model status). Never spoken. */
  system(r: Race, text: string) {
    this.say(r, 'RADIO', text, { kind: 'system', voice: false });
  }

  private ask(r: Race, kind: QuestionKind, car: 0 | 1 | 2, speaker: Speaker, text: string, wait: number, prompt: string, options: QuickReply[], commands?: Command[]) {
    this.questions = this.questions.filter(q => !(q.kind === kind && q.car === car));
    const q: Question = { id: this.nextId++, kind, car, speaker, asked: r.elapsed, deadline: r.elapsed + wait, askedWall: this.now(), prompt, options, commands };
    this.questions.push(q);
    this.asked++;
    this.say(r, speaker, text, { kind: 'question', priority: 3, ttl: wait, question: q.id });
    return q;
  }

  private close(q: Question) {
    this.questions = this.questions.filter(x => x !== q);
  }

  private openFor(car: 1 | 2) {
    return this.questions.some(q => q.car === car || (q.kind === 'safety' && q.car === 0));
  }

  /** The question a reply most likely answers: one naming the car mentioned, else the newest. */
  focusQuestion(text = ''): Question | undefined {
    if (!this.questions.length) return undefined;
    const intent = parseIntent(text);
    const named = intent.kind === 'command' ? intent.command.car : intent.kind === 'question' || intent.kind === 'unknown' || intent.kind === 'clarify' ? intent.car : undefined;
    return named ? [...this.questions].reverse().find(q => q.car === named || q.car === 0) : this.questions.at(-1);
  }

  // ───────────────────────────── session lifecycle ─────────────────────────────

  start(r: Race) {
    if (this.started) return;
    this.started = true;
    const theo = playerCar(r, 1)!, nico = playerCar(r, 2)!;
    this.say(r, 'STRATEGIST', `Radio check, all stations. Eighteen laps to go. Theo P${positionOf(r, theo)}, Nico P${positionOf(r, nico)}. Theo stays on the podium, Nico gets into the top five. You have the wall.`, { priority: 2, ttl: 40 });
    this.say(r, 'TYRE SPECIALIST', 'Heads up: Nico’s softs are close to the cliff. A fresh set of mediums would reach the finish.', { kind: 'warning', priority: 2, ttl: 60 });
    this.done.add('cliff-2-0');
    for (const n of [1, 2] as const) this.standing[n] = positionOf(r, playerCar(r, n)!);
  }

  private standing: Record<number, number> = { 1: 0, 2: 0 };
  private lastTyreTalk: Record<number, number> = { 1: -999, 2: -999 };

  /** Announce what a position change means — however it happened (pass, rival stop, swap). */
  private settling: Record<number, { pos: number; since: number }> = { 1: { pos: 0, since: 0 }, 2: { pos: 0, since: 0 } };

  private milestones(r: Race, n: 1 | 2, car: Car) {
    const pos = positionOf(r, car), was = this.standing[n];
    // Only announce a position that has held for a few seconds (pit cycles shuffle the order).
    const s = this.settling[n];
    if (s.pos !== pos) { this.settling[n] = { pos, since: r.elapsed }; return; }
    if (!was || pos === was || r.elapsed - s.since < 8) return;
    this.standing[n] = pos;
    const name = firstName(car), target = OBJECTIVE[n];
    if (pos === 1 && this.once(`lead-${n}`)) {
      this.say(r, 'DATA ENGINEER', `${name}, you’re leading the race! P1!`, { priority: 3, ttl: 20 });
      this.say(r, DRIVER[n], n === 2 ? 'I’m leading?! Let’s go! Keep the calls coming!' : 'Leading. Understood. Let’s manage it from here.', { priority: 2, ttl: 15 });
    } else if (was > target && pos <= target) {
      this.say(r, 'DATA ENGINEER', n === 1 ? `That’s P${pos}. Theo is back on the podium.` : `P${pos}. Nico is into the top five.`, { priority: 2, ttl: 20 });
    } else if (was <= target && pos > target) {
      this.say(r, 'DATA ENGINEER', n === 1 ? `Theo drops to P${pos}. Off the podium.` : `Nico drops to P${pos}. Out of the top five.`, { kind: 'warning', priority: 2, ttl: 20 });
    } else if (n === 2 && pos === 3 && was > 3 && this.once('podium-2')) {
      this.say(r, 'DATA ENGINEER', 'Nico, that’s P3! You’re on the podium!', { priority: 2, ttl: 20 });
    }
  }

  /** Call after every simulation step. */
  observe(r: Race) {
    while (this.cursor < r.events.length) this.onEvent(r, r.events[this.cursor++]);
    this.detectPasses(r);
    if (r.status === 'running') this.periodic(r);
    this.expire(r);
  }

  /** Call every frame. Handles questions that outlive the simulation (the finish). */
  tick(r: Race) {
    if (r.status !== 'finished') return;
    for (const q of [...this.questions]) {
      if (q.kind === 'result' && this.now() - q.askedWall > RESULT_WAIT_MS) this.timeout(r, q);
      else if (q.kind !== 'result') this.close(q);
    }
    if (!this.questions.length && this.once('closing')) this.closing(r);
  }

  // ───────────────────────────── simulation events ─────────────────────────────

  private onEvent(r: Race, e: RaceEvent) {
    if (e.type === 'safety') {
      this.say(r, 'RACE CONTROL', 'Safety car deployed. Debris at turn nine. Pit lane open.', { kind: 'warning', priority: 3, ttl: 30 });
      this.safetyQuestion(r);
    } else if (e.type === 'safety-ending') {
      this.say(r, 'RACE CONTROL', 'Safety car in this lap.', { kind: 'warning', priority: 2, ttl: 20 });
      const nico = playerCar(r, 2)!, theo = playerCar(r, 1)!;
      const driver = nico.finishedAt === null && nico.pitRemaining === 0 ? nico : theo;
      if (driver.pitRemaining === 0) {
        const fresh = driver.wear < 0.35;
        this.say(r, DRIVER[numberOf(driver)], driver.id === 4
          ? (fresh ? this.pick('restart-fresh-2', ['Tyres are warm. I’m ready, let’s go!', 'Fresh rubber, restart coming. I’m going for it!']) : this.pick('restart-old-2', ['Restart on these tyres? This is going to be ugly.', 'These tyres are cold and old. Not ideal for a restart.']))
          : (fresh ? 'Ready for the restart. Tyres are in the window.' : 'Restart on old tyres. I’ll defend where I can.'), { priority: 1, ttl: 15 });
      }
    } else if (e.type === 'green') {
      this.say(r, 'RACE CONTROL', 'Green flag. Racing resumes.', { priority: 2, ttl: 10 });
      const safety = this.questions.find(q => q.kind === 'safety');
      if (safety) this.close(safety);
    } else if (e.type === 'pit') this.onPit(r, e);
    else if (e.type === 'pit-exit') this.onPitExit(r, e.car);
    else if (e.type === 'finish') this.onFinish(r, e.car, e.position);
  }

  private safetyQuestion(r: Race) {
    const cars = ([1, 2] as const).map(n => playerCar(r, n)!).filter(c => c.finishedAt === null && c.pitRemaining === 0 && !c.pitOrder);
    if (!cars.length) return;
    const worth = cars.filter(c => c.wear > 0.45 && TOTAL_LAPS - c.distance > 4);
    const advice = worth.length === 2 ? 'I’d box both, Theo first.' : worth.length === 1 ? `I’d box ${firstName(worth[0])}.` : 'Tyres are still good; staying out is fine.';
    const until = Math.min(...cars.map(c => ((Math.ceil(c.distance) - c.distance) * lapPace(c, r)) / 0.6));
    const wait = Math.round(Math.max(20, Math.min(80, until)));
    this.ask(r, 'safety', 0, 'STRATEGIST',
      `Safety car! A stop costs twelve seconds now instead of twenty-one. ${advice} ${cars.length === 2 ? 'Do we box? Both, one, or stay out?' : `Do we box ${firstName(cars[0])}?`}`,
      wait, 'Safety car: box now?',
      [
        ...(cars.length === 2 ? [{ label: 'Box both', reply: 'box both' }] : []),
        ...cars.map(c => ({ label: `Box ${firstName(c)}`, reply: `box ${firstName(c)}` })),
        { label: 'Stay out', reply: 'no, stay out' },
      ]);
  }

  private onPit(r: Race, e: Extract<RaceEvent, { type: 'pit' }>) {
    const car = r.cars.find(c => c.id === e.car)!;
    if (car.player) {
      const n = numberOf(car);
      this.pitInfo.set(car.id, { slow: e.slow, queued: e.queued });
      for (const q of [...this.questions]) if (q.car === n && (q.kind === 'box' || q.kind === 'push' || q.kind === 'swap')) this.close(q);
      if (e.queued > 0) {
        this.say(r, 'STRATEGIST', `Double stack. ${firstName(car)} has to wait ${Math.round(e.queued)} seconds behind his teammate.`, { kind: 'warning', priority: 2, ttl: 15 });
      } else if (e.slow > 0) {
        this.say(r, 'PIT CREW', this.pick('slow', ['Problem on the rear left! Hold, hold!', 'Wheel gun issue! Hold him!']), { kind: 'warning', priority: 2, ttl: 12 });
      } else {
        this.say(r, 'PIT CREW', `${cap(e.compound)}s ready. In you come.`, { priority: 0, ttl: 8 });
      }
      return;
    }
    // A rival stopping matters when he is fighting one of our cars.
    const rivalPos = positionOf(r, car);
    const ours = ([1, 2] as const).map(n => playerCar(r, n)!).filter(c => c.finishedAt === null && c.pitRemaining === 0);
    const near = ours.map(c => ({ c, d: positionOf(r, c) - rivalPos })).filter(x => Math.abs(x.d) <= 2).sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
    if (!near || r.elapsed - this.mem.lastRivalPit < 20 || (r.flag === 'safety' && this.mem.rivalPitLines >= 2)) return;
    this.mem.lastRivalPit = r.elapsed;
    this.mem.rivalPitLines++;
    const ours1 = near.c, name = firstName(ours1), rival = callName(car);
    if (near.d > 0) {
      const gap = (car.distance - ours1.distance) * lapPace(ours1, r);
      const loss = (r.flag === 'safety' ? 12.2 : 21) + e.slow;
      this.say(r, 'DATA ENGINEER', gap < loss
        ? `${rival} pits from P${rivalPos}. ${name} should come out ahead of him.`
        : `${rival} pits from P${rivalPos}. He’ll rejoin ahead of ${name}, but he’s spent his stop.`, { priority: 1, ttl: 20 });
    } else {
      this.say(r, 'DATA ENGINEER', `${rival} pits behind ${name}. Fresh ${e.compound}s. Expect him to come at us late.`, { priority: 1, ttl: 20 });
    }
  }

  private onPitExit(r: Race, id: number) {
    const car = r.cars.find(c => c.id === id)!;
    if (!car.player || car.finishedAt !== null) return;
    const info = this.pitInfo.get(id) ?? { slow: 0, queued: 0 };
    const pos = positionOf(r, car), ahead = gapAhead(r, car);
    const where = ahead ? `${callName(ahead.car)} is ${seconds(ahead.seconds)} ahead.` : 'Clear air in front.';
    const lost = info.slow + info.queued;
    this.say(r, 'DATA ENGINEER', lost > 1
      ? `Out in P${pos}. That stop cost us about ${Math.round(lost)} extra seconds. ${where}`
      : `Good stop. Rejoining P${pos}. ${where}`, { priority: 2, ttl: 20 });
    if (info.slow > 0) {
      this.say(r, DRIVER[numberOf(car)], car.id === 4
        ? this.pick('slow-exit-2', ['What happened in that stop?!', 'That was so slow! Come on!'])
        : this.pick('slow-exit-1', ['That was slow. Let’s not dwell on it.', 'Lost time there. Let’s get it back.']), { priority: 2, ttl: 15 });
    }
  }

  private onFinish(r: Race, id: number, position: number) {
    const car = r.cars.find(c => c.id === id)!;
    if (!car.player) return;
    const n = numberOf(car);
    this.questions = this.questions.filter(q => q.car !== n);
    const text = n === 2
      ? this.pick('flag-2', ['That’s the flag! I gave it everything. Where did we finish?', 'Chequered flag! Come on, tell me, where are we?'])
      : this.pick('flag-1', ['Chequered flag. Where did we end up?', 'That’s the flag. What’s the result?']);
    this.ask(r, 'result', n, DRIVER[n], text, 20, `${firstName(car)} asks for the result`, [
      { label: `Tell him: P${position}`, reply: `P${position}${position <= OBJECTIVE[n] ? ', great job' : ''}` },
    ]);
  }

  private resultReaction(r: Race, n: 1 | 2, told: boolean) {
    const car = playerCar(r, n)!;
    const pos = positionOf(r, car), hit = pos <= OBJECTIVE[n];
    if (!told) {
      this.say(r, 'DATA ENGINEER', hit ? `That’s P${pos}, ${firstName(car)}. P${pos}!` : `P${pos}, ${firstName(car)}. Sorry, mate.`, { priority: 3, ttl: 30 });
    }
    const text = n === 2
      ? pos <= 3 ? `P${pos}! Yes! What a strategy, guys, what a strategy!` : hit ? 'Top five! Get in there! Thank you, everyone!' : `P${pos}… That hurts. We had more than that today.`
      : pos === 1 ? 'We won it! Fantastic job on the wall. Fantastic.' : hit ? 'Podium. Good work today, everyone. Thank you.' : `P${pos}. Not what we wanted. We’ll learn from it.`;
    this.say(r, DRIVER[n], text, { kind: 'driver', priority: 3, ttl: 40 });
    if (r.status === 'finished' && this.once('closing') && !this.questions.some(q => q.kind === 'result')) this.closing(r);
  }

  private closing(r: Race) {
    const a = positionOf(r, playerCar(r, 1)!), b = positionOf(r, playerCar(r, 2)!);
    const hits = Number(a <= 3) + Number(b <= 5);
    this.say(r, 'STRATEGIST', hits === 2
      ? `Theo P${a}, Nico P${b}. Both targets met. Great calls today. The debrief is ready.`
      : hits === 1 ? `Theo P${a}, Nico P${b}. One target out of two. Let’s see what we could have done better in the debrief.`
        : `Theo P${a}, Nico P${b}. Tough one. The debrief will show us where it went.`, { priority: 1, ttl: 60 });
  }

  // ───────────────────────────── on-track reactions ─────────────────────────────

  private detectPasses(r: Race) {
    const now = order(r).map(c => c.id);
    const before = this.lastOrder;
    this.lastOrder = now;
    if (!before.length || r.flag === 'safety') return;
    for (const n of [1, 2] as const) {
      const car = playerCar(r, n)!;
      if (car.finishedAt !== null || car.pitRemaining > 0) continue;
      const was = before.indexOf(car.id), is = now.indexOf(car.id);
      if (was === is) continue;
      const byId = (id: number) => r.cars.find(c => c.id === id)!;
      if (is < was) {
        const passed = before.slice(is, was).map(byId).filter(c => now.indexOf(c.id) > is && c.pitRemaining === 0 && c.finishedAt === null);
        if (passed.length) this.gained(r, n, car, passed[0]);
      } else {
        const by = now.slice(was, is).map(byId).filter(c => before.indexOf(c.id) > was && c.pitRemaining === 0);
        if (by.length) this.lost(r, n, car, by[0]);
      }
    }
  }

  private gained(r: Race, n: 1 | 2, car: Car, passed: Car) {
    if (passed.player) {
      const swap = this.mem.swap;
      if (swap && swap.beneficiary === n) {
        this.mem.swap = null;
        const next = gapAhead(r, car);
        this.say(r, DRIVER[n], n === 2 ? `Thanks, Theo! ${next ? `Going after ${callName(next.car)} now.` : 'Let’s go!'}` : 'Thanks, Nico. Appreciated.', { priority: 2, ttl: 15 });
      } else {
        this.say(r, DRIVER[n], n === 2 ? 'Sorry, Theo! I’m through!' : 'Past Nico. I had the pace.', { priority: 1, ttl: 12 });
      }
      this.mem.lastPass[n] = r.elapsed;
      return;
    }
    if (r.elapsed - this.mem.lastPass[n] >= 20) {
      this.mem.lastPass[n] = r.elapsed;
      const rival = callName(passed);
      this.say(r, DRIVER[n], n === 2
        ? this.pick('pass-2', [`Got him! ${rival}’s behind!`, `Yes! Past ${rival}!`, `See you, ${rival}!`, `Move over, ${rival}! I’m through!`])
        : this.pick('pass-1', [`Past ${rival}.`, `Done. ${rival} is behind.`, `That’s ${rival} dealt with.`]), { priority: 2, ttl: 12 });
    }
  }

  private lost(r: Race, n: 1 | 2, car: Car, by: Car) {
    if (by.player) {
      if (this.mem.swap && this.mem.swap.yielder === n) return;
      this.mem.lastPass[n] = r.elapsed;
      this.say(r, DRIVER[n], n === 1 ? 'Nico’s through. Fine, he’s quicker today.' : 'Theo’s past me. Okay.', { priority: 1, ttl: 12 });
      return;
    }
    if (r.elapsed - this.mem.lastPass[n] >= 45) {
      this.mem.lastPass[n] = r.elapsed;
      const rival = callName(by);
      const fresher = by.age + 3 < car.age;
      this.say(r, DRIVER[n], n === 2
        ? this.pick('lost-2', [`${rival} got me! I had nothing on the exit!`, `No, no, no! ${rival} is through!`, `${rival} just drove past me! ${fresher ? 'His tyres are so much fresher.' : 'I need more grip!'}`])
        : this.pick('lost-1', [`${rival} is through. ${fresher ? 'He’s quicker on fresher tyres.' : 'I couldn’t hold him.'}`, `Lost a place to ${rival}.`]), { priority: 2, ttl: 12 });
    }
  }

  // ───────────────────────────── proactive calls ─────────────────────────────

  private periodic(r: Race) {
    const t = r.elapsed;
    if (t === 12) {
      const c = playerCar(r, 1)!;
      if (c.pitRemaining === 0) this.say(r, 'LAU', c.wear > 0.7 ? 'Radio check. The fronts are starting to slide through turn three.' : 'Radio check. Balance is okay. I’m watching the tyres.', { priority: 1, ttl: 20 });
    }
    if (t === 34) {
      const c = playerCar(r, 2)!, ahead = gapAhead(r, c);
      if (c.pitRemaining === 0) this.say(r, 'REY', ahead && !ahead.car.player ? `Radio check. I can see ${callName(ahead.car)}. Get the strategy right and I’ll take him.` : 'Radio check. Let’s get the strategy right. I want to fight today.', { priority: 1, ttl: 20 });
    }
    for (const n of [1, 2] as const) {
      const car = playerCar(r, n)!;
      if (car.finishedAt !== null || car.pitRemaining > 0) continue;
      this.milestones(r, n, car);
      this.tyreCalls(r, n, car);
      this.pushCalls(r, n, car);
      this.finalLaps(r, n, car);
    }
    this.swapCall(r);
  }

  private tyreCalls(r: Race, n: 1 | 2, car: Car) {
    const left = TOTAL_LAPS - car.distance, name = firstName(car);
    if (!car.pitOrder && car.wear >= 0.78 && left > 2 && this.once(`cliff-${n}-${car.stops}`) && r.elapsed - this.lastTyreTalk[n] > 90) {
      const life = Math.floor(lapsOfLife(car));
      this.say(r, 'TYRE SPECIALIST', `${name}’s ${car.compound}s are at the cliff. Maybe ${plural(life, 'lap')} before they fall away, and ${plural(Math.ceil(left), 'lap')} to go.`, { kind: 'warning', priority: 2, ttl: 30 });
    }
    if (car.mode === 'push' && car.wear > 0.85 && left > 3 && this.once(`pushwear-${n}-${car.stops}`)) {
      this.say(r, 'TYRE SPECIALIST', `${name} has been pushing and the tyres are fading. ${tyresReachFinish(car) ? 'They should still make it.' : 'They won’t make the finish at this rate.'}`, { kind: 'warning', priority: 2, ttl: 30 });
    }
    const asks = this.counts.get(`box-asks-${n}-${car.stops}`) ?? 0;
    if (!car.pitOrder && car.wear > 0.95 && left > 2 && asks < 3 && !this.openFor(n) && this.quiet(r) && r.elapsed - this.mem.lastBoxAsk[n] > 150 * Math.max(1, asks)) {
      this.mem.lastBoxAsk[n] = r.elapsed;
      this.counts.set(`box-asks-${n}-${car.stops}`, asks + 1);
      const again = this.mem.deniedBox[n] > 0;
      const compound = this.compound(n);
      const text = n === 2
        ? again ? this.pick('box-again-2', ['Still on these? I’m losing seconds every lap! Box me!', 'Please, these tyres are dead! Can we box now?']) : this.pick('box-2', ['These tyres are finished! Box me, come on!', 'I’ve got nothing left! Can we box?'])
        : again ? 'These tyres are costing us a lot of time. Box this lap?' : this.pick('box-1', ['Fronts are gone. I’m losing time in every corner. Box this lap?', 'The tyres are done. I recommend we box.']);
      this.ask(r, 'box', n, DRIVER[n], text, 40, `${name}: box for ${compound}s?`, [
        { label: `Box · ${compound}s`, reply: 'yes, box' },
        { label: 'Stay out', reply: 'no, stay out' },
      ]);
    }
  }

  /** Proactive questions wait until no other question was asked in the last few seconds. */
  private quiet(r: Race) {
    return !this.lines.some(l => l.kind === 'question' && r.elapsed - l.at < 12);
  }

  private boxRefused(r: Race, n: 1 | 2, answered = false) {
    const car = playerCar(r, n)!;
    const asks = this.counts.get(`box-asks-${n}-${car.stops}`) ?? 0;
    const text = asks >= 3
      ? (n === 2 ? 'Fine. I’ll drive these to the flag. Somehow.' : 'Understood. I’ll nurse them to the end.')
      : answered
        ? (n === 2 ? this.pick('box-no-2', ['Seriously?! Okay, okay. I’ll try.', 'Staying out on these? You’re killing me.']) : this.pick('box-no-1', ['Understood. I’ll manage them.', 'Copy. I’ll make them last.']))
        : (n === 2 ? this.pick('box-timeout-2', ['No answer? I’m a sitting duck out here!', 'Hello? Anyone? These tyres are gone!']) : this.pick('box-timeout-1', ['No call. Staying out, but it’s costing us.', 'Nothing from the wall. I’ll keep going.']));
    this.say(r, DRIVER[n], text, { priority: 2, ttl: 12 });
  }

  private pushCalls(r: Race, n: 1 | 2, car: Car) {
    if (r.flag !== 'green' || car.pitOrder || car.mode === 'push' || this.openFor(n) || !this.quiet(r)) return;
    const left = TOTAL_LAPS - car.distance, t = r.elapsed;
    if (left < 1.5 || t - this.mem.lastPushAsk[n] < (n === 2 ? 150 : 240) || t - this.mem.deniedPush[n] < 240) return;
    const pushLife = ((0.95 - car.wear) * TYRES[car.compound].life) / 1.3;
    const ahead = gapAhead(r, car);
    let text: string | null = null;
    if (car.mode === 'conserve' && left < 9 && pushLife >= left) {
      text = n === 2 ? 'I’ve saved the tyres like you asked. Can I push now?' : 'Tyres feel good. We saved enough. I can push if you want.';
    } else if (ahead && !ahead.car.player && ahead.car.pitRemaining === 0 && ahead.seconds > 0.2 && ahead.seconds < (n === 2 ? 1.5 : 1.0) && car.wear < 0.9) {
      const rival = callName(ahead.car), gap = seconds(ahead.seconds);
      text = n === 2
        ? this.pick('push-2', [`I’m right behind ${rival}. ${gap} seconds. Let me push!`, `${rival} is slow in the last sector. Can I go?`, `I’m faster than ${rival}! Can I push?`])
        : this.pick('push-1', [`${rival} is ${gap} ahead. I can attack, but it costs tyre. Your call.`, `Within a second of ${rival}. Do we go for it?`]);
    }
    if (!text) return;
    this.mem.lastPushAsk[n] = t;
    this.ask(r, 'push', n, DRIVER[n], text, 30, `${firstName(car)} wants to push`, [
      { label: 'Push', reply: 'yes, push' },
      { label: 'Hold', reply: 'no, hold' },
    ]);
  }

  private finalLaps(r: Race, n: 1 | 2, car: Car) {
    const left = lapsRemaining(car);
    if (left <= 5 && this.once(`five-${n}`)) {
      if (this.once('five-summary')) {
        const a = positionOf(r, playerCar(r, 1)!), b = positionOf(r, playerCar(r, 2)!);
        const need = [a > 3 ? `Theo needs ${plural(a - 3, 'place')} for the podium` : '', b > 5 ? `Nico needs ${plural(b - 5, 'place')} for the top five` : ''].filter(Boolean).join(', and ');
        this.say(r, 'STRATEGIST', `Five laps to go. Theo P${a}, Nico P${b}. ${need ? need + '.' : 'Both on target. Bring them home.'}`, { priority: 2, ttl: 30 });
      }
      const pos = positionOf(r, car), pushLife = ((0.95 - car.wear) * TYRES[car.compound].life) / 1.3;
      if (pos > OBJECTIVE[n] && car.mode !== 'push' && pushLife >= left - 0.5 && !this.openFor(n) && r.flag === 'green') {
        this.mem.lastPushAsk[n] = r.elapsed;
        this.ask(r, 'push', n, n === 2 ? 'REY' : 'STRATEGIST',
          n === 2 ? `Five laps. The tyres have ${tyreLife(car)}% left. Let me go for it!` : `Five to go and Theo needs a place. Tyres have ${tyreLife(car)}% left. Push to the end?`,
          30, `Push ${firstName(car)} to the end?`, [{ label: 'Push', reply: 'yes, push' }, { label: 'Hold', reply: 'no, hold' }]);
      }
    }
    if (car.distance >= TOTAL_LAPS - 1 && this.once(`last-${n}`)) {
      const ahead = gapAhead(r, car), behind = gapBehind(r, car), name = firstName(car);
      const text = ahead && ahead.seconds < 1.5 && !ahead.car.player
        ? `Last lap, ${name}. ${callName(ahead.car)} is ${seconds(ahead.seconds)} ahead. One chance.`
        : behind && behind.seconds < 1.5 && !behind.car.player
          ? `Last lap, ${name}. ${callName(behind.car)} is ${seconds(behind.seconds)} behind. Defend.`
          : `Last lap, ${name}. Bring it home.`;
      this.say(r, 'DATA ENGINEER', text, { priority: 2, ttl: 20 });
    }
  }

  private swapCall(r: Race) {
    // A team order the simulation abandoned (gap opened, timeout) no longer blocks new ones.
    if (this.mem.swap && playerCar(r, this.mem.swap.yielder)!.yieldTo === null) this.mem.swap = null;
    if (r.flag !== 'green' || r.elapsed - this.mem.swapAsked < 300 || this.mem.swap) return;
    const a = playerCar(r, 1)!, b = playerCar(r, 2)!;
    if ([a, b].some(c => c.finishedAt !== null || c.pitRemaining > 0 || c.pitOrder) || this.openFor(1) || this.openFor(2) || !this.quiet(r)) return;
    const sorted = order(r), ia = sorted.indexOf(a), ib = sorted.indexOf(b);
    if (Math.abs(ia - ib) !== 1) return;
    const [lead, follow] = ia < ib ? [a, b] : [b, a];
    const gap = (lead.distance - follow.distance) * lapPace(follow, r);
    const delta = lapPace(lead, r) - lapPace(follow, r);
    if (gap > 1.2 || delta < 0.3 || TOTAL_LAPS - follow.distance < 3) return;
    this.mem.swapAsked = r.elapsed;
    const yielder = numberOf(lead);
    const text = follow.id === 4
      ? `I’m ${seconds(delta)} a lap quicker than Theo! Let me through!`
      : `Theo is ${seconds(delta)} a lap quicker and stuck behind Nico. Do we swap them?`;
    this.ask(r, 'swap', yielder, follow.id === 4 ? 'REY' : 'STRATEGIST', text, 30, `Swap: ${firstName(lead)} lets ${firstName(follow)} through?`, [
      { label: 'Swap them', reply: 'yes, swap them' },
      { label: 'Let them race', reply: 'no, let them race' },
    ], [{ car: yielder, action: 'swap' }]);
  }

  private expire(r: Race) {
    for (const q of [...this.questions]) {
      const car = q.car ? playerCar(r, q.car)! : null;
      // Questions the race has already answered quietly close.
      if (q.kind === 'push' && car && (car.mode === 'push' || car.pitRemaining > 0)) { this.close(q); continue; }
      if (q.kind === 'box' && car && (car.pitOrder || car.pitRemaining > 0)) { this.close(q); continue; }
      if (q.kind === 'safety' && r.flag === 'green') { this.close(q); continue; }
      if (r.elapsed >= q.deadline) this.timeout(r, q);
    }
  }

  private timeout(r: Race, q: Question) {
    this.close(q);
    const n = q.car as 1 | 2;
    if (q.kind === 'push') {
      this.mem.deniedPush[n] = r.elapsed;
      if (q.speaker === 'STRATEGIST') this.say(r, 'STRATEGIST', 'No call. Theo holds his pace.', { priority: 1, ttl: 12 });
      else this.say(r, DRIVER[n], n === 2 ? this.pick('push-timeout-2', ['Hello? …Fine, I’ll hold for now.', 'Nothing? Okay, holding.']) : 'No call. I’ll keep it steady.', { priority: 1, ttl: 12 });
    } else if (q.kind === 'box') {
      this.mem.deniedBox[n]++;
      this.boxRefused(r, n);
    } else if (q.kind === 'safety') {
      const pitted = ([1, 2] as const).filter(k => { const c = playerCar(r, k)!; return c.pitOrder || c.pitRemaining > 0; });
      if (!pitted.length) this.say(r, 'STRATEGIST', 'No call. Both cars stay out. That’s a big chance gone.', { priority: 2, ttl: 15 });
    } else if (q.kind === 'swap') {
      this.say(r, 'STRATEGIST', 'No call, so they race. Keep it clean, both of you.', { priority: 1, ttl: 12 });
    } else if (q.kind === 'result') {
      this.resultReaction(r, n, false);
    }
  }

  // ───────────────────────────── the player speaks ─────────────────────────────

  /** Handle a typed or spoken call. Returns a request for the language model when nothing else fits. */
  hear(r: Race, input: string): BrainCall | null {
    const text = input.trim();
    if (!text) return null;
    this.say(r, 'YOU', text, { kind: 'you', voice: false });
    const normalized=normalize(text);
    if (/^(say again|repeat(?: that)?|what was that)$/.test(normalized)) {
      const last=[...this.lines].reverse().find(l=>l.voice&&l.speaker!=='YOU');
      if(last)this.say(r,last.speaker,last.text,{priority:2,ttl:25});
      return null;
    }
    const focus = this.focusQuestion(text);
    const clarification=this.clarification;this.clarification=null;
    const shortCar=/^(?:car (?:one|two)|theo|nico|laurent|reyes)$/.test(normalized);
    const intent = parseIntent(clarification&&this.now()<clarification.until&&shortCar ? `${text}, ${clarification.text}` : text, focus?.car || this.recentCar, this.compound);
    if(this.lastTopic&&/^(?:and |what about |how about )(?:theo|nico|car one|car two)\??$/.test(normalized)) {
      const target=parseIntent(text);const n='car' in target&&target.car?target.car:/nico|two/.test(normalized)?2:1;
      this.recentCar=n;this.answer(r,this.lastTopic,n as 1|2);return null;
    }
    if(/^(why|why is that|how come|explain that)$/.test(normalized)&&this.recentCar&&(this.lastTopic==='strategy'||this.lastTopic==='tyres')) {
      const car=playerCar(r,this.recentCar)!;
      this.say(r,'STRATEGIST',`${firstName(car)} has about ${Math.max(0,Math.floor(lapsOfLife(car)))} laps of tyre life at this pace, with ${lapsRemaining(car)} to go. ${tyresReachFinish(car)?'A stop gives away track position we do not need to lose.':'Staying out means running past the tyre cliff.'}`,{priority:2,ttl:25});return null;
    }

    if (focus?.kind === 'result' && intent.kind !== 'question') {
      this.close(focus);
      this.resultReaction(r, focus.car as 1 | 2, true);
      return null;
    }
    const answer = parseAnswer(text);
    // A refusal answers the open question (so the driver can react to it), unless it carries a pit call: “no, box now”.
    if (focus && answer === 'no' && intent.kind !== 'question' && intent.kind !== 'swap' && (intent.kind !== 'command' || (intent.command.action === 'stay' && focus.kind === 'box'))) {
      this.resolve(r, focus, 'no');
      return null;
    }
    if (intent.kind === 'command') {
      const commands = intent.cars ? intent.cars.map(car => ({ ...intent.command, car })) : [intent.command];
      if (!intent.cars) this.recentCar = intent.command.car;
      this.execute(r, commands);
      return null;
    }
    if (intent.kind === 'swap') {
      const yielder = intent.car ?? this.leadingCar(r);
      this.recentCar = yielder;
      this.execute(r, [{ car: yielder, action: 'swap' }]);
      return null;
    }
    if (focus && answer && intent.kind !== 'question') {
      this.resolve(r, focus, answer);
      return null;
    }
    if (intent.kind === 'question') {
      this.lastTopic=intent.topic;
      this.recentCar = intent.car;
      const to = addressee(text);
      const namedDriver=/\b(theo|laurent|nico|reyes|car one|car two)\b/.test(normalized);
      const speaker=to??(namedDriver?DRIVER[intent.car as 1|2]:this.chatSpeaker??DRIVER[intent.car as 1|2]);
      this.chatSpeaker=speaker;
      if ((intent.topic === 'feel' || intent.topic === 'open') && this.brainAvailable()) {
        return { speaker, car: intent.car as 1 | 2, text };
      }
      // Without the model, an open question goes to whoever was addressed, on their specialist topic.
      const topic: Topic = intent.topic !== 'open' ? intent.topic : to === 'STRATEGIST' ? 'strategy' : to === 'TYRE SPECIALIST' ? 'tyres' : to === 'DATA ENGINEER' ? 'gaps' : 'feel';
      this.answer(r, topic, intent.car as 1 | 2, intent.rival);
      return null;
    }
    if (intent.kind === 'clarify') {
      if(intent.reason==='which-car')this.clarification={text,until:this.now()+30000};
      const speaker: Speaker = intent.reason === 'dry' ? 'TYRE SPECIALIST' : intent.car ? DRIVER[intent.car as 1 | 2] : 'STRATEGIST';
      const line = intent.reason === 'which-car' ? 'Which car, Theo or Nico?'
        : intent.reason === 'one-car' ? 'One car at a time, or say “box both” for a double stack.'
        : intent.reason === 'one-compound' ? 'Which tyre? Softs, mediums or hards?'
          : intent.reason === 'dry' ? 'It’s bone dry out there. Softs, mediums or hards only.'
            : 'One thing at a time. Box, stay out, push or save?';
      this.say(r, speaker, line, { priority: 2, ttl: 15 });
      return null;
    }
    // Nothing matched.
    const car = (intent.car ?? this.recentCar) as 1 | 2 | undefined;
    if (answer && !focus) {
      this.say(r, 'STRATEGIST', 'Copy. Standing by for your next call.', { priority: 1, ttl: 10 });
      return null;
    }
    if (this.brainAvailable()) return { speaker: addressee(text) ?? (car ? DRIVER[car] : 'STRATEGIST'), car: car ?? 1, text };
    this.sayAgain(r, car);
    return null;
  }

  private sayAgain(r: Race, car?: 1 | 2, hint = true) {
    if (car) this.say(r, DRIVER[car], car === 2 ? this.pick('again-2', ['Say again? I lost you.', 'Didn’t get that. Say again?']) : this.pick('again-1', ['Say again?', 'Radio’s breaking up. Say again?']), { priority: 2, ttl: 12 });
    else this.say(r, 'STRATEGIST', 'Didn’t catch that. Which car, and what’s the call?', { priority: 2, ttl: 12 });
    if (hint) this.system(r, `Try “Nico, box for softs”, “Theo, push”, “yes” / “no” to a question, or “how are Nico’s tyres?”.${this.brainAvailable() ? '' : ' Turn on Team chat AI for free-form questions.'}`);
  }

  private leadingCar(r: Race): 1 | 2 {
    const sorted = order(r);
    return sorted.indexOf(playerCar(r, 1)!) < sorted.indexOf(playerCar(r, 2)!) ? 1 : 2;
  }

  private resolve(r: Race, q: Question, answer: 'yes' | 'no') {
    this.close(q);
    const n = q.car as 1 | 2;
    if (q.kind === 'push') {
      if (answer === 'yes') this.execute(r, [{ car: n, action: 'push' }]);
      else {
        this.mem.deniedPush[n] = r.elapsed;
        this.say(r, DRIVER[n], n === 2 ? this.pick('push-no-2', ['Ugh. Okay. Holding.', 'Fine. But I’m faster, you know.']) : this.pick('push-no-1', ['Copy. Holding station.', 'Understood. Saving it for later.']), { priority: 2, ttl: 12 });
      }
    } else if (q.kind === 'box') {
      if (answer === 'yes') this.execute(r, [{ car: n, action: 'pit', compound: this.compound(n) }]);
      else {
        this.mem.deniedBox[n]++;
        this.boxRefused(r, n, true);
      }
    } else if (q.kind === 'safety') {
      if (answer === 'yes') {
        const cars = ([1, 2] as const).filter(k => { const c = playerCar(r, k)!; return c.finishedAt === null && c.pitRemaining === 0 && !c.pitOrder; });
        this.execute(r, cars.map(car => ({ car, action: 'pit', compound: this.compound(car) } as Command)));
      } else this.say(r, 'STRATEGIST', 'Copy. Both cars stay out.', { priority: 2, ttl: 12 });
    } else if (q.kind === 'swap') {
      if (answer === 'yes') this.execute(r, q.commands ?? []);
      else this.say(r, 'STRATEGIST', 'Copy. No team orders. Let them race.', { priority: 2, ttl: 12 });
    } else if (q.kind === 'result') {
      this.resultReaction(r, n, true);
    }
  }

  // ───────────────────────────── commands ─────────────────────────────

  /** Execute calls from the radio or the dashboard buttons and acknowledge them in character. */
  execute(r: Race, commands: Command[]) {
    const results = commands.map(command => {
      const car = playerCar(r, command.car);
      const before = car ? { pitOrder: car.pitOrder, mode: car.mode, wear: car.wear } : null;
      return { command, car, before, outcome: applyCommand(r, command) };
    });
    for (const { command, outcome } of results) {
      if (outcome !== 'ok') continue;
      for (const q of [...this.questions]) {
        const related = q.car === command.car && ((q.kind === 'push' && (command.action === 'push' || command.action === 'conserve' || command.action === 'balanced')) || (q.kind === 'box' && (command.action === 'pit' || command.action === 'stay')) || (q.kind === 'swap' && command.action === 'swap'));
        if (related || (q.kind === 'safety' && (command.action === 'pit' || command.action === 'stay'))) this.close(q);
      }
      if (command.action === 'swap') this.mem.swap = { yielder: command.car as 1 | 2, beneficiary: command.car === 1 ? 2 : 1 };
    }
    if (results.length > 1) {
      const ok = results.filter(x => x.outcome === 'ok');
      const a = results[0].command;
      if (ok.length === 2 && a.action === 'pit') this.say(r, 'STRATEGIST', `Double stack. Theo first, then Nico. Crew, ${a.compound}s for Theo, ${(results[1].command as { compound: Compound }).compound}s for Nico.`, { priority: 2, ttl: 15 });
      else if (ok.length === 2) this.say(r, 'STRATEGIST', `Copy. Both cars: ${a.action === 'stay' ? 'stay out' : a.action === 'balanced' ? 'normal pace' : a.action}.`, { priority: 2, ttl: 15 });
      // Skip “too late” noise for a car that was already committed when the other one could still react.
      else for (const x of results) if (!ok.length || x.outcome === 'ok' || (x.outcome !== 'committed' && x.outcome !== 'finished')) this.acknowledge(r, x.command, x.outcome, x.before);
      return;
    }
    const x = results[0];
    if (x) this.acknowledge(r, x.command, x.outcome, x.before);
  }

  private acknowledge(r: Race, command: Command, outcome: CommandOutcome, before: { pitOrder: Compound | null; mode: Car['mode']; wear: number } | null) {
    const n = command.car as 1 | 2;
    const car = playerCar(r, n);
    if (outcome === 'not-running') { this.system(r, 'Start the session before making a call.'); return; }
    if (!car || outcome === 'no-car' || outcome === 'bad-compound' || outcome === 'unknown') { this.system(r, 'That call is not available.'); return; }
    const speaker = DRIVER[n], theo = n === 1;
    const line = (text: string, priority = 2) => this.say(r, speaker, text, { priority, ttl: 15 });
    if (outcome === 'finished') return line(theo ? 'We’re done here. I’ve taken the flag.' : 'I’ve already crossed the line!');
    if (outcome === 'committed') return line(theo ? 'Already committed to the pit lane.' : 'Too late, I’m already in the pit lane!');
    if (outcome === 'no-swap') return this.say(r, 'STRATEGIST', 'They’re not close enough to swap right now.', { priority: 2, ttl: 12 });
    const ahead = gapAhead(r, car);
    const rival = ahead && !ahead.car.player ? callName(ahead.car) : null;
    switch (command.action) {
      case 'pit': {
        const c = command.compound;
        if (before?.pitOrder === c) return line(theo ? `Already copied. ${cap(c)}s.` : `Yes, yes, ${c}s. I heard you!`);
        if (before?.pitOrder) return line(theo ? `Switching to ${c}s. Copy.` : `Change to ${c}s. Got it.`);
        if (r.flag === 'safety') return line(theo ? `Box under the safety car. Good call. ${cap(c)}s.` : `Box box under the safety car, yes! ${cap(c)}s!`);
        if ((before?.wear ?? 1) < 0.25) return line(theo ? `These are still fresh, but understood. ${cap(c)}s.` : `Again? These are new! …Okay, boxing for ${c}s.`);
        if (TOTAL_LAPS - car.distance < 2.5) return line(theo ? `Box with ${Math.ceil(TOTAL_LAPS - car.distance)} to go? Understood. ${cap(c)}s.` : `Box now? Only ${Math.ceil(TOTAL_LAPS - car.distance)} laps left… Okay, ${c}s.`);
        return line(theo ? this.pick('ack-pit-1', [`Box this lap, ${c}s. Copy.`, `Understood. ${cap(c)}s at the end of this lap.`]) : this.pick('ack-pit-2', [`Box box, ${c}s! Let’s go!`, `Copy, box this lap. ${cap(c)}s. Give me a fast one, guys!`]));
      }
      case 'stay':
        if (before?.pitOrder) return line(theo ? 'Copy. Staying out. Stop cancelled.' : 'Staying out? Okay… don’t leave me out here too long.');
        if (car.wear > 0.95) return line(theo ? 'Staying out. It’ll be slow, but understood.' : 'Staying out on these?! Okay, I’ll try.');
        return line(theo ? 'Copy. Staying out.' : 'Staying out, yeah.');
      case 'push':
        if (before?.mode === 'push') return line(theo ? 'We’re already pushing.' : 'I’m already flat out!');
        if (car.wear > 0.85) return line(theo ? 'Pushing, but these tyres won’t take much more.' : 'Pushing! The tyres are screaming, though.');
        return line(theo
          ? this.pick('ack-push-1', ['Understood. Pushing now.', rival ? `Copy. Let’s go and get ${rival}.` : 'Copy. Finding a bit more.'])
          : this.pick('ack-push-2', ['Finally! Let’s go!', rival ? `Yes! Let’s go get ${rival}!` : 'Yes! Pushing!']));
      case 'conserve':
        if (before?.mode === 'conserve') return line(theo ? 'Already managing them.' : 'I’m already saving them!');
        return line(theo ? this.pick('ack-save-1', ['Copy. Short-shifting, looking after the rears.', 'Understood. Managing the tyres.']) : this.pick('ack-save-2', ['Okay, backing off. Tell me when I can fight again.', 'Saving them. Not happy, but okay.']));
      case 'balanced':
        return line(theo ? 'Copy. Back to target pace.' : 'Normal pace. Understood.');
      case 'swap':
        return line(theo ? this.pick('ack-swap-1', ['Understood. I’ll let him through at turn ten.', 'Copy. Letting Nico by.']) : this.pick('ack-swap-2', ['What?! …Fine. Letting him through.', 'Seriously? Okay. Theo’s coming through.']));
    }
  }

  // ───────────────────────────── answers ─────────────────────────────

  private answer(r: Race, topic: Topic, n: 1 | 2, rivalName?: string) {
    const car = playerCar(r, n)!, name = firstName(car), pos = positionOf(r, car);
    const reply = (speaker: Speaker, text: string) => this.say(r, speaker, text, { priority: 2, ttl: 20 });
    if (topic === 'weather') return reply('DATA ENGINEER', 'Dry to the finish. Eighty percent confidence, no rain on the radar.');
    if (topic === 'laps') return reply('DATA ENGINEER', `${plural(TOTAL_LAPS - currentLap(r) + 1, 'lap')} to go, including this one.`);
    if (topic === 'status') {
      const a = positionOf(r, playerCar(r, 1)!), b = positionOf(r, playerCar(r, 2)!);
      return reply('STRATEGIST', `Theo P${a}, Nico P${b}. ${a <= 3 && b <= 5 ? 'Both on target right now.' : a > 3 && b > 5 ? 'Both cars are off target.' : a > 3 ? 'Theo is off the podium.' : 'Nico needs more for the top five.'}`);
    }
    if (topic === 'rival' && rivalName) {
      const rival = r.cars.find(c => !c.player && c.name.endsWith(rivalName));
      if (!rival) return reply('DATA ENGINEER', `I don’t have ${rivalName} on the timing screens.`);
      const rp = positionOf(r, rival);
      const closest = ([1, 2] as const).map(k => playerCar(r, k)!).sort((x, y) => Math.abs(positionOf(r, x) - rp) - Math.abs(positionOf(r, y) - rp))[0];
      const gap = Math.abs(rival.distance - closest.distance) * lapPace(closest, r);
      const relation = `${seconds(gap)} ${rival.distance > closest.distance ? 'ahead of' : 'behind'} ${firstName(closest)}`;
      const plan = rival.pitRemaining > 0 ? 'He’s in the pit lane now.' : rival.stops === 0 && rival.wear > 0.75 ? 'His tyres are old. Expect him to pit soon.' : rival.stops === 0 ? 'He hasn’t stopped yet.' : 'He’s already stopped.';
      return reply('DATA ENGINEER', `${callName(rival)} is P${rp} on ${Math.floor(rival.age)}-lap-old ${rival.compound}s, ${relation}. ${plan}`);
    }
    if (car.finishedAt !== null) return reply('DATA ENGINEER', `${name} has finished. P${pos}.`);
    if (topic === 'tyres') {
      this.lastTyreTalk[n] = r.elapsed;
      const left = TOTAL_LAPS - car.distance;
      const outlook = tyresReachFinish(car) ? `They’ll reach the finish${car.mode === 'push' ? ', even pushing' : car.mode === 'conserve' ? ' comfortably while he saves them' : ' at this pace'}.` : `About ${plural(Math.floor(lapsOfLife(car)), 'lap')} before they fall away, and ${plural(Math.ceil(left), 'lap')} to go.`;
      return reply('TYRE SPECIALIST', `${name}: ${car.compound}s, ${Math.floor(car.age)} laps old, ${tyreLife(car)}% left. ${outlook}`);
    }
    if (topic === 'gaps' || topic === 'position') {
      const ahead = gapAhead(r, car), behind = gapBehind(r, car);
      const target = OBJECTIVE[n];
      const goal = topic === 'position' ? (pos <= target ? ' On target.' : ` ${plural(pos - target, 'place')} off target.`) : '';
      return reply('DATA ENGINEER', `${name} is P${pos}.${goal} ${ahead ? `${callName(ahead.car)} ${seconds(ahead.seconds)} ahead` : 'Leading'}${behind ? `, ${callName(behind.car)} ${seconds(behind.seconds)} behind.` : '.'}`);
    }
    if (topic === 'strategy') {
      if (car.pitRemaining > 0) return reply('STRATEGIST', `${name} is in the pit lane now. Let’s see where he rejoins.`);
      if (car.pitOrder) return reply('STRATEGIST', `${name} boxes this lap for ${car.pitOrder}s. Say “stay out” to cancel.`);
      const f = pitForecast(r, car);
      const left = TOTAL_LAPS - car.distance;
      const compound = left <= TYRES.medium.life * 0.9 ? 'medium' : 'hard';
      if (r.flag === 'safety' && left > 3) return reply('STRATEGIST', `The safety car makes a stop cheap. I’d box ${name} for ${compound}s; he rejoins about P${f.position}. Your call.`);
      if (!tyresReachFinish(car) && left > 2) return reply('STRATEGIST', `I’d box ${name} now. ${cap(compound)}s reach the end, and he rejoins about P${f.position}${f.aheadCar ? `, behind ${callName(f.aheadCar)}` : ''}. Your call.`);
      return reply('STRATEGIST', `Stay out with ${name}. Tyres have ${tyreLife(car)}% and should reach the end. A stop now drops him to about P${f.position}.`);
    }
    // feel / open questions without the language model.
    const wear = car.wear;
    return reply(DRIVER[n], n === 2
      ? wear < 0.4 ? 'Car feels mega! Just let me use it!' : wear < 0.78 ? 'Bit of oversteer, but it’s fine. I can fight.' : 'It’s sliding everywhere! These tyres are done!'
      : wear < 0.4 ? 'Car feels good. Tyres are in the window.' : wear < 0.78 ? 'It’s okay. The rears are starting to go off a little.' : 'Struggling. The fronts are going.');
  }

  // ───────────────────────────── language model replies ─────────────────────────────

  /** Lines the model sees as context, newest last. */
  recentRadio(count = 4): string[] {
    return this.lines.filter(l => l.kind !== 'system').slice(-count).map(l => `${SPEAKER_NAME[l.speaker]}: ${l.text}`);
  }

  /** Speak a model reply. The model can only talk; calls always go through the parser and buttons. */
  brainReply(r: Race, call: BrainCall, say: string | null, error?: string) {
    if (say) { this.say(r, call.speaker, say, { priority: 2, ttl: 20 }); return; }
    this.sayAgain(r, call.speaker === 'LAU' ? 1 : call.speaker === 'REY' ? 2 : undefined, !error);
    if (error) this.system(r, `Team chat model unavailable: ${error}`);
  }
}
