# Chat streaming

Code: `apps/api/src/chat/` (`runner.ts`, `hub.ts`, `sessions.ts`, `titles.ts`, `prompts.ts`) and `src/routes/chat.ts`.

## post-message

`POST /api/chat/v2/session/:id/post-message` with `{text, effort?, webSearch?, multiTurn?, attachmentIds?}`:

1. The session must be owned and not deleted. A retired model returns 409 `model_retired`; an unconfigured provider returns 409 `model_unavailable`. Attachments must be the user's own unsent uploads that the model can read ([attachments](attachments.md)); text may be empty when files are attached.
2. `effort` must be one of the model's `reasoning_efforts`. The default is `default_effort`; models without efforts get none.
3. Balance gate (`assertCanSpend`): 402 `insufficient_credit`, 403 `billing_account_disabled`, or 403 when the user isn't a member.
4. In one transaction holding a `FOR UPDATE` lock on the session row: 409 `busy` if a reply is pending or streaming; otherwise insert the user message (`complete`, with `options` `{effort, webSearch, multiTurn}`, each tool kept only if the model supports it), link the attachments, and insert the assistant message (`pending`, 1 ms later).
5. `GenerationRunner.start()`, then respond 202 `{userMessage, assistantMessage}`.

## GenerationRunner

This is a server-side job detached from the request. It:

- builds the request: system prompt (base + Global System Prompt + memories if Include Memories is on + date), history with each user turn's attachments as parts (refused or failed exchanges are dropped), effort and budgets, and web search / multi-turn from the user message's options;
- sets the reply to `streaming` and publishes `message.started`;
- forwards `text.delta`, `thinking` (once per reasoning phase; reasoning text is never sent or stored), `tool.started`, `tool.sources` and `refusal` to the hub;
- checkpoints `content` and `sources` to the DB every 750 ms;
- on the terminal event, in one transaction: charges usage (even for errors, if usage was reported), then writes status, content, `usage`, `usage_raw`, `pricing`, `cost_nano_usd` and the error code/text;
- publishes `done` (`complete`/`truncated`/`refused`, with cost and new balance) or `error`;
- enqueues `generate-title` after the first answered reply while the title is still null.

Stop reasons map `complete → complete`, `max_tokens → truncated`, `refusal → refused` and `error → error`. The inline texts live in `CHAT_ERROR_TEXT` (shared). A crash inside the runner marks the reply `error/internal`. On boot, `recoverOrphans` marks leftover `pending`/`streaming` replies `error/interrupted`.

## ChatEventHub (`InMemoryChatEventHub`)

It holds the in-flight state `{messageId, seq, status, content, thinking, sources}` per session and a listener set per session. `snapshotAndSubscribe` is synchronous, so the snapshot plus later events always rebuild the reply exactly. `finish()` publishes the terminal event and drops the state. It lives in memory and serves one API process; the interface is the seam for a NOTIFY/Redis hub.

## listen SSE

`GET /api/chat/v2/session/:id/listen` hijacks the response and writes `retry: 2000`, then `snapshot` (`{inflight}` or `null`), then live events as `id: <messageId>:<seq>` / `event: <type>` / `data: <json>`. It sends `: ping` every 15 s. Event types are `ChatStreamEvent` in `packages/shared/src/chat.ts`. The server is built with `forceCloseConnections` so open streams don't block shutdown.

## Titles (`titles.ts`)

`generateTitle` uses the cheapest configured, non-retired model (lowest input + output price) at its lowest effort. It cleans the output (first line, no quotes or trailing punctuation, ≤ 80 chars), falls back to the start of the user's message, and charges the session's account with reason `Session title (<model>)`. It sets the title only if it's still null, then publishes `session.updated`. Queues: `InlineTitleQueue` (the default in `buildApp`, used by tests) and pg-boss `generate-title` (`src/jobs/boss.ts`, retry 2, `singletonKey` per session), which `main.ts` wires in.
