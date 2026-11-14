import {KokoroTTS} from 'kokoro-js';
import {mkdir,writeFile} from 'node:fs/promises';
import {RADIO_CUES} from '../src/radio-cues.ts';
import {voiceProfile,spokenText} from '../src/radio-profile.ts';
const tts=await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX',{dtype:'q8',device:'cpu'});
await mkdir('public/audio/team',{recursive:true});
for(const cue of RADIO_CUES){
 const profile=voiceProfile(cue.speaker);
 const result=await tts.generate(spokenText(cue.text),{voice:profile.voice,speed:profile.rate});
 await result.save(`public/audio/team/${cue.file}.wav`);
 console.log(cue.file);
}
await writeFile('public/audio/team/README.txt','Synthetic fictional team voices generated with Kokoro-82M (Apache-2.0), using scripts/render-radio-cues.mjs. No real driver recordings or cloned voices.\n');
