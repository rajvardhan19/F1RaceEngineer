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
- Audio starts off; enable it explicitly. Player radio calls interrupt synthesised speech; drivers have queue priority.
- Finish the session to view positions, objective outcomes, and a same-seed no-calls comparison. Replay starts the same scenario from scratch.

## Architecture

- `src/sim.ts`: pure deterministic simulation, seeded PRNG, scenario setup, tyre degradation, traffic, rival pit logic, safety-car events, pit service and replay. No browser or network dependencies.
- `src/intent.ts`: local command parser and structured, typed intents. No LLM calls or API keys.
- `src/radio.ts`: optional browser recognition and interruptible synthesis queue.
- `src/main.ts`: dashboard, fixed-step scheduler, briefing/debrief, and control orchestration.
- `src/style.css`: responsive desktop and mobile interface.
- `tests/sim.test.ts`: deterministic replay, state invariants, pit lifecycle, safety car, tyre cliff, sector timing, and parser safety tests.

One tick is one simulated second, independent of rendering and acceleration. Commands are logged against simulation time. All field positions are sampled together at leader sector boundaries for displayed gap estimates. Exact finish timestamps determine classification. The baseline reruns the complete race with no player calls; it does not claim to isolate individual decision effects.

## Deliberate prototype limits

This is a playable proof of concept, not the full design or an F1 physics model. Names, pace, weather, and scenario data are synthetic. The track drawing is schematic. There are ten cars, a single dry scenario, a scheduled debris safety car, and simplified passing, fuel and pit-lane models. Forecast confidence is scenario flavor, not a live prediction. Race rules such as mandatory compound changes, DRS, penalties, and lapped-car safety-car procedures are not implemented.

Trust is an outcome-based debrief indicator; it does not alter compliance. There is no persistent career, live weather, historical data import, team credibility model, optional LLM fallback, or per-decision counterfactual yet. Microphone and speech output need manual testing on the player's target browser and device.

Static output in `dist/` can be hosted without a backend. The repository includes a private Sites deployment manifest. The original GitHub remote is retained.
