export function voiceProfile(speaker:string) {
  if(speaker==='LAU')return {voice:'bm_george' as const,rate:1.04,label:'THEO LAURENT · CAR 01'};
  if(speaker==='REY')return {voice:'am_puck' as const,rate:1.13,label:'NICO REYES · CAR 02'};
  if(speaker==='TYRE SPECIALIST')return {voice:'bf_emma' as const,rate:1.06,label:'MAYA · TYRE SPECIALIST'};
  if(speaker==='STRATEGIST')return {voice:'bm_fable' as const,rate:1.07,label:'JAMES · HEAD STRATEGIST'};
  return {voice:'am_michael' as const,rate:1.08,label:speaker==='DATA ENGINEER'?'ELI · DATA ENGINEER':speaker};
}
export function spokenText(text:string){
  return text.replace(/\bLAU\b/g,'Theo').replace(/\bREY\b/g,'Nico').replace(/\bP(\d+)\b/g,'position $1').replace(/(\d+(?:\.\d+)?)s\b/g,'$1 seconds').replace(/↗|→|·/g,',').replace(/\s+/g,' ').trim();
}
