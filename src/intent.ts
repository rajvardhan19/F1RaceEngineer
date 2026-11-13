import type { Command, Compound } from './sim.ts';
export type Intent = {kind:'command';command:Command} | {kind:'question';topic:'tyres'|'gaps'|'weather'|'strategy';car:number} | {kind:'clarify';text:string};
export function parseIntent(input: string, recentCar?: number): Intent {
  const text=input.toLowerCase().replace(/[’']s\b/g,'').replace(/[’']/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
  const one=/\b(car (one|1)|theo|laurent)\b/.test(text), two=/\b(car (two|2)|nico|reyes)\b/.test(text);
  if(one&&two) return {kind:'clarify',text:'One car at a time. Do you mean car one or car two?'};
  const car=one?1:two?2:recentCar;
  if(/\b(weather|rain|forecast)\b/.test(text)) return {kind:'question',topic:'weather',car:car??1};
  if(!car) return {kind:'clarify',text:'Which car: car one (Theo) or car two (Nico)?'};
  const query=/\b(how|what|should|can|when|tell|status|recommend)\b/.test(text);
  if(query) {
    if(/\b(gap|gaps|ahead|behind|position)\b/.test(text)) return {kind:'question',topic:'gaps',car};
    if(/\b(strategy|pit|box|stop|plan)\b/.test(text)) return {kind:'question',topic:'strategy',car};
    if(/\b(tyre|tyres|tire|tires|soft|medium|hard|wear)\b/.test(text)) return {kind:'question',topic:'tyres',car};
    return {kind:'clarify',text:'Ask about tyres, gaps, weather, or strategy.'};
  }
  if(/\b(dont|do not|never|not)\b/.test(text)) {
    if(/\b(pit|box)\b/.test(text)) return {kind:'command',command:{car,action:'stay'}};
    return {kind:'clarify',text:'Please state the desired mode: push, conserve, or balanced.'};
  }
  const stay=/\b(stay out|cancel pit|cancel box)\b/.test(text);
  const pit=/\b(box|pit)\b/.test(text)&&!stay;
  const push=/\b(push|attack)\b/.test(text);
  const conserve=/\b(conserve|save|manage)\b/.test(text);
  const balanced=/\b(balanced|normal|standard)\b/.test(text);
  if([stay,pit,push,conserve,balanced].filter(Boolean).length>1) return {kind:'clarify',text:'Give one instruction at a time: box, stay out, push, or conserve.'};
  if(stay) return {kind:'command',command:{car,action:'stay'}};
  if(pit) {
    const compounds=(['soft','medium','hard'] as Compound[]).filter(c=>new RegExp(`\\b${c}s?\\b`).test(text));
    if(compounds.length>1) return {kind:'clarify',text:'Choose one compound: soft, medium, or hard.'};
    return {kind:'command',command:{car,action:'pit',compound:compounds[0]??'medium'}};
  }
  if(push||conserve||balanced) return {kind:'command',command:{car,action:push?'push':conserve?'conserve':'balanced'}};
  if(/\b(tyres?|tires?)\b/.test(text)) return {kind:'question',topic:'tyres',car};
  if(/\b(gaps?)\b/.test(text)) return {kind:'question',topic:'gaps',car};
  if(/\b(strategy|plan)\b/.test(text)) return {kind:'question',topic:'strategy',car};
  return {kind:'clarify',text:'Try “car two, box for mediums” or “how are car one’s tyres?”'};
}
