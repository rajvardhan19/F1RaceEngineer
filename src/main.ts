import './style.css';
import { createRace, step, order, playerCar, applyCommand, message, lapPace, formatTime, TYRES, TOTAL_LAPS, START_LAP, pitForecast } from './sim.ts';
import type { Car, Compound, Command, Race } from './sim.ts';
import {parseIntent} from './intent.ts';
import {RadioVoice, voiceProfile} from './radio.ts';
import {VoiceInput} from './voice-input.ts';
import {PitwallSound} from './sound.ts';
import {driverNumber,layoutMarkers} from './map.ts';
import type {DebriefAnalysis,Result} from './analysis.ts';

let race=createRace();let speed=1;let selected=1;let recentCar:number|undefined;let lastMessage=0;let accumulator=0;let lastFrame=performance.now();
let guided=true;let briefing=true;let debrief=false;let comparison:DebriefAnalysis|null=null;let analysisWorker:Worker|null=null;let analysisProgress='';let inspectedDriver=1;let lastAirTime=0;let onAir=false;
const voice=new RadioVoice();const sound=new PitwallSound();
const app=document.querySelector<HTMLDivElement>('#app')!;
const track='M 88 162 L 195 79 Q 220 59 244 67 L 305 90 Q 320 95 328 78 L 347 41 Q 355 29 369 39 L 407 74 Q 422 88 408 104 L 382 134 Q 367 152 387 164 L 432 193 Q 448 205 431 218 L 390 248 Q 377 257 366 244 L 338 210 Q 331 200 317 208 L 289 225 Q 273 236 260 223 L 224 188 Q 215 179 203 192 L 167 232 Q 151 250 137 236 L 86 190 Q 72 177 88 162 Z';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
app.innerHTML=`
<header class="topbar"><a class="brand" href="./" aria-label="Pitwall home"><span class="brand-mark">∕∕</span> PITWALL<span class="brand-sub">RACE ENGINEER</span></a><div class="session-name"><span class="live-dot"></span> BARCELONA <span class="muted">/</span> THE LONG GAME</div><div class="header-actions"><button id="focus" class="subtle" aria-pressed="false">Race view</button><button id="guide" class="subtle">Hints on</button><button id="sound" class="subtle" aria-pressed="false">Audio off</button><button id="brief" class="icon-button" aria-label="Scenario briefing">?</button></div></header>
<main><section class="sessionbar"><div><div class="eyebrow">SCENARIO 01 <span>·</span> STRATEGY SIMULATION</div><h1>Your call. Their race.</h1></div><div class="race-status"><div id="flag" class="flag">● GREEN FLAG</div><div class="lap-counter">LAP <strong id="lap">19</strong><span>/ 36</span></div><div class="playback"><button id="play" class="play" aria-label="Start race">▶</button><div class="speeds" aria-label="Simulation speed">${[1,5,15,60].map(n=>`<button data-speed="${n}" class="${n===1?'active':''}" aria-pressed="${n===1}">${n}×</button>`).join('')}</div></div></div></section>
<section class="race-director"><span class="director-label"><i></i> LIVE FROM THE PIT WALL</span><strong id="race-headline">THE LONG GAME</strong><span id="race-stakes">A podium to protect. A second car ready to attack.</span></section><div class="dashboard"><aside class="panel timing"><div class="panel-head"><h2>Timing tower</h2><span class="tiny">TO LEADER</span></div><div class="timing-labels"><span>POS / DRIVER</span><span>GAP</span><span>TYRE</span></div><div id="tower"></div><div class="tower-footer"><span class="live-dot"></span> Sector updates <span id="clock">00:00</span></div><div class="objective"><span class="eyebrow">YOUR OBJECTIVE</span><h3>Two cars. One team.</h3><p>Keep Theo on the podium.<br>Bring Nico into the top five.</p><div class="objective-line"><span>01 / LAURENT</span><b>TOP 3</b></div><div class="objective-line"><span>02 / REYES</span><b>TOP 5</b></div></div></aside>
<section class="center-column"><div class="panel circuit-panel"><div class="panel-head"><h2>Circuit de Barcelona</h2><span class="tag">LIVE TRACK</span></div><div class="circuit-meta"><span>4.657 <small>KM</small></span><span>14 <small>TURNS</small></span><span>DRY <small>TRACK</small></span></div><div class="circuit-wrap"><div class="circuit-watermark">BARCELONA<span>RACE // 01</span></div><div class="sector-label sector-one">SECTOR 1</div><div class="sector-label sector-two">SECTOR 2</div><div class="sector-label sector-three">SECTOR 3</div><svg id="track" viewBox="40 5 440 275" role="img" aria-label="Schematic circuit map with live car positions"><path d="${track}" class="track-shadow"/><path id="track-path" d="${track}" class="track-line"/><path d="M 125 117 L 138 132" stroke="#e8eee6" stroke-width="5"/><g id="car-trails"></g><g id="car-markers"></g></svg><div class="track-caption">NUMBER = DRIVER · COLOR = CONSTRUCTOR</div></div><div id="map-legend" class="map-legend" aria-label="Constructor colors and driver numbers"></div><div id="map-driver" class="map-driver" aria-live="polite"></div><div id="live-battles" class="live-battles"></div><div class="conditions"><div><span class="eyebrow">TRACK TEMP</span><strong>38°<small>C</small></strong></div><div><span class="eyebrow">AIR TEMP</span><strong>24°<small>C</small></strong></div><div><span class="eyebrow">RAIN CHANCE</span><strong>10<small>%</small></strong></div><div><span class="eyebrow">FORECAST</span><strong class="forecast">Dry to finish <span>80% confidence</span></strong></div></div></div>
<div class="car-grid" id="cars"></div>
<div class="panel pace-panel"><div class="panel-head"><h2>Race pace</h2><div class="legend"><span>● LAU</span><span>● REY</span><small>COMPLETED LAPS</small></div></div><div id="pace"></div></div></section>
<aside class="right-column"><div class="panel strategy"><div class="panel-head"><h2>Strategy desk</h2><span class="tiny">APEX</span></div><div class="strategy-tabs"><button data-select="1" class="active">01 LAURENT</button><button data-select="2">02 REYES</button></div><div id="strategy"></div></div><div class="panel radio-panel"><div class="panel-head"><h2>Team radio</h2><span class="tag radio-tag">● ONLINE</span></div><div id="messages" role="log" aria-label="Team radio messages"></div><div class="radio-hint" id="hint">Try “car two, box for mediums”</div></div></aside></div>
<section class="on-air-panel" aria-label="Current team transmission"><div class="speaker-avatar" id="speaker-avatar">PW</div><div class="transmission"><div><span id="speaker-label">PIT WALL · STANDING BY</span><span id="transmission-state">RADIO LINK</span></div><p id="subtitle">The team is waiting for your call.</p></div><div class="waveform" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></section><section class="voice-console"><div class="voice-setup"><label for="radio-cast">TEAM VOICES</label><select id="radio-cast"><option value="LAU">Theo · measured</option><option value="REY">Nico · energetic</option><option value="STRATEGIST">James · strategy</option><option value="TYRE SPECIALIST">Maya · tyres</option><option value="DATA ENGINEER">Eli · data</option></select><button id="radio-preview">Load &amp; hear voice</button><span id="radio-status" role="status" aria-live="polite">Local neural voices · first download ~90 MB · no subscription</span></div><div class="voice-setup"><label for="voice-engine">VOICE INPUT</label><select id="voice-engine"><option value="local">On-device voice</option><option value="browser">Browser speech service</option></select><button id="voice-check">Run voice check</button><span class="voice-privacy">First use downloads a speech model. On-device audio is never uploaded.</span></div><div class="voice-feedback"><span id="voice-state">READY</span><div class="mic-meter" aria-label="Microphone input level"><i id="mic-level"></i></div><span id="voice-detail" role="status" aria-live="polite">Hold Space to talk; release to send. Or click Talk, then Finish.</span><button id="voice-cancel" hidden>Cancel</button></div></section><section class="command-bar"><div class="radio-symbol">⌁</div><div class="command-title"><strong>YOU HAVE THE RADIO</strong><span id="mic-status">Type a call or use your microphone</span></div><form id="command-form"><label class="sr-only" for="command">Radio command</label><input id="command" autocomplete="off" placeholder='“Car two, box for mediums”'><button type="submit" aria-label="Send radio command">↵</button></form><button id="mic" class="mic-button">◉ <span>Talk · R</span></button></section>
<footer><span>APEX MOTORSPORT <span class="muted">/ ENGINEERING STATION 01</span></span><span>SYNTHETIC SCENARIO · SEED 2049 <span class="footer-dot">●</span> LOCAL SIMULATION</span></footer></main>
<dialog id="modal"></dialog>`;
function setHTML(selector:string,html:string) {
  const el=document.querySelector<HTMLElement>(selector)!;
  if(el.dataset.rendered===html)return;
  const active=document.activeElement;
  const data=active instanceof HTMLButtonElement && el.contains(active)?JSON.stringify(active.dataset):null;
  el.innerHTML=html;el.dataset.rendered=html;
  if(data)Array.from(el.querySelectorAll('button')).find(b=>JSON.stringify(b.dataset)===data)?.focus({preventScroll:true});
}
const $=<T extends HTMLElement=HTMLElement>(q:string)=>document.querySelector<T>(q)!;
function timingOrder() {
  return order(race).sort((a,b)=>(a.finishedAt??Infinity)-(b.finishedAt??Infinity)||b.shownDistance-a.shownDistance||a.id-b.id);
}
function carPanel(car:Car,num:number) {
  const pos=timingOrder().findIndex(c=>c.id===car.id)+1;const tyre=TYRES[car.compound];
  return `<article class="panel car-panel ${selected===num?'selected':''}"><div class="driver-heading"><span class="driver-number">0${num}</span><div><span class="eyebrow">${num===1?'THE VETERAN':'THE HOTSHOT'}</span><h2>${car.name}</h2></div><strong class="position">P${pos}</strong></div><div class="tyre-line"><span class="compound" style="--tyre:${tyre.color}">${car.compound[0].toUpperCase()}</span><span>${car.compound.toUpperCase()} <small>${Math.floor(car.age)} laps old</small></span><div class="tyre-health"><strong>${Math.max(0,Math.round((1-car.wear)*100))}%</strong><small>TYRE LIFE</small></div></div><div class="wear-track"><div style="width:${Math.max(0,(1-car.wear)*100)}%;background:${car.wear>0.78?'#ed6d73':tyre.color}"></div><i></i></div><div class="car-stats"><div><span>LAST LAP</span><strong>${formatTime(car.lastLap)}</strong></div><div><span>PACE MODE</span><strong>${car.mode}</strong></div><div><span>STOPS</span><strong>${car.stops}</strong></div></div><div class="car-actions"><button data-car="${num}" data-action="pit" class="box-button" ${car.finishedAt!==null?'disabled':''}>${car.pitRemaining?'PIT · '+car.pitRemaining+'s':car.pitOrder?'BOX · '+car.pitOrder.toUpperCase():'BOX THIS LAP'}</button><button data-car="${num}" data-action="stay">Stay out</button><button data-car="${num}" data-action="${car.mode==='push'?'conserve':'push'}">${car.mode==='push'?'Conserve':'Push'} ↗</button></div></article>`;
}
function render() {
  const sorted=timingOrder();const leader=sorted[0];
  $('#lap').textContent=String(Math.min(TOTAL_LAPS,Math.floor(order(race)[0].distance)+1));
  $('#flag').className='flag '+(race.flag==='safety'?'yellow':'');
  $('#flag').textContent=race.status==='finished'?'⚑ CHEQUERED FLAG':race.status==='paused'?'Ⅱ SESSION PAUSED':race.status==='ready'?'● READY TO RACE':race.flag==='safety'?'● SAFETY CAR':'● GREEN FLAG';
  $('#play').textContent=race.status==='running'?'Ⅱ':'▶';$('#play').setAttribute('aria-label',race.status==='finished'?'Open race debrief':race.status==='running'?'Pause race':'Resume race');
  document.body.classList.toggle('under-safety',race.flag==='safety');
  document.body.classList.toggle('race-running',race.status==='running');
  sound.update(race.status==='running',race.flag==='safety',playerCar(race,selected)!.distance);
  renderRaceStory();
  $('#clock').textContent=`${Math.floor(race.elapsed/60).toString().padStart(2,'0')}:${(race.elapsed%60).toString().padStart(2,'0')}`;
  $('#tower').innerHTML=sorted.map((car,i)=>`<div class="timing-row ${car.player?'our-car':''}"><span class="rank">${i+1}</span><span class="team-line" style="background:${car.color}"></span><div class="timing-name"><strong>${car.code}</strong><small>${car.team}</small></div><span class="gap">${car.finishedAt!==null?'FIN':car.pitRemaining?'PIT':i===0?'LEADER':'+'+Math.max(0,(leader.shownDistance-car.shownDistance)*86).toFixed(1)}</span><span class="tyre-dot" style="color:${TYRES[car.compound].color}">${car.compound[0].toUpperCase()}</span></div>`).join('');
  setHTML('#cars',race.cars.filter(c=>c.player).map((c,i)=>carPanel(c,i+1)).join(''));
  const path=$<SVGPathElement & HTMLElement>('#track-path');const length=path.getTotalLength();
  const markers=layoutMarkers(race.cars,f=>path.getPointAtLength(f*length));
  const markerHTML=(c:Car,p:{x:number;y:number},anchor:{x:number;y:number})=>`<g data-map-driver="${c.id}" class="map-marker ${c.id===inspectedDriver?'inspected':''}" tabindex="0" role="button" aria-label="${c.name}, ${c.team}, number ${driverNumber(c)}" transform="translate(${p.x},${p.y})"><title>${c.name} · ${c.team} · ${driverNumber(c)}</title>${Math.hypot(p.x-anchor.x,p.y-anchor.y)>3?`<line x1="0" y1="0" x2="${anchor.x-p.x}" y2="${anchor.y-p.y}" stroke="${c.color}" opacity=".65"/>`:''}<circle r="${c.id===inspectedDriver?12:10}" fill="#0d1511" stroke="${c.color}" stroke-width="${c.player?3:2}"/><circle r="7" fill="${c.color}" opacity="${c.id===inspectedDriver?'.4':'.16'}"/><text text-anchor="middle" dy="3" fill="#fff" font-size="8" font-family="monospace" font-weight="700">${driverNumber(c)}</text></g>`;
  const focusedMarker=document.activeElement?.closest('.map-marker')?.getAttribute('data-map-driver');
  $('#car-markers').innerHTML=markers.map(({car,point,anchor})=>markerHTML(car,point,anchor)).join('');
  if(focusedMarker)document.querySelector<SVGElement>(`#car-markers [data-map-driver="${focusedMarker}"]`)?.focus({preventScroll:true});
  const teams=[...new Set(race.cars.map(c=>c.team))];
  setHTML('#map-legend',teams.map(team=>{const cars=race.cars.filter(c=>c.team===team);return `<div><span class="constructor-label" style="--constructor:${cars[0].color}">${team}</span>${cars.map(c=>`<button data-map-driver="${c.id}" aria-pressed="${c.id===inspectedDriver}" style="--constructor:${c.color}"><b>${driverNumber(c)}</b> ${c.code}</button>`).join('')}</div>`;}).join(''));
  const inspected=race.cars.find(c=>c.id===inspectedDriver)!;
  $('#map-driver').innerHTML=`<span style="color:${inspected.color}">●</span><b>${driverNumber(inspected)} ${inspected.name}</b><span>${inspected.team}</span><strong>P${order(race).findIndex(c=>c.id===inspected.id)+1}</strong><span>${inspected.compound.toUpperCase()} · ${Math.floor(inspected.age)} LAPS</span>`;
  renderStrategy();renderPace();
  const log=$('#messages');const bottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;
  if(lastMessage!==race.messages.length) {
    log.innerHTML=race.messages.slice(-60).map(m=>`<div class="radio-message ${m.kind}"><div><strong>${esc(m.speaker)}</strong><time>${Math.floor(m.at/60)}:${(m.at%60).toString().padStart(2,'0')}</time></div><p>${esc(m.text)}</p></div>`).join('');
    if(bottom) log.scrollTop=log.scrollHeight;
    race.messages.slice(lastMessage).filter(m=>m.speaker!=='YOU').slice(-2).forEach(m=>{if(!onAir)showTransmission(m.speaker,m.text);voice.say(m.text,m.speaker,m.kind==='warning');});
    lastMessage=race.messages.length;
  }
  if(race.status==='finished'&&!debrief) {debrief=true;showDebrief();}
}
function renderStrategy() {
  const c=playerCar(race,selected)!;const remain=Math.ceil(TOTAL_LAPS-c.distance);const forecast=pitForecast(race,c);
  if(c.finishedAt!==null){setHTML('#strategy',`<div class="strategy-callout"><div class="eyebrow">CHEQUERED FLAG</div><h3>Car home. Job done.</h3><p>${c.name} finishes P${order(race).findIndex(x=>x.id===c.id)+1}. Open the debrief using the play control.</p></div>`);return;}
  document.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.select)===selected);b.setAttribute('aria-pressed',String(Number(b.dataset.select)===selected));});
  setHTML('#strategy',`<div class="strategy-callout"><div class="eyebrow">${c.pitOrder?'PIT CALL CONFIRMED':c.wear>0.78?'PIT WINDOW OPEN':'ENGINEER’S OUTLOOK'}</div><h3>${c.pitOrder?'Box for '+c.pitOrder+'s':c.wear>0.78?'Fresh tyres. Fresh options.':'Keep the long game in mind.'}</h3><p>${c.pitRemaining?'Crew working. '+c.pitRemaining+' seconds of pit-lane loss remaining.':race.flag==='safety'?'The field is bunching up. Pit loss is lower now; watch for a double stack.':c.wear>0.78?'Degradation is costing lap time. A fresh set may recover the pit loss.':'Pit now and rejoin around P'+forecast.position+'. That forecast assumes the field holds its current pace.'}</p></div><div class="strategy-metrics"><div><span>Est. pit loss</span><strong>${race.flag==='safety'?'12.2':'21.0'}s</strong></div><div><span>Projected pit exit</span><strong>P${forecast.position} · ${forecast.ahead}</strong></div><div><span>Laps remaining</span><strong>${remain}</strong></div><div><span>Current pace estimate</span><strong>${formatTime(lapPace(c,race))}</strong></div></div><div class="compound-heading">NEXT STOP COMPOUND</div><div class="compound-options">${(['soft','medium','hard'] as Compound[]).map(t=>`<button data-compound="${t}" class="${nextTyre[selected]===t?'active':''}" style="--tyre:${TYRES[t].color}" aria-pressed="${nextTyre[selected]===t}"><b>${t[0].toUpperCase()}</b>${t}</button>`).join('')}</div><button class="strategy-box" data-car="${selected}" data-action="pit">${c.pitOrder?'UPDATE PIT CALL':'CALL '+c.code+' INTO THE BOX'} <span>↗</span></button><div class="mode-controls"><button data-car="${selected}" data-action="balanced">Normal pace</button><button data-car="${selected}" data-action="conserve">Conserve tyres</button></div>`);
}
const nextTyre:Record<number,Compound>={1:'medium',2:'medium'};
function renderPace() {
  const a=playerCar(race,1)!,b=playerCar(race,2)!;const times=[...a.lapTimes,...b.lapTimes];
  if(!times.length) {$('#pace').innerHTML='<div class="chart-empty"><div class="chart-grid"></div><span>Telemetry appears after your first complete lap</span></div>';return;}
  const min=Math.floor(Math.min(...times)-2),max=Math.ceil(Math.max(...times)+2);const y=(v:number)=>100-(v-min)/(max-min)*76;
  const series=(c:Car,color:string)=>`<polyline fill="none" stroke="${color}" stroke-width="2" points="${c.lapTimes.map((v,i)=>`${38+i/(TOTAL_LAPS-START_LAP-1)*510},${y(v)}`).join(' ')}"/>${c.lapTimes.map((v,i)=>`<circle cx="${38+i/(TOTAL_LAPS-START_LAP-1)*510}" cy="${y(v)}" r="2.5" fill="${color}"/>`).join('')}`;
  $('#pace').innerHTML=`<svg viewBox="0 0 570 125" role="img" aria-label="Completed lap times for Laurent and Reyes">${[min,(min+max)/2,max].map(v=>`<line x1="38" y1="${y(v)}" x2="550" y2="${y(v)}" stroke="#29332d" stroke-dasharray="3 5"/><text x="0" y="${y(v)+3}" fill="#88988b" font-size="9">${v.toFixed(0)}s</text>`).join('')}${series(a,'#c4f17b')}${series(b,'#8fb8dc')}<text x="38" y="119" fill="#88988b" font-size="9">L20</text><text x="530" y="119" fill="#88988b" font-size="9">L36</text></svg>`;
}
function send(command:Command) {recentCar=command.car;voice.interrupt();const before=race.messages.length;const result=applyCommand(race,command);if(before===race.messages.length) message(race,'ENGINEER',result);render();}
function submit(text:string) {
  if(!text.trim())return;voice.interrupt();message(race,'YOU',text);
  const intent=parseIntent(text,recentCar);
  if(intent.kind==='clarify') message(race,'ENGINEER',intent.text);
  else if(intent.kind==='command') {recentCar=intent.command.car;const before=race.messages.length;const result=applyCommand(race,intent.command);if(before===race.messages.length)message(race,'ENGINEER',result);}
  else {
    recentCar=intent.car;const c=playerCar(race,intent.car)!;const sorted=order(race);const pos=sorted.findIndex(x=>x.id===c.id);
    if(intent.topic==='weather')message(race,'DATA ENGINEER','Dry to the finish is the outlook, 80% confidence. This first scenario has no rain event.');
    if(intent.topic==='tyres')message(race,'TYRE SPECIALIST',`${c.code}: ${c.compound}s, ${Math.floor(c.age)} laps old, ${Math.max(0,Math.round((1-c.wear)*100))}% estimated life. ${c.wear>0.78?'We are at the performance cliff.':'Still in the working window.'}`);
    if(intent.topic==='gaps')message(race,'DATA ENGINEER',`${c.code} is P${pos+1}. ${pos?`${Math.max(0,(sorted[pos-1].shownDistance-c.shownDistance)*86).toFixed(1)} seconds to ${sorted[pos-1].code}, estimated from the latest sector.`:'Leading the race.'}`);
    if(intent.topic==='strategy')message(race,'STRATEGIST',`${c.code}: ${c.wear>0.72?'Box for mediums; they should reach the finish.':'Stay out for now and watch the undercut.'} Estimated pit loss ${race.flag==='safety'?'12':'21'} seconds. Your call.`);
  }
  render();
}
function showBriefing() {
  const modal=$<HTMLDialogElement>('#modal');modal.classList.remove('debrief-modal');
  modal.innerHTML=`<div class="modal-kicker">PITWALL / SCENARIO 01</div><h2>The long game.</h2><p class="modal-intro">Barcelona. Eighteen laps left. Two drivers relying on your next call.</p><div class="brief-grid"><div><b>01 / THEO LAURENT</b><p>P2 on ageing mediums. A measured veteran with a podium to protect.</p></div><div><b>02 / NICO REYES</b><p>P5 on softs approaching the cliff. Quick, impatient, and ready to attack.</p></div></div><div class="brief-instructions"><p><b>You run the strategy.</b> Pick a compound, call a pit stop, and manage each driver’s pace. A safety car may change the equation.</p><p><b>Your voice is optional.</b> Say “car two, box for mediums”, ask “how are car one’s tyres?”, or use the controls. Calls without a car use the last car you addressed.</p><p><b>Replay fairly.</b> The same seed and decisions always produce the same result. After the race, compare with a sensible default engineer, explore your calls one lap earlier or later, and see the best strategy found in a bounded search.</p></div><label class="brief-audio"><input type="checkbox" id="brief-audio" ${race.status==='ready'||voice.enabled?'checked':''}> Headset on · local neural voices, radio cues & race ambience</label><div class="scenario-note">Fictional teams · Synthetic pace data · Schematic circuit<br>Prototype: dry conditions, simplified strategy physics, no historical result claims.</div><button id="start-session" class="primary">${race.status==='ready'?'TAKE THE PIT WALL':'BACK TO THE PIT WALL'} <span>↗</span></button>`;
  if(!modal.open)modal.showModal();
  $('#start-session').onclick=async()=>{const starting=race.status==='ready';setAudio($<HTMLInputElement>('#brief-audio').checked);if(voice.enabled&&!voice.ready){const button=$<HTMLButtonElement>('#start-session');button.disabled=true;button.textContent='LOADING NEURAL VOICES…';try{await voice.prepare();}catch{setAudio(false);}button.disabled=false;}modal.close();briefing=false;if(starting){race.status='running';voice.say('Radio check. Theo P2. Nico P5. Eighteen laps to go. Your call.','STRATEGIST');}lastFrame=performance.now();render();};
}
function showDebrief() {
  const modal=$<HTMLDialogElement>('#modal');const result=order(race);const a=result.findIndex(c=>c.id===1)+1,b=result.findIndex(c=>c.id===4)+1;
  modal.classList.add('debrief-modal');
  modal.innerHTML=`<div class="modal-kicker">ENGINEERING DEBRIEF / SEED ${race.seed}</div><h2>${a<=3&&b<=5?'A team result.':'Every call is a lesson.'}</h2><p class="modal-intro">${a<=3?'Podium secured.':'The podium slipped away.'} ${b<=5?'Nico finishes in the top five.':'There’s more to find with Nico.'}</p><div class="result-grid">${[1,2].map(n=>{const c=playerCar(race,n)!;return `<div><span>${c.name}</span><strong>P${result.findIndex(x=>x.id===c.id)+1}</strong><small>${c.stops} stops · ${c.trust}% outcome-based trust</small></div>`;}).join('')}</div><div id="comparison">${comparison?comparisonHTML():`<p class="analysis-progress" role="status">${analysisProgress||'Replaying default strategy and testing pit plans…'}</p>`}</div><div class="debrief-actions"><button id="inspect" class="secondary">Inspect pit wall</button><button id="restart" class="primary">REPLAY SCENARIO ↗</button></div>`;
  if(!modal.open)modal.showModal();
  $('#inspect').onclick=()=>modal.close();$('#restart').onclick=()=>{modal.close();reset();};
  if(!comparison&&!analysisWorker)startAnalysis();
}
function startAnalysis(){
  analysisWorker=new Worker(new URL('./analysis-worker.ts',import.meta.url),{type:'module'});
  const worker=analysisWorker;
  worker.onmessage=(e:MessageEvent)=>{
    if(worker!==analysisWorker)return;
    if(e.data.type==='progress'){analysisProgress=`Tested ${e.data.done} of ${e.data.total} default / one-stop strategies…`;const node=document.querySelector('#comparison .analysis-progress');if(node)node.textContent=analysisProgress;}
    if(e.data.type==='complete'){comparison=e.data.result;worker.terminate();analysisWorker=null;if(document.querySelector('#comparison'))$('#comparison').innerHTML=comparisonHTML();}
    if(e.data.type==='error'){worker.terminate();analysisWorker=null;analysisProgress='Analysis failed: '+e.data.message;const node=document.querySelector('#comparison');if(node)node.textContent=analysisProgress;}
  };
  worker.onerror=()=>{worker.terminate();analysisWorker=null;analysisProgress='Analysis worker failed. Reload and replay to try again.';const node=document.querySelector('#comparison');if(node)node.textContent=analysisProgress;};
  worker.postMessage({seed:race.seed,decisions:race.decisions});
}
function comparisonHTML() {
  const analysis=comparison!;
  const row=(label:string,result:Result)=>`<tr><th scope="row">${label}</th><td>P${result.positions[0]}</td><td>P${result.positions[1]}</td><td>${result.points}</td><td>${result.objectives}/2</td></tr>`;
  const alternatives=analysis.alternatives;
  const available=alternatives.filter(a=>a.result);
  const strongest=[...available].sort((a,b)=>(b.secondsGained??0)-(a.secondsGained??0))[0];
  const lesson=strongest&&strongest.secondsGained!>0.1?`Moving ${strongest.car===1?'Theo’s':'Nico’s'} “${strongest.action}” call one lap ${strongest.direction} would produce P${strongest.result!.positions[strongest.car-1]}, ${strongest.secondsGained!.toFixed(1)} seconds faster for that driver.`:available.length?'None of the tested single-call shifts improved that driver’s finish time. Your timing held up against these alternatives.':'No movable calls to compare yet. Try issuing a pit call during your next run.';
  return `<div class="debrief-section"><h3>A benchmark that races back</h3><div class="comparison-table"><table><thead><tr><th>STRATEGY</th><th>THEO</th><th>NICO</th><th>POINTS</th><th>GOALS</th></tr></thead><tbody>${row('Your race',analysis.actual)}${row('Default engineer',analysis.baseline.result)}${row('Best found',analysis.best.result)}</tbody></table></div><p>${esc(analysis.baseline.plan)}</p><div class="lesson"><span class="eyebrow">ONE THING TO TAKE INTO YOUR NEXT RACE</span><p>${esc(lesson)}</p></div></div><div class="debrief-section"><h3>Best strategy found <span>${analysis.candidates} replays tested</span></h3><p class="best-plan">${esc(analysis.best.plan)}</p><small>Ranks by scenario goals, then team points, then combined finish time. Search includes your race, the default engineer, one-stop plans at laps 18–24 with all three compounds at balanced pace, and the call shifts below. This is a bounded, hindsight search, not a proven global optimum.</small></div><div class="debrief-section"><h3>What if you made the call a lap earlier?</h3><p>One call moves at a time, using your original distance/time trace. Other calls keep their original times. Both cars and the field are re-simulated with the same per-car random events.</p>${alternatives.length?`<div class="whatifs">${alternatives.map(a=>`<article class="whatif"><div><b>${a.car===1?'THEO':'NICO'} · ${esc(a.action)}</b><time>${formatTime(a.originalAt)}</time></div><strong>One lap ${a.direction}${a.result?' → P'+a.result.positions[a.car-1]:''}</strong>${a.result?`<p>${Math.abs(a.secondsGained!).toFixed(1)}s ${a.secondsGained!>=0?'faster':'slower'} · Teammate P${a.result.positions[a.car===1?1:0]} · ${a.result.points} team points</p>`:''}<small>${esc(a.note)}</small></article>`).join('')}</div>`:'<p>No calls were recorded. Your next race will unlock per-call alternatives.</p>'}</div>`;
}
function reset() {voiceInput.cancel();voice.interrupt();race=createRace();lastMessage=0;recentCar=undefined;comparison=null;analysisWorker?.terminate();analysisWorker=null;analysisProgress='';debrief=false;speed=1;accumulator=0;nextTyre[1]='medium';nextTyre[2]='medium';setSpeed(1);render();showBriefing();}
function setSpeed(n:number) {speed=n;document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.speed)===n);b.setAttribute('aria-pressed',String(Number(b.dataset.speed)===n));});}
app.addEventListener('click',e=>{
  const marker=(e.target as Element).closest('[data-map-driver]');
  if(marker){inspectedDriver=Number(marker.getAttribute('data-map-driver'));const car=race.cars.find(c=>c.id===inspectedDriver);if(car?.player){selected=car.id===1?1:2;recentCar=selected;}render();return;}
  const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;
  if(b.dataset.speed)setSpeed(Number(b.dataset.speed));
  if(b.dataset.select){selected=Number(b.dataset.select);recentCar=selected;render();}
  if(b.dataset.compound){nextTyre[selected]=b.dataset.compound as Compound;renderStrategy();}
  if(b.dataset.action){const car=Number(b.dataset.car);const action=b.dataset.action as Command['action'];send(action==='pit'?{car,action,compound:nextTyre[car]}:{car,action});}
});
app.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&(e.target as Element).matches('.map-marker')){e.preventDefault();(e.target as Element).dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
$('#play').onclick=()=>{if(race.status==='finished'){showDebrief();return;}if(race.status==='ready'){briefing=false;$<HTMLDialogElement>('#modal').close();}race.status=race.status==='running'?'paused':'running';if(race.status==='paused')voice.interrupt();accumulator=0;lastFrame=performance.now();render();};
$('#guide').onclick=()=>{guided=!guided;$('#guide').textContent=guided?'Hints on':'Hints off';$('#hint').hidden=!guided;};
function setAudio(enabled:boolean){voice.enabled=enabled;sound.setEnabled(enabled);$('#sound').textContent=enabled?'Audio on':'Audio off';$('#sound').setAttribute('aria-pressed',String(enabled));if(!enabled)voice.interrupt();else voice.unlock();}
$('#sound').onclick=()=>{setAudio(!voice.enabled);if(voice.enabled)voice.say('Radio check. Pit wall online.','DATA ENGINEER');};
voice.onStatus=(text,error=false)=>{$('#radio-status').textContent=text;$('#radio-status').classList.toggle('voice-error',error);const button=document.querySelector('#start-session');if(button instanceof HTMLButtonElement&&button.disabled)button.textContent=text;};
$('#radio-preview').onclick=async()=>{
  const button=$<HTMLButtonElement>('#radio-preview');button.disabled=true;
  if(race.status==='running')race.status='paused';
  voice.interrupt();setAudio(true);
  try{await voice.prepare();const speaker=$<HTMLSelectElement>('#radio-cast').value;voice.say(speaker==='LAU'?'Copy. Rear tyres are going. Let’s get the stop right.':speaker==='REY'?'Come on, I’ve got the pace. Let me push.':speaker==='TYRE SPECIALIST'?'Front left is dropping off. We need to box this lap.':speaker==='STRATEGIST'?'Box this lap. Mediums are ready. Confirm.':'Gap ahead, two point four. Keep it tidy.',speaker);}catch{/* Status shows recovery; never fall back to browser voices. */}finally{button.disabled=false;}
};
$('#focus').onclick=()=>{const focus=document.body.classList.toggle('focus-mode');$('#focus').setAttribute('aria-pressed',String(focus));$('#focus').textContent=focus?'All telemetry':'Race view';};
$('#brief').onclick=()=>{if(race.status==='running')race.status='paused';showBriefing();render();};
$('#command-form').onsubmit=e=>{e.preventDefault();const input=$<HTMLInputElement>('#command');submit(input.value);input.value='';};
const voiceInput=new VoiceInput({
  state:(state,text)=>{
    const busy=['loading','requesting','listening','processing'].includes(state);
    voice.blocked=busy;sound.setTalking(busy||onAir);$<HTMLButtonElement>('#radio-preview').disabled=busy;
    $('#voice-state').textContent=state.toUpperCase();$('#voice-detail').textContent=text;
    $('#voice-detail').classList.toggle('voice-error',state==='error');
    $('#mic').classList.toggle('listening',state==='listening');
    $('#mic').innerHTML=state==='listening'?'■ <span>Finish call</span>':busy?'◌ <span>Please wait</span>':'◉ <span>Talk · R</span>';
    $<HTMLButtonElement>('#mic').disabled=busy&&state!=='listening';
    $<HTMLButtonElement>('#voice-check').disabled=busy;
    $<HTMLSelectElement>('#voice-engine').disabled=busy;
    $('#voice-cancel').hidden=!busy;
    if(state==='listening'){sound.cue('open');$('#subtitle').textContent='Your channel is open. The team is listening.';$('#speaker-label').textContent='YOU · RACE ENGINEER';}
  },
  level:value=>{$('#mic-level').style.width=`${Math.round(value*100)}%`;},
  transcript:(text,final)=>{
    $<HTMLInputElement>('#command').value=text;
    if(final){voice.blocked=false;sound.cue('close');submit(text);$<HTMLInputElement>('#command').value='';}
    else $('#voice-detail').textContent='Hearing: '+text;
  },
  error:text=>{message(race,'RADIO',text);render();},
});
$('#mic').onclick=()=>{voice.interrupt();setSpeed(1);void voiceInput.start();};
$('#voice-engine').onchange=()=>{voiceInput.cancel();voiceInput.engine=$<HTMLSelectElement>('#voice-engine').value as 'local'|'browser';$('#voice-detail').textContent=voiceInput.engine==='local'?'On-device mode: audio stays here. Click Talk when ready.':'Browser mode may send audio to its recognition service.';};
$('#voice-check').onclick=async()=>{
  voice.interrupt();if(race.status==='running')race.status='paused';
  const text=await voiceInput.check();
  if(text){const parsed=parseIntent(text);const passed=parsed.kind==='command'&&parsed.command.car===2&&parsed.command.action==='pit';$('#voice-detail').textContent=`${passed?'Voice check passed':'Sample decoded; check recognition quality'}: “${text}”. Microphone was not used; no race command was issued.`;}
};
$('#voice-cancel').onclick=()=>voiceInput.cancel();
let holdingRadio=false;
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!$<HTMLDialogElement>('#modal').open&&!(e.target as Element).closest('input,textarea,select,button,a,[contenteditable]')){e.preventDefault();if(!['idle','error'].includes(voiceInput.state))return;holdingRadio=true;voice.interrupt();setSpeed(1);void voiceInput.start();}});
function releaseRadio(){if(!holdingRadio)return;holdingRadio=false;if(voiceInput.state==='listening')voiceInput.stop();else voiceInput.cancel();}
document.addEventListener('keyup',e=>{if(e.code==='Space'&&holdingRadio){e.preventDefault();releaseRadio();}});
window.addEventListener('blur',()=>{if(holdingRadio){holdingRadio=false;voiceInput.cancel();}});
document.addEventListener('keydown',e=>{if(e.code==='KeyR'&&!e.repeat&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!$<HTMLDialogElement>('#modal').open&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)&&!(e.target instanceof HTMLSelectElement)){e.preventDefault();$('#mic').click();}});
voice.onAir=(speaker,text)=>{onAir=true;showTransmission(speaker,text);sound.setTalking(true);sound.cue('open');$('#transmission-state').textContent='TRANSMITTING';};
voice.onSilent=()=>{onAir=false;sound.setTalking(voice.blocked);sound.cue('close');$('#transmission-state').textContent='RADIO LINK';};
function showTransmission(speaker:string,text:string){
  if(voice.blocked)return;lastAirTime=performance.now();
  $('#speaker-label').textContent=voiceProfile(speaker).label;$('#subtitle').textContent=text;$('#speaker-avatar').textContent=speaker==='LAU'?'TL':speaker==='REY'?'NR':speaker==='STRATEGIST'?'JW':speaker==='TYRE SPECIALIST'?'MK':'PW';
  $('.on-air-panel').classList.add('active');
}
function renderRaceStory(){
  const sorted=order(race),car=playerCar(race,selected)!;
  const remaining=TOTAL_LAPS-Math.floor(sorted[0].distance);
  $('#race-headline').textContent=race.status==='finished'?'CHEQUERED FLAG':race.flag==='safety'?'THE WINDOW IS OPEN':remaining<=5?'BRING IT HOME':car.pitRemaining?'EVERY SECOND COUNTS':'THE LONG GAME';
  $('#race-stakes').textContent=race.flag==='safety'?'Safety car deployed. Lower pit loss. The field is closing up.':car.pitRemaining?`${car.code} in the pit lane · ${car.pitRemaining}s remaining`:remaining<=5?`${remaining} laps left. Make the tyres count.`:'Two cars. One strategy. Your decisions shape the finish.';
  $('#live-battles').innerHTML=race.cars.filter(c=>c.player).map(c=>{const position=sorted.indexOf(c)+1;const ahead=sorted[position-2];const gap=ahead?Math.max(0,(ahead.distance-c.distance)*lapPace(c,race)).toFixed(1):'0.0';return `<div class="battle-card ${c.id===1?'theo':'nico'}"><span>${c.id===1?'01 / THEO':'02 / NICO'}</span><b>P${position}</b><small>${c.finishedAt!==null?'FINISHED':c.pitRemaining?'IN PIT LANE · '+c.pitRemaining+'s':c.pitOrder?'BOX THIS LAP':ahead?'↗ '+gap+'s TO '+ahead.code:'LEADING THE RACE'}</small></div>`;}).join('');
  const path=$<SVGPathElement&HTMLElement>('#track-path'),length=path.getTotalLength();
  $('#car-trails').innerHTML=race.cars.filter(c=>c.player&&c.finishedAt===null).map(c=>`<path d="${track}" fill="none" stroke="${c.color}" stroke-width="8" stroke-linecap="round" opacity=".28" stroke-dasharray="${length*.065} ${length*.935}" stroke-dashoffset="${-((c.distance%1)-.065)*length}"/>`).join('');
  if(!onAir&&performance.now()-lastAirTime>8500)$('.on-air-panel').classList.remove('active');
}
$<HTMLDialogElement>('#modal').addEventListener('cancel',()=>{briefing=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(race.status==='running')race.status='paused';voice.interrupt();voiceInput.cancel();render();}});
let lastRender=0;
function frame(now:number) {
  const delta=Math.min((now-lastFrame)/1000,0.25);lastFrame=now;
  if(race.status==='running'&&!briefing) {
    accumulator+=delta*speed;
    while(accumulator>=1&&race.status==='running') {
      const previousFlag=race.flag;step(race);accumulator--;
      if(previousFlag!==race.flag){setSpeed(1);accumulator=0;break;}
    }
  }
  if(now-lastRender>200){render();lastRender=now;}
  requestAnimationFrame(frame);
}
render();showBriefing();requestAnimationFrame(frame);
