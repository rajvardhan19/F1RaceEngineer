# Public-release voice experience

Approved direction: target the conversational feel of the user's Towerline reference. Plan for hosted services; review budget before enabling providers. Keep the existing private prototype and local mode available. No paid provider, credential, or public access is enabled by this plan.

The experience should be: hold the radio key, speak, release, hear the addressed teammate respond promptly. The team remembers the current subject, explains advice when asked why, asks only relevant questions, reads back accepted orders, and stops speaking immediately when interrupted. A new turn must supersede pending replies. Race control takes priority over casual chatter.

## Implementation sequence

1. Extract the existing voice input, team brain, and audio player behind provider interfaces. Keep the simulation and conversation state independent of providers. Preserve text/buttons and local fallback.
2. Add an authenticated server session service. Keep provider secrets on the server. Issue short-lived scoped session credentials where needed, with per-session limits, maximum call length, concurrent-session caps, and an enforced daily spending ceiling. Do not ship a long-lived key to browsers.
3. Stream microphone audio while the player holds the key; finalize transcription on release. Send each turn with a turn ID, addressed character, current race facts, pending question, and bounded conversation history. Cancel streaming and discard late responses on interruption, restart, disconnect, and new turns.
4. Generate a short in-character response grounded in authoritative race facts. Separate proposed structured actions from spoken wording. Validate car, action, compound, timing, and race state through the deterministic command layer. Ambiguous orders ask a question instead of mutating the race. Do not derive commands from generated prose.
5. Stream synthesized speech into the existing radio audio chain as it arrives; stable casting per character. Show transcript and connection state, recover from a disconnect without replaying old orders, and queue only still-relevant race events.
6. Measure press/release-to-first-audio latency, transcription accuracy, interruption latency, conversation continuity, and actual provider spend across desktop and mobile. These measurements are release gates, not claims about current performance.

## Before enabling services

Agree on an initial player count, average session duration, simultaneous-player limit, monthly budget, and a hard daily cap. Measure speech minutes and model tokens in a small private trial, then estimate cost per completed race with allowance for retries. Review provider retention settings and make the microphone upload behavior clear to players. Public access is a separate deployment decision.

## Current handoff

Claude's conversation/event separation, proactive questions, recorded team orders, and local model remain intact. This review added clarification continuity, topic follow-ups, named-answer isolation, protection against questions triggering swaps, and cancellation of obsolete AI turns. The local language model remains optional and device-dependent. Its numeric filter is a heuristic, not proof that every sentence is factually correct. Matching the reference's feel still needs measured hosted-provider trials and playtesting.
