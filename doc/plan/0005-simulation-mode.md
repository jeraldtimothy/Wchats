# 0005 — Simulation mode

Branch: `feat/0005-simulation-mode`

The owner wants to use the app end to end before real provider keys are available (the current keys are simulation keys). With `LLM_SIMULATION=1`, every provider is backed by a built-in simulated adapter instead of its SDK. Replies still flow through the normal pipeline (streaming, reconnect, titles, sources, billing, memories). It's off by default and clearly labelled in the UI.

## feat(providers): add a simulated provider behind LLM_SIMULATION
- [x] `SimulatedProvider` implementing `LLMProvider`: streamed Markdown reply naming the model; a thinking indicator and reasoning tokens by effort; web search → `tool.started` + placeholder `example.com` sources; attachments acknowledged; title and memory-job prompts answered in their expected formats; usage estimated from text length; honours abort
- [x] trigger phrases to demo error states: `[simulate refusal]`, `[simulate truncation]`, `[simulate error]`
- [x] `LLM_SIMULATION` env (+ `.env.example`); `createProvidersFromEnv` uses the simulator for all three providers when on; startup log line; `pnpm check-models` explains it's skipped
- [x] tests: adapter events per option and trigger, title/memory formats, registry wiring, a full post-message → complete → charged flow

## feat(web): label simulation mode
- [ ] `/api/me` `config.simulation`; a "Simulation mode" pill in the sidebar and a note in the model picker

## Wiki
- [ ] providers + getting-started: simulation mode, triggers, and that charges are recorded against simulated usage

## Done when
- [ ] `pnpm check` passes on the branch and on `main`
- [ ] smoke: with `LLM_SIMULATION=1`, a chat reply streams through the proxy for each provider, and a web-search reply carries sources
