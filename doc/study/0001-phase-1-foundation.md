# 0001 — Phase 1 foundation (LiteChat clone)

**Ask:** Build "LiteChat Clone" (metered, pay-as-you-go access to OpenAI, Anthropic and Gemini models) on the owner's fixed stack. Phase 1 covers the monorepo scaffold, DB schema and migrations, auth, seed data, sidebar layout, the provider layer (three adapters), the model catalog and picker, sessions CRUD, streaming chat (post-message + listen SSE with reconnect), Markdown rendering, thinking effort, the billing ledger with per-message charging and a balance gate, and auto-titles. The full spec is summarised in [ARCHITECTURE.md](../../ARCHITECTURE.md).

**Feasibility:** The repo is empty and the stack is fixed, so the only blockers were environmental:

| Spec                 | This machine                    | Resolution (owner-approved where noted)                                                                  |
| -------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Node 22              | Node 26.5                       | **Owner chose** to use Node 26 as-is. `engines.node` is `>=22`.                                           |
| Docker Compose + PG16 | No Docker; brew can't reach ghcr.io | **Owner chose** native PG16. Brew bottles fail (DNS), so PG 16.14 native binaries were installed from npm (`@embedded-postgres/darwin-arm64`) outside the repo. `docker-compose.yml` still ships. |
| TypeScript (latest)  | TS 7.0 (Go port)                | Pin TS 6.0.x: typescript-eslint supports `<6.1`, and the lint health check needs it.                          |

Provider SDK versions (openai 7, @anthropic-ai/sdk 0.129, @google/genai 2, pg-boss 12, Better Auth 1.7, React Router 8, Zod 4) are newer than the author's reference material. Adapters are verified against the installed `.d.ts` files and mocked-SDK tests, not against memory.

## Options

Only one design question has real alternatives: how reply generation runs as a "server-side job" behind `post-message`/`listen`.

| Option | Pros | Cons | Cost |
| ------ | ---- | ---- | ---- |
| A. pg-boss job per reply; worker publishes deltas via Postgres LISTEN/NOTIFY | Survives process split; durable queue | pg-boss polling adds ≥0.5s latency before the first token; replay-on-reconnect needs every delta persisted or a race-free snapshot across processes | High |
| B. In-process `GenerationRunner` detached from the HTTP request, with an in-memory event hub holding each in-flight message's accumulated state. pg-boss for durable background work (titles, later memories) | First token immediately; an atomic snapshot + subscribe (single-threaded) makes reconnect replay exact; simple | Single API process owns in-flight generations; a crash loses the in-flight reply (recovered to an error state on boot) | Low |
| C. Stream directly in the HTTP response of post-message | Simplest | Violates the spec (no reconnect, generation tied to request) | Lowest |

## Recommendation

**B.** It meets the spec's contract: generation outlives the request, and `listen` replays the in-progress message on reconnect, with the best latency. The event hub sits behind a `ChatEventHub` interface, so a NOTIFY/Redis-backed hub can replace it when there are several API instances. pg-boss still runs the jobs that should be durable (title generation now; nightly memories and agent runs later).

Other calls, made without blocking (all recorded in ARCHITECTURE.md → "Decisions"):
- App-specific user fields live in a `profiles` table next to Better Auth's `user` table, not in Better Auth `additionalFields`.
- Balance is cached on `billing_accounts.balance_nano_usd` and updated in the same transaction as each ledger insert. Cents are derived for display.
- Charges are post-paid per request; a reply can take the balance below zero, and the next send is then blocked.
- Title generation is charged to the session's account like any other usage.
- Sessions are soft-deleted, so the ledger's message references stay auditable.

## Open questions

None blocking. Model ids and prices are placeholders the owner will fill in; `pnpm check-models` validates them.
