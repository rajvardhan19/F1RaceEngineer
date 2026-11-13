# Pitwall — F1 Race Engineer

A browser-based race strategy proof of concept. Run the pit wall for two fictional drivers in a synthetic Barcelona scenario. Built with TypeScript and Vite; all race logic runs locally.

## Run

Requires Node.js 22.18+ (or 24+) and npm.

```sh
npm install
npm run dev
```

Open the printed local URL. Select **Take the pit wall** to begin. Use 1×, 5×, 15×, or 60× to control simulation speed. Safety-car deployment and restart automatically return to 1×. Switching tabs pauses the session.

```sh
npm test       # simulation and command-parser regressions
npm run build # strict TypeScript check and static production bundle
npm run preview
```

## Play

- Car one: Theo Laurent, P2, ageing mediums. Objective: podium.
- Car two: Nico Reyes, P5, ageing softs. Objective: top five.
- Select a car and compound in the strategy desk, then call the stop. Stops execute at the next lap boundary; stay out cancels an uncommitted stop.
- Push trades tyre life for pace; conserve trades pace for tyre life.
- Radio examples: `car two, box for mediums`, `Theo, stay out`, `car one, conserve`, `how are Nico's tyres?`, `what is the gap for car one?`.
- An unspecified car uses the last explicitly addressed car. Missing or conflicting instructions request clarification. Questions cannot execute commands.
- Speech recognition is optional and browser-dependent. Microphone input may use the browser vendor's remote speech service. No recording is stored by this app. Text and buttons always work.
- Choose headset audio in the briefing, or toggle Audio during a race. Player radio calls interrupt synthesised speech; drivers have queue priority.
- Finish the session to view positions, objective outcomes, and a same-seed default-strategy and what-if comparison. Replay starts the same scenario from scratch.

## Architecture

- `src/sim.ts`: pure deterministic simulation, seeded PRNG, scenario setup, tyre degradation, traffic, rival pit logic, safety-car events, pit service and replay. No browser or network dependencies.
- `src/intent.ts`: local command parser and structured, typed intents. No LLM calls or API keys.
- `src/radio.ts`: optional browser recognition and interruptible synthesis queue.
- `src/main.ts`: dashboard, fixed-step scheduler, briefing/debrief, and control orchestration.
- `src/style.css`: responsive desktop and mobile interface.
- `tests/sim.test.ts`: deterministic replay, state invariants, pit lifecycle, safety car, tyre cliff, sector timing, and parser safety tests.

One tick is one simulated second, independent of rendering and acceleration. Commands are logged against simulation time. All field positions are sampled together at leader sector boundaries for displayed gap estimates. Exact finish timestamps determine classification. The default-engineer baseline and bounded strategy search rerun the complete race. Single-call alternatives hold the other call timestamps fixed.

## Deliberate prototype limits

This is a playable proof of concept, not the full design or an F1 physics model. Names, pace, weather, and scenario data are synthetic. The track drawing is schematic. There are ten cars, a single dry scenario, a scheduled debris safety car, and simplified passing, fuel and pit-lane models. Forecast confidence is scenario flavor, not a live prediction. Race rules such as mandatory compound changes, DRS, penalties, and lapped-car safety-car procedures are not implemented.

Trust is an outcome-based debrief indicator; it does not alter compliance. There is no persistent career, live weather, historical data import, team credibility model, optional LLM fallback yet. Microphone permission and live speech quality still depend on the player’s browser and device; use the included voice check to verify the transcription engine.

Static output in `dist/` can be hosted without a backend. The repository includes a private Sites deployment manifest. The original GitHub remote is retained.

## Voice, map, and debrief update

On-device voice is now the default. It uses Whisper tiny.en through Transformers.js in a worker, with a self-hosted ONNX WASM runtime. The first use downloads the model weights from Hugging Face; subsequent uses can reuse the browser cache. Audio is processed locally and is not uploaded by this mode. Click **Talk**, speak when the channel opens, then **Finish call** (10-second maximum). Hold `Space` outside interactive controls to talk and release to send; releasing before capture opens cancels the request. `R` or the Talk button still toggles the radio. A real level meter shows microphone signal. Permission, device, service, silence, and format failures have separate recovery messages. **Browser speech service** remains an alternative and may send audio to the browser vendor.

**Run voice check** transcribes the included synthetic “Car two, box for mediums” clip using the same local engine. It pauses the race and never uses the microphone or issues a command. Cancel, reset, and tab hiding invalidate pending callbacks and release capture resources. The clip is synthesized test data, not a recording of a person.

The briefing offers headset audio: distinct speaker profiles, driver personalities, radio cues, and procedural race ambience. Ambient sound ducks during transmissions and microphone use. Team speech uses Kokoro-82M q8 in a dedicated worker, with five fixed neural voices and no browser speech-synthesis fallback. First use downloads about 90 MB of weights from Hugging Face, plus runtime and voice files; browser caching can avoid repeat downloads. Speech is generated locally, then band-limited and compressed through Web Audio. Use **Load & hear voice** to audition each character. This pauses the race. Loading and generation errors stay visible. Short calls are cached in memory; stale or interrupted responses never play. Local inference latency depends on device speed; these voices are less expressive than a hosted dramatic voice service. Race view emphasizes the circuit and strategy desk. Driver numbers and constructor colors appear on the map, timing tower, and interactive legend. Bunched markers are offset with tethers to actual positions; colors identify constructors, unique numbers identify drivers.

### Debrief methodology

The no-calls benchmark has been replaced by **Default engineer**: balanced pace, pit at 78% tyre wear (50% under safety car), fit mediums when they can reach the finish, and avoid a stop in the last three laps. Its decisions are recorded and replayable.

**Best found** searches 441 two-car one-stop combinations: each car stops at the end of lap 18–24 on soft, medium, or hard, at balanced pace. Your actual strategy, the default engineer, and valid single-call shifts are also candidates. Results rank by scenario objectives met, then constructor points (25/18/15/12/10/8/6/4/2/1), then combined player finish time. This is a bounded hindsight search, not a globally optimal strategy or advice available to the player during the race. Two-stop combinations and arbitrary pace schedules are outside the grid.

For **what-if analysis**, each recorded call moves one full lap of driver distance earlier or later using the original race's distance/time trace. All other calls retain their original simulation timestamps. Each alternative re-simulates the full field; positions, teammate impact, team points, and finish-time changes are reported. Shifts outside the scenario are marked unavailable; crossing another call for the same driver is explicitly flagged. A shifted pit order can be superseded by another command. These are conditional simulator counterfactuals, not claims about real racing.

Pace noise is keyed by seed/car/tick and pit randomness by seed/car/stop count. Changing a strategy no longer reshuffles other cars' random draws. Analysis runs in a worker so the interface remains responsive.

Kokoro’s bundled Transformers dependency is overridden to the project’s patched 4.3.2 runtime. Browser playback must be checked when upgrading either package. The model and library are Apache-2.0; source: https://github.com/hexgrad/kokoro.
