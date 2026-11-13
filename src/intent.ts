import type { Command, Compound } from './sim.ts';

export type Topic = 'tyres' | 'gaps' | 'weather' | 'strategy' | 'laps' | 'position' | 'status' | 'rival' | 'feel' | 'open';
export type ClarifyReason = 'which-car' | 'one-car' | 'one-action' | 'one-compound' | 'mode' | 'dry';
export type Intent =
  | { kind: 'command'; command: Command; cars?: number[] }
  | { kind: 'swap'; car?: number }
  | { kind: 'question'; topic: Topic; car: number; rival?: string }
  | { kind: 'clarify'; reason: ClarifyReason; text: string; car?: number }
  | { kind: 'unknown'; car?: number };

const RIVALS = ['voss', 'vega', 'keller', 'sato', 'costa', 'ward', 'moreau', 'rossi'];

/** Lower-case, strip punctuation and repair common speech-recognition slips for radio vocabulary. */
export function normalize(input: string) {
  return input.toLowerCase()
    .replace(/[’']s\b/g, '').replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\bcard\b/g, 'car')
    .replace(/(?<!the )\bcar (?:ii|two|too|to|2|number two|number 2)\b/g, 'car two')
    .replace(/(?<!the )\bcar (?:i|one|won|1|number one|number 1)\b/g, 'car one')
    .replace(/\b(?:nicko|nikko|niko|nick|nicky|nicholas)\b/g, 'nico')
    .replace(/\b(?:reyez|rayes|reyes)\b/g, 'reyes')
    .replace(/\b(?:teo|thea|theyo)\b/g, 'theo')
    .replace(/\b(?:lauren|laurant|lorent|lauran)\b/g, 'laurent')
    .replace(/\b(?:mediums?|yellows?)\b/g, m => (m.startsWith('y') ? 'medium' : m))
    .replace(/\b(?:reds?)\b/g, 'soft')
    .replace(/\b(?:whites?)\b/g, 'hard');
}

const QUESTION_START = /^(why|explain|how|what|whats|which|should|shall|can|could|when|where|who|whos|is|are|do(?! not)|does|did|will|would|tell me|status|any|update|recommend)\b/;
// “Can you box this lap?” is a polite order on the radio, not a question.
const POLITE_ORDER = /^(can|could|will|would) you (box|pit|push|attack|stay|save|conserve|manage|come in|let)\b/;

export function parseAnswer(input: string): 'yes' | 'no' | null {
  const t = normalize(input);
  if (/\bno problem\b/.test(t)) return 'yes';
  const no = /\b(no|nope|nah|negative|not yet|not now|hold|wait|stay|keep (?:\w+ )?out|dont|do not|never|cancel|abort|wrong)\b/.test(t);
  const yes = /\b(yes|yeah|yep|yup|yea|affirm|affirmative|copy|copy that|correct|go|go go|go for it|do it|send it|ok|okay|sure|granted|green light|absolutely|of course|confirm|confirmed|agreed|fine|alright|all right|please|go ahead|lets do it|why not|definitely|understood|roger|got it)\b/.test(t);
  if (yes && !no) return 'yes';
  if (no && !yes) return 'no';
  return null;
}

export function parseIntent(input: string, recentCar?: number, defaultCompound: (car: number) => Compound = () => 'medium'): Intent {
  const text = normalize(input);
  const asked = input.trim().endsWith('?');
  const one = /\b(car one|theo|laurent)\b/.test(text), two = /\b(car two|nico|reyes)\b/.test(text);
  // Double stacks need explicit wording; “car one and car two box” stays ambiguous by design.
  const both = /\b(both|both cars|double stack|the two of them)\b/.test(text);

  const address = text.replace(/^(?:(?:car one|car two|theo|nico|laurent|reyes|james|maya|eli|guys|team|mate|buddy|ok|okay)\s*)+/, '');
  const query = !POLITE_ORDER.test(address) && (asked || QUESTION_START.test(address));

  // Team orders name both drivers by design: “Theo, let Nico through”.
  const swap = /\b(let (?:\w+ )?(?:through|by|past|pass|go)|swap (?:them|the cars|positions|places)?|team orders?|move over|give (?:\w+ )?the (?:place|position)|switch (?:the )?(?:cars|positions))\b/.test(text);
  if (swap && /\b(dont|do not|never|not)\b/.test(text)) return {kind:'unknown',car:recentCar};
  if (swap && query) return {kind:'question',topic:'strategy',car:one?1:two?2:recentCar??1};
  if (swap) {
    const beneficiary = text.match(/\blet (theo|nico|laurent|reyes)\b|\bgive (theo|nico|laurent|reyes)\b/);
    if (beneficiary) return { kind: 'swap', car: /theo|laurent/.test(beneficiary[1] ?? beneficiary[2]) ? 2 : 1 };
    if (one !== two) return { kind: 'swap', car: one ? 1 : 2 };
    return { kind: 'swap' };
  }

  if (one && two && !both) return { kind: 'clarify', reason: 'one-car', text: 'One car at a time. Do you mean car one or car two?' };
  const car = one ? 1 : two ? 2 : recentCar;

  if (/\b(weather|rain|forecast)\b/.test(text)) return { kind: 'question', topic: 'weather', car: car ?? 1 };
  if (/\b(inter|inters|intermediates?|wets?|full wets?)\b/.test(text)) return { kind: 'clarify', reason: 'dry', text: 'It’s dry. Softs, mediums or hards only.', car };

  const rival = RIVALS.find(name => new RegExp(`\\b${name}\\b`).test(text));
  if (query) {
    if (rival) return { kind: 'question', topic: 'rival', car: car ?? 1, rival: rival[0].toUpperCase() + rival.slice(1) };
    if (/\b(laps?) (left|remaining|to go)\b|\bhow many laps\b/.test(text)) return { kind: 'question', topic: 'laps', car: car ?? 1 };
    if (/\b(how are we|hows it looking|how is it looking|how we looking|overall|update|status|where are we)\b/.test(text)) return { kind: 'question', topic: 'status', car: car ?? 1 };
    if (!car) return { kind: 'clarify', reason: 'which-car', text: 'Which car: car one (Theo) or car two (Nico)?' };
    if (/\b(gap|gaps|ahead|behind|in front)\b/.test(text)) return { kind: 'question', topic: 'gaps', car };
    if (/\b(position|place|where)\b/.test(text)) return { kind: 'question', topic: 'position', car };
    if (/\b(strategy|pit|box|stop|plan|undercut|overcut)\b/.test(text)) return { kind: 'question', topic: 'strategy', car };
    if (/\b(tyre|tyres|tire|tires|soft|medium|hard|wear|grip|rubber)\b/.test(text)) return { kind: 'question', topic: 'tyres', car };
    if (/\b(feel|feeling|balance|handling|how is the car|hows the car|how are you|you ok|you okay|you alright|car going|hows it going)\b/.test(text)) return { kind: 'question', topic: 'feel', car };
    return { kind: 'question', topic: 'open', car };
  }

  const cars = both ? [1, 2] : undefined;
  if (!car && !cars) {
    if (/\b(box|pit|stay out|push|attack|conserve|save|manage|balanced|normal)\b/.test(text)) return { kind: 'clarify', reason: 'which-car', text: 'Which car: car one (Theo) or car two (Nico)?' };
    return { kind: 'unknown' };
  }
  const target = car ?? 1;
  const command = (c: Command): Intent => cars ? { kind: 'command', command: { ...c, car: 1 }, cars } : { kind: 'command', command: c };

  // Negation only binds to the order right after it: “not now, box next lap” still boxes.
  const negPit = /\b(dont|do not|never|no|not)\s+(pit|box)\b/.test(text);
  const negPush = /\b(dont|do not|no|not)\s+(push|attack)\b|\bstop (pushing|attacking)\b/.test(text);
  const negSave = /\b(dont|do not|no|not)\s+(conserve|save|manage)\b|\bstop (saving|conserving|managing)\b/.test(text);
  if (negPit) return command({ car: target, action: 'stay' });
  if (negPush || negSave) return command({ car: target, action: 'balanced' });

  const stay = /\b(stay out|cancel (?:the )?(?:pit|box|stop)|keep (?:\w+ )?out|abort (?:the )?(?:stop|pit|box))\b/.test(text);
  const pit = !stay && /\b(box|pit|come in|bring (?:\w+ )?in|in this lap|stop this lap)\b/.test(text);
  const push = /\b(push|attack|flat out|maximum attack|full attack|go get|chase|overtake|pass him)\b/.test(text);
  const conserve = /\b(conserve|save|manage|lift and coast|look after|nurse|ease off|back off|slow down|take it easy)\b/.test(text);
  const balanced = /\b(balanced|normal|standard|target pace|regular pace|back to normal)\b/.test(text);
  if ([stay, pit, push, conserve, balanced].filter(Boolean).length > 1) {
    return { kind: 'clarify', reason: 'one-action', text: 'Give one instruction at a time: box, stay out, push, or conserve.', car };
  }
  if (stay) return command({ car: target, action: 'stay' });
  if (pit) {
    const compounds = (['soft', 'medium', 'hard'] as Compound[]).filter(c => new RegExp(`\\b${c}s?\\b`).test(text));
    if (compounds.length > 1) return { kind: 'clarify', reason: 'one-compound', text: 'Choose one compound: soft, medium, or hard.', car };
    return command({ car: target, action: 'pit', compound: compounds[0] ?? defaultCompound(target) });
  }
  if (push || conserve || balanced) return command({ car: target, action: push ? 'push' : conserve ? 'conserve' : 'balanced' });
  if (/\b(tyres?|tires?)\b/.test(text)) return { kind: 'question', topic: 'tyres', car: target };
  if (/\b(gaps?)\b/.test(text)) return { kind: 'question', topic: 'gaps', car: target };
  if (/\b(strategy|plan)\b/.test(text)) return { kind: 'question', topic: 'strategy', car: target };
  return { kind: 'unknown', car };
}
