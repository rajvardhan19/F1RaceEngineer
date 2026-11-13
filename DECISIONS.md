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
