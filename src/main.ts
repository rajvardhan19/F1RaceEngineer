import './style.css';
import { createRace, step, order, playerCar, applyCommand, message, lapPace, replay, formatTime, TYRES, TOTAL_LAPS, START_LAP } from './sim.ts';
import type { Car, Compound, Command, Race } from './sim.ts';
import {parseIntent} from './intent.ts';
import {RadioVoice, recognitionConstructor} from './radio.ts';
import type {Recognition} from './radio.ts';

let race=createRace();let speed=1;let selected=1;let recentCar:number|undefined;let lastMessage=0;let accumulator=0;let lastFrame=performance.now();
let guided=true;let briefing=true;let debrief=false;let comparison:Race|null=null;let listening=false;let recognition:Recognition|null=null;
const voice=new RadioVoice();
const app=document.querySelector<HTMLDivElement>('#app')!;
const track='M 88 162 L 195 79 Q 220 59 244 67 L 305 90 Q 320 95 328 78 L 347 41 Q 355 29 369 39 L 407 74 Q 422 88 408 104 L 382 134 Q 367 152 387 164 L 432 193 Q 448 205 431 218 L 390 248 Q 377 257 366 244 L 338 210 Q 331 200 317 208 L 289 225 Q 273 236 260 223 L 224 188 Q 215 179 203 192 L 167 232 Q 151 250 137 236 L 86 190 Q 72 177 88 162 Z';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
app.innerHTML=`
<header class="topbar"><a class="brand" href="./" aria-label="Pitwall home"><span class="brand-mark">∕∕</span> PITWALL<span class="brand-sub">RACE ENGINEER</span></a><div class="session-name"><span class="live-dot"></span> BARCELONA <span class="muted">/</span> THE LONG GAME</div><div class="header-actions"><button id="guide" class="subtle">Hints on</button><button id="sound" class="subtle" aria-pressed="false">Audio off</button><button id="brief" class="icon-button" aria-label="Scenario briefing">?</button></div></header>
<main><section class="sessionbar"><div><div class="eyebrow">SCENARIO 01 <span>·</span> STRATEGY SIMULATION</div><h1>Your call. Their race.</h1></div><div class="race-status"><div id="flag" class="flag">● GREEN FLAG</div><div class="lap-counter">LAP <strong id="lap">19</strong><span>/ 36</span></div><div class="playback"><button id="play" class="play" aria-label="Start race">▶</button><div class="speeds" aria-label="Simulation speed">${[1,5,15,60].map(n=>`<button data-speed="${n}" class="${n===1?'active':''}" aria-pressed="${n===1}">${n}×</button>`).join('')}</div></div></div></section>
<div class="dashboard"><aside class="panel timing"><div class="panel-head"><h2>Timing tower</h2><span class="tiny">TO LEADER</span></div><div class="timing-labels"><span>POS / DRIVER</span><span>GAP</span><span>TYRE</span></div><div id="tower"></div><div class="tower-footer"><span class="live-dot"></span> Sector updates <span id="clock">00:00</span></div><div class="objective"><span class="eyebrow">YOUR OBJECTIVE</span><h3>Two cars. One team.</h3><p>Keep Theo on the podium.<br>Bring Nico into the top five.</p><div class="objective-line"><span>01 / LAURENT</span><b>TOP 3</b></div><div class="objective-line"><span>02 / REYES</span><b>TOP 5</b></div></div></aside>
<section class="center-column"><div class="panel circuit-panel"><div class="panel-head"><h2>Circuit de Barcelona</h2><span class="tag">LIVE TRACK</span></div><div class="circuit-meta"><span>4.657 <small>KM</small></span><span>14 <small>TURNS</small></span><span>DRY <small>TRACK</small></span></div><div class="circuit-wrap"><div class="sector-label sector-one">SECTOR 1</div><div class="sector-label sector-two">SECTOR 2</div><div class="sector-label sector-three">SECTOR 3</div><svg id="track" viewBox="40 5 440 275" role="img" aria-label="Schematic circuit map with live car positions"><path d="${track}" class="track-shadow"/><path id="track-path" d="${track}" class="track-line"/><path d="M 125 117 L 138 132" stroke="#e8eee6" stroke-width="5"/><g id="car-markers"></g></svg><div class="track-caption"><span class="live-dot"></span> APEX MOTORSPORT <span class="muted">● REST OF FIELD</span></div></div><div class="conditions"><div><span class="eyebrow">TRACK TEMP</span><strong>38°<small>C</small></strong></div><div><span class="eyebrow">AIR TEMP</span><strong>24°<small>C</small></strong></div><div><span class="eyebrow">RAIN CHANCE</span><strong>10<small>%</small></strong></div><div><span class="eyebrow">FORECAST</span><strong class="forecast">Dry to finish <span>80% confidence</span></strong></div></div></div>
<div class="car-grid" id="cars"></div>
<div class="panel pace-panel"><div class="panel-head"><h2>Race pace</h2><div class="legend"><span>● LAU</span><span>● REY</span><small>COMPLETED LAPS</small></div></div><div id="pace"></div></div></section>
<aside class="right-column"><div class="panel strategy"><div class="panel-head"><h2>Strategy desk</h2><span class="tiny">APEX</span></div><div class="strategy-tabs"><button data-select="1" class="active">01 LAURENT</button><button data-select="2">02 REYES</button></div><div id="strategy"></div></div><div class="panel radio-panel"><div class="panel-head"><h2>Team radio</h2><span class="tag radio-tag">● ONLINE</span></div><div id="messages" role="log" aria-label="Team radio messages"></div><div class="radio-hint" id="hint">Try “car two, box for mediums”</div></div></aside></div>
<section class="command-bar"><div class="radio-symbol">⌁</div><div class="command-title"><strong>YOU HAVE THE RADIO</strong><span id="mic-status">Type a call or use your microphone</span></div><form id="command-form"><label class="sr-only" for="command">Radio command</label><input id="command" autocomplete="off" placeholder='“Car two, box for mediums”'><button type="submit" aria-label="Send radio command">↵</button></form><button id="mic" class="mic-button">◉ <span>Talk to team</span></button></section>
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
function carPanel(car:Car,num:number) {
  const pos=order(race).findIndex(c=>c.id===car.id)+1;const tyre=TYRES[car.compound];
  return `<article class="panel car-panel ${selected===num?'selected':''}"><div class="driver-heading"><span class="driver-number">0${num}</span><div><span class="eyebrow">${num===1?'THE VETERAN':'THE HOTSHOT'}</span><h2>${car.name}</h2></div><strong class="position">P${pos}</strong></div><div class="tyre-line"><span class="compound" style="--tyre:${tyre.color}">${car.compound[0].toUpperCase()}</span><span>${car.compound.toUpperCase()} <small>${Math.floor(car.age)} laps old</small></span><div class="tyre-health"><strong>${Math.max(0,Math.round((1-car.wear)*100))}%</strong><small>TYRE LIFE</small></div></div><div class="wear-track"><div style="width:${Math.max(0,(1-car.wear)*100)}%;background:${car.wear>0.78?'#ed6d73':tyre.color}"></div><i></i></div><div class="car-stats"><div><span>LAST LAP</span><strong>${formatTime(car.lastLap)}</strong></div><div><span>PACE MODE</span><strong>${car.mode}</strong></div><div><span>STOPS</span><strong>${car.stops}</strong></div></div><div class="car-actions"><button data-car="${num}" data-action="pit" class="box-button" ${car.finishedAt!==null?'disabled':''}>${car.pitRemaining?'IN PIT LANE':car.pitOrder?'BOX · '+car.pitOrder.toUpperCase():'BOX THIS LAP'}</button><button data-car="${num}" data-action="stay">Stay out</button><button data-car="${num}" data-action="${car.mode==='push'?'conserve':'push'}">${car.mode==='push'?'Conserve':'Push'} ↗</button></div></article>`;
}
function render() {
  const sorted=order(race);const leader=sorted[0];
  $('#lap').textContent=String(Math.min(TOTAL_LAPS,Math.floor(leader.distance)+1));
  $('#flag').className='flag '+(race.flag==='safety'?'yellow':'');
  $('#flag').textContent=race.status==='finished'?'⚑ CHEQUERED FLAG':race.status==='paused'?'Ⅱ SESSION PAUSED':race.status==='ready'?'● READY TO RACE':race.flag==='safety'?'● SAFETY CAR':'● GREEN FLAG';
  $('#play').textContent=race.status==='running'?'Ⅱ':'▶';$('#play').setAttribute('aria-label',race.status==='running'?'Pause race':'Resume race');
  $('#clock').textContent=`${Math.floor(race.elapsed/60).toString().padStart(2,'0')}:${(race.elapsed%60).toString().padStart(2,'0')}`;
  $('#tower').innerHTML=sorted.map((car,i)=>`<div class="timing-row ${car.player?'our-car':''}"><span class="rank">${i+1}</span><span class="team-line" style="background:${car.color}"></span><div class="timing-name"><strong>${car.code}</strong><small>${car.team}</small></div><span class="gap">${car.finishedAt!==null?'FIN':car.pitRemaining?'PIT':i===0?'LEADER':'+'+Math.max(0,(leader.shownDistance-car.shownDistance)*86).toFixed(1)}</span><span class="tyre-dot" style="color:${TYRES[car.compound].color}">${car.compound[0].toUpperCase()}</span></div>`).join('');
  setHTML('#cars',race.cars.filter(c=>c.player).map((c,i)=>carPanel(c,i+1)).join(''));
  const path=$<SVGPathElement & HTMLElement>('#track-path');const length=path.getTotalLength();
  $('#car-markers').innerHTML=[...race.cars].reverse().map(c=>{const p=path.getPointAtLength(((c.distance%1+1)%1)*length);return `<g transform="translate(${p.x},${p.y})"><circle r="${c.player?9:4}" fill="${c.player?'#c4f17b':'#68736d'}" stroke="#141a17" stroke-width="2"/>${c.player?`<text text-anchor="middle" dy="3" fill="#152010" font-size="9" font-weight="800">${c.id===1?'1':'2'}</text>`:''}</g>`;}).join('');
  renderStrategy();renderPace();
  const log=$('#messages');const bottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;
  if(lastMessage!==race.messages.length) {
    log.innerHTML=race.messages.slice(-60).map(m=>`<div class="radio-message ${m.kind}"><div><strong>${esc(m.speaker)}</strong><time>${Math.floor(m.at/60)}:${(m.at%60).toString().padStart(2,'0')}</time></div><p>${esc(m.text)}</p></div>`).join('');
    if(bottom) log.scrollTop=log.scrollHeight;
    race.messages.slice(lastMessage).filter(m=>m.speaker!=='YOU').slice(-2).forEach(m=>voice.say(m.text,m.kind==='driver'));
    lastMessage=race.messages.length;
  }
  if(race.status==='finished'&&!debrief) {debrief=true;showDebrief();}
}
function renderStrategy() {
  const c=playerCar(race,selected)!;const remain=Math.ceil(TOTAL_LAPS-c.distance);
  document.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.select)===selected);b.setAttribute('aria-pressed',String(Number(b.dataset.select)===selected));});
  setHTML('#strategy',`<div class="strategy-callout"><div class="eyebrow">${c.pitOrder?'PIT CALL CONFIRMED':c.wear>0.78?'PIT WINDOW OPEN':'ENGINEER’S OUTLOOK'}</div><h3>${c.pitOrder?'Box for '+c.pitOrder+'s':c.wear>0.78?'Fresh tyres. Fresh options.':'Keep the long game in mind.'}</h3><p>${c.wear>0.78?'Degradation is costing lap time. Consider a medium stint to the finish.':'Watch the gap behind. A well-timed stop can protect track position.'}</p></div><div class="strategy-metrics"><div><span>Est. pit loss</span><strong>${race.flag==='safety'?'12.2':'21.0'}s</strong></div><div><span>Laps remaining</span><strong>${remain}</strong></div><div><span>Current pace estimate</span><strong>${formatTime(lapPace(c,race))}</strong></div></div><div class="compound-heading">NEXT STOP COMPOUND</div><div class="compound-options">${(['soft','medium','hard'] as Compound[]).map(t=>`<button data-compound="${t}" class="${nextTyre[selected]===t?'active':''}" style="--tyre:${TYRES[t].color}" aria-pressed="${nextTyre[selected]===t}"><b>${t[0].toUpperCase()}</b>${t}</button>`).join('')}</div><button class="strategy-box" data-car="${selected}" data-action="pit">${c.pitOrder?'UPDATE PIT CALL':'CALL '+c.code+' INTO THE BOX'} <span>↗</span></button><div class="mode-controls"><button data-car="${selected}" data-action="balanced">Normal pace</button><button data-car="${selected}" data-action="conserve">Conserve tyres</button></div>`);
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
  const modal=$<HTMLDialogElement>('#modal');
  modal.innerHTML=`<div class="modal-kicker">PITWALL / SCENARIO 01</div><h2>The long game.</h2><p class="modal-intro">Barcelona. Eighteen laps left. Two drivers relying on your next call.</p><div class="brief-grid"><div><b>01 / THEO LAURENT</b><p>P2 on ageing mediums. A measured veteran with a podium to protect.</p></div><div><b>02 / NICO REYES</b><p>P5 on softs approaching the cliff. Quick, impatient, and ready to attack.</p></div></div><div class="brief-instructions"><p><b>You run the strategy.</b> Pick a compound, call a pit stop, and manage each driver’s pace. A safety car may change the equation.</p><p><b>Your voice is optional.</b> Say “car two, box for mediums”, ask “how are car one’s tyres?”, or use the controls. Calls without a car use the last car you addressed.</p><p><b>Replay fairly.</b> The same seed and decisions always produce the same result. After the race, compare against a no-calls baseline.</p></div><div class="scenario-note">Fictional teams · Synthetic pace data · Schematic circuit<br>Prototype: dry conditions, simplified strategy physics, no historical result claims.</div><button id="start-session" class="primary">${race.status==='ready'?'TAKE THE PIT WALL':'BACK TO THE PIT WALL'} <span>↗</span></button>`;
  if(!modal.open)modal.showModal();
  $('#start-session').onclick=()=>{modal.close();briefing=false;if(race.status==='ready')race.status='running';lastFrame=performance.now();render();};
}
function showDebrief() {
  const modal=$<HTMLDialogElement>('#modal');const result=order(race);const a=result.findIndex(c=>c.id===1)+1,b=result.findIndex(c=>c.id===4)+1;
  modal.innerHTML=`<div class="modal-kicker">SESSION COMPLETE / SEED ${race.seed}</div><h2>${a<=3&&b<=5?'A team result.':'Every call is a lesson.'}</h2><p class="modal-intro">${a<=3?'Podium secured.':'The podium slipped away.'} ${b<=5?'Nico finishes in the top five.':'There’s more to find with Nico.'}</p><div class="result-grid">${[1,2].map(n=>{const c=playerCar(race,n)!;return `<div><span>${c.name}</span><strong>P${result.findIndex(x=>x.id===c.id)+1}</strong><small>${c.stops} stops · ${c.trust}% outcome-based trust</small></div>`;}).join('')}</div><p class="debrief-copy">${race.decisions.length} strategy calls across ${formatTime(race.elapsed)} of simulated race time. Compare your result with the same seeded race and no player commands.</p><div id="comparison">${comparison?comparisonHTML():''}</div><button id="compare" class="secondary">COMPARE NO-CALLS BASELINE</button><div class="debrief-actions"><button id="inspect" class="secondary">Inspect pit wall</button><button id="restart" class="primary">REPLAY SCENARIO ↗</button></div>`;
  if(!modal.open)modal.showModal();
  $('#compare').onclick=()=>{comparison=replay(race.seed,[]);$('#comparison').innerHTML=comparisonHTML();};
  $('#inspect').onclick=()=>modal.close();$('#restart').onclick=()=>{modal.close();reset();};
}
function comparisonHTML() {
  return `<div class="baseline">${[1,2].map(n=>{const actual=playerCar(race,n)!,base=playerCar(comparison!,n)!;const delta=(base.finishedAt??0)-(actual.finishedAt??0);return `<p><b>${actual.code}</b> No calls: P${order(comparison!).findIndex(c=>c.id===base.id)+1} · Your finish: <strong>${Math.abs(delta).toFixed(1)}s ${delta>=0?'faster':'slower'}</strong></p>`;}).join('')}<small>Full-race baseline comparison, not attribution to an individual decision.</small></div>`;
}
function reset() {recognition?.abort();recognition=null;voice.interrupt();race=createRace();lastMessage=0;recentCar=undefined;comparison=null;debrief=false;speed=1;accumulator=0;nextTyre[1]='medium';nextTyre[2]='medium';setSpeed(1);render();showBriefing();}
function setSpeed(n:number) {speed=n;document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.speed)===n);b.setAttribute('aria-pressed',String(Number(b.dataset.speed)===n));});}
app.addEventListener('click',e=>{
  const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;
  if(b.dataset.speed)setSpeed(Number(b.dataset.speed));
  if(b.dataset.select){selected=Number(b.dataset.select);recentCar=selected;render();}
  if(b.dataset.compound){nextTyre[selected]=b.dataset.compound as Compound;renderStrategy();}
  if(b.dataset.action){const car=Number(b.dataset.car);const action=b.dataset.action as Command['action'];send(action==='pit'?{car,action,compound:nextTyre[car]}:{car,action});}
});
$('#play').onclick=()=>{if(race.status==='finished'){showDebrief();return;}if(race.status==='ready'){briefing=false;$<HTMLDialogElement>('#modal').close();}race.status=race.status==='running'?'paused':'running';if(race.status==='paused')voice.interrupt();accumulator=0;lastFrame=performance.now();render();};
$('#guide').onclick=()=>{guided=!guided;$('#guide').textContent=guided?'Hints on':'Hints off';$('#hint').hidden=!guided;};
$('#sound').onclick=()=>{voice.enabled=!voice.enabled;$('#sound').textContent=voice.enabled?'Audio on':'Audio off';$('#sound').setAttribute('aria-pressed',String(voice.enabled));if(!voice.enabled)voice.interrupt();else voice.say('Radio check. Pit wall online.');};
$('#brief').onclick=()=>{if(race.status==='running')race.status='paused';showBriefing();render();};
$('#command-form').onsubmit=e=>{e.preventDefault();const input=$<HTMLInputElement>('#command');submit(input.value);input.value='';};
const Constructor=recognitionConstructor();
if(!Constructor){$('#mic').setAttribute('disabled','');$('#mic').title='Speech recognition is unavailable in this browser. Use the text radio.';$('#mic-status').textContent='Text radio ready · voice input unavailable';}
$('#mic').onclick=()=>{
  if(!Constructor)return;if(listening){recognition?.stop();return;}
  voice.interrupt();recognition=new Constructor();recognition.lang='en-US';recognition.continuous=false;recognition.interimResults=false;
  recognition.onresult=e=>submit(e.results[0][0].transcript);
  recognition.onerror=e=>{message(race,'RADIO',`Microphone ${e.error}. Use the text radio or try again.`);render();};
  recognition.onend=()=>{listening=false;$('#mic').classList.remove('listening');$('#mic').innerHTML='◉ <span>Talk to team</span>';};
  try {recognition.start();listening=true;$('#mic').classList.add('listening');$('#mic').textContent='● Listening…';}catch{message(race,'RADIO','Unable to start microphone. Use the text radio.');render();}
};
$<HTMLDialogElement>('#modal').addEventListener('cancel',()=>{briefing=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&race.status==='running'){race.status='paused';voice.interrupt();recognition?.abort();render();}});
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
