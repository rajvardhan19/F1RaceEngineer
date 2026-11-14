// Fixed radio turns shipped as neural audio so the team can speak without inference delay.
export const RADIO_CUES=[
  {file:'james-opening',speaker:'STRATEGIST',text:'Team, radio check. Theo, Nico. Talk to us.'},
  {file:'theo-opening',speaker:'LAU',text:'Loud and clear. Starting to lose grip. Maya, what are you seeing?'},
  {file:'nico-opening',speaker:'REY',text:'Radio is good. Eli, what’s the gap ahead?'},
  {file:'maya-opening',speaker:'TYRE SPECIALIST',text:'Copy, Theo. We see the wear. Working on your pit window.'},
  {file:'eli-opening',speaker:'DATA ENGINEER',text:'Copy, Nico. Watching the gap. Keep us updated on the balance.'},
  {file:'theo-push',speaker:'LAU',text:'Understood. Pushing now.'},
  {file:'nico-push',speaker:'REY',text:'Finally! Let’s go!'},
  {file:'theo-hold',speaker:'LAU',text:'Copy. Holding station.'},
  {file:'nico-hold',speaker:'REY',text:'Ugh. Okay. Holding.'},
  {file:'which-car',speaker:'STRATEGIST',text:'Which car, Theo or Nico?'},
] as const;
export function radioCue(speaker:string,text:string){return RADIO_CUES.find(c=>c.speaker===speaker&&c.text===text);}
