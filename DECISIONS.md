# Implementation decisions

## 2026-11-12 — First playable prototype

- Treat the supplied design as product context, not as instructions overriding the user's request.
- Build in the existing nested Git checkout, preserving its GitHub origin.
- Use TypeScript + Vite with no runtime UI dependencies. The simulation is testable separately from rendering.
- Start with one fictional Barcelona scenario, ten cars, and two player drivers. Do not present generated performance as historical race data.
- Keep race outcomes authoritative in the seeded fixed-step simulation. Speech parsing never invents an outcome.
- Resolve ambiguity before issuing commands; preserve explicit car context; handle possessives and negated pit orders.
- Snapshot the whole field at sector boundaries. Independently stale positions caused false zero-second gaps during browser QA and were replaced by synchronized snapshots.
- Model pits as stationary time loss at a lap boundary; traffic and safety-car pace turn this into an approximate effective gap loss. Teammate arrivals can queue. This is a strategy approximation, not a spatial pit lane.
- Use real-time speeds of 1×/5×/15×/60×, return to 1× on flag changes, and pause when the tab is hidden.
- Use a same-seed, no-calls full-race baseline in the debrief. Avoid suggesting it measures the isolated effect of any one decision.
- Keep voice optional with text/button parity. Do not require API keys. Do not silently enable microphone or speech playback.
- Defer historical-data licensing, wet-weather modelling, deep trust/credibility, and LLM integration until this core loop is playtested.

## 2026-11-13 — Voice reliability, race presentation, meaningful debrief

- Observed the user's live radio log reporting a browser speech-service `network` error before any transcript. Added local Whisper transcription instead of repeatedly retrying the same service. Browser recognition remains selectable.
- Keep audio capture explicit, bounded, cancellable, and local in on-device mode. Download model files only when voice/check is requested. Include a synthetic audio check without microphone access or race effects.
- Use the synchronous ONNX WASM build in a dedicated worker, self-hosted below static-host per-file limits. The unused large asyncify fallback is omitted from deployment output. Preparation copies runtime files from the locked dependency; generated runtime files are ignored in Git.
- Add differentiated radio profiles, proactive simulator-grounded driver/engineer calls, procedural sound, pit projections and safety-car bunching. No generated audio assets or model output controls simulation outcomes.
- Share constructor colors across the map and timing tower. Add unique driver numbers, inspectable legend, and collision-separated map markers tethered to true track positions.
- Replace the misleading no-pit/no-calls baseline with a deterministic wear-aware default engineer that pits both cars.
- Evaluate 441 one-stop compound/lap pairs in a worker, plus the default, actual run, and valid per-call shifts. Rank by objectives, then points, then total finish time. Explicitly label search coverage and hindsight limits.
- Shift calls by one lap of the driver's original distance/time trace, not a fixed number of seconds. Preserve other call times and disclose reordered/conflicting commands and unavailable shifts.
- Key random noise to car/tick and stop variation to car/stop number so counterfactuals share stochastic conditions instead of consuming a shuffled global random stream.
