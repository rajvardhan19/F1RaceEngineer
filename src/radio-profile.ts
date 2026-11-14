// Stable casting: every role on the radio has its own neural voice, pace, label and initials.
type Voice = 'bm_george' | 'am_puck' | 'bf_emma' | 'bm_fable' | 'am_michael' | 'am_fenrir' | 'af_nicole';
interface Profile { voice: Voice; rate: number; label: string; short: string; initials: string }
const PROFILES: Record<string, Profile> = {
  LAU: { voice: 'bm_george', rate: 1.04, label: 'THEO LAURENT · CAR 01', short: 'THEO', initials: 'TL' },
  REY: { voice: 'am_puck', rate: 1.13, label: 'NICO REYES · CAR 02', short: 'NICO', initials: 'NR' },
  'TYRE SPECIALIST': { voice: 'bf_emma', rate: 1.06, label: 'MAYA · TYRE SPECIALIST', short: 'MAYA · TYRES', initials: 'MK' },
  STRATEGIST: { voice: 'bm_fable', rate: 1.07, label: 'JAMES · HEAD STRATEGIST', short: 'JAMES · STRATEGY', initials: 'JW' },
  'DATA ENGINEER': { voice: 'am_michael', rate: 1.08, label: 'ELI · DATA ENGINEER', short: 'ELI · DATA', initials: 'EL' },
  'RACE CONTROL': { voice: 'am_fenrir', rate: 1.0, label: 'RACE CONTROL', short: 'RACE CONTROL', initials: 'RC' },
  'PIT CREW': { voice: 'af_nicole', rate: 1.12, label: 'PIT CREW · CHIEF MECHANIC', short: 'PIT CREW', initials: 'PC' },
};
export function voiceProfile(speaker: string): Profile {
  return PROFILES[speaker] ?? { voice: 'am_michael', rate: 1.08, label: speaker, short: speaker, initials: 'PW' };
}
export function spokenText(text: string) {
  return text.replace(/\bLAU\b/g, 'Theo').replace(/\bREY\b/g, 'Nico').replace(/\bP(\d+)\b/g, 'position $1').replace(/\b(\d):(\d\d)\b/g, '$1 $2').replace(/(\d+(?:\.\d+)?)s\b/g, '$1 seconds').replace(/↗|→|·/g, ',').replace(/\s+/g, ' ').trim();
}
