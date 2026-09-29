# Architecture — LiteChat Clone

LiteChat Clone gives non-power users metered, pay-as-you-go access to LLMs from OpenAI, Anthropic and Google, so they don't need a monthly subscription. This document is the target design for all four phases. Sections are marked with the phase that builds them (**P1**–**P4**). For what exists in code today, see [doc/wiki/](doc/wiki/README.md).

## 1. Repository layout

```
apps/
  api/                 Fastify API, jobs, provider layer, DB (Drizzle)
    drizzle/           generated SQL migrations (committed)
    seed/              models.config.ts (placeholder ids and prices), seed script
    src/
      auth/            Better Auth instance + Fastify bridge + guards
      billing/         pricing math, ledger service, balance gate
      chat/            sessions, messages, generation runner, event hub, SSE
      db/              schema.ts, client, migrate
      jobs/            pg-boss boot + workers (titles; memories P4)
      models/          catalog queries, favorites, check-models script
      providers/       LLMProvider interface + openai / anthropic / gemini adapters
      storage/         Storage interface + local-disk implementation (P2)
  web/                 React + Vite SPA
    src/
      api/             fetch client + TanStack Query hooks + SSE client
      components/      Sidebar, ModelPicker, Chat, Markdown, …
      routes/          page components
packages/
  shared/              Zod schemas + TS types used by both apps (API contracts, SSE events, enums)
docker-compose.yml     Postgres 16 (for machines with Docker)
.env.example
```

The workspace is a pnpm monorepo, TypeScript everywhere. `packages/shared` is consumed as TS source through workspace `exports`, so neither app needs a build step to use it.

## 2. Runtime overview

```
Browser (Vite SPA, :5173) ──/api proxy──▶ Fastify API (:3000)
                                             │
                     ┌───────────────────────┼─────────────────────────┐
                     ▼                       ▼                         ▼
              Better Auth             GenerationRunner ──▶ LLMProvider adapters ──▶ OpenAI / Anthropic / Gemini
            (cookie sessions)         │   (in-process)
                                      ├─▶ ChatEventHub ──▶ SSE /listen subscribers
                                      └─▶ Billing (ledger tx) ──▶ PostgreSQL 16 ◀── pg-boss (titles, memories, agent)
```

In development, Vite proxies `/api` to the API, so the browser sees a single origin and cookies are plain first-party `httpOnly`, `SameSite=Lax` cookies.

## 3. Data model (PostgreSQL + Drizzle)

All ids are `uuid` (`gen_random_uuid()`) except Better Auth's tables, which use its text ids. Timestamps are `timestamptz`. Money is always an integer: **nano-USD in `bigint`** (1 USD = 10⁹ nano-USD). Cents are derived for display only.

### Auth (Better Auth, P1)
`user`, `session`, `account`, `verification` follow Better Auth's standard Drizzle schema. Email/password is always on; Google OAuth is enabled only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

### `profiles` (P1)
One row per user, created in Better Auth's `user.create.after` hook.

| column | type | notes |
|---|---|---|
| user_id | text PK → user.id | |
| username | text unique | derived from email local-part, de-duplicated |
| is_manager | bool default false | gates IAM |
| allowed_frontends | text[] default `{chat,ask}` | subset of `chat`, `ask`, `simgen` |
| is_disabled | bool default false | disabled users get 403 on every app route |
| default_app | text default `chat` | `simgen`, `ask` or `chat` (P2 UI) |
| global_system_prompt | text default '' | (P2 UI) |
| generate_ai_memories | bool default false | (P4 job) |

### `models` (P1)
Seeded from `apps/api/seed/models.config.ts` and upserted by the `slug` key. Editable in IAM (P3).

| column | type |
|---|---|
| id | uuid PK |
| slug | text unique (stable seed key, e.g. `gpt-5.6-sol`) |
| provider | enum `openai`, `anthropic`, `google` |
| provider_model_id | text |
| display_name, description | text |
| tier | enum `value`, `standard`, `premium` |
| reasoning_efforts | text[] (subset of `none`, `low`, `medium`, `high`, `xhigh`) |
| default_effort | text null |
| thinking_budgets | jsonb (Anthropic: `{low,medium,high,xhigh}` → budget_tokens; Gemini: → thinkingBudget) |
| max_output_tokens | int |
| supports_images, supports_documents, supports_multi_turn_tools, web_search_enabled | bool |
| input_usd_per_mtok, cached_input_usd_per_mtok, output_usd_per_mtok, web_search_usd_per_call | numeric(12,6) |
| is_retired, agent_enabled | bool |
| sort_order | int |
| created_at, updated_at | timestamptz |

`model_favorites (user_id, model_id, created_at)` has PK `(user_id, model_id)`.

### Billing (P1)
- **`billing_accounts`**: `id`, `name`, `kind` (`personal`/`shared`), `owner_user_id` (personal only; unique where kind = personal), `is_disabled`, `balance_nano_usd bigint` (cache of the ledger sum), `created_at`.
- **`billing_account_members`**: `(billing_account_id, user_id)` PK and `added_at`. Personal accounts have their owner as the only member.
- **`ledger_entries`** is append-only. There are no UPDATE or DELETE paths in code.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| billing_account_id | uuid FK | |
| kind | enum `credit_grant`, `usage_charge`, `refund`, `adjustment` | |
| amount_nano_usd | bigint | signed: grants > 0, charges < 0 |
| balance_after_nano_usd | bigint | balance snapshot, for easy statements |
| user_id | text null | whose usage / who received it |
| message_id | uuid null FK → messages | for usage charges |
| created_by | text null | manager who granted/adjusted |
| reason | text null | required for grants/adjustments |
| source | text default `manual` | `manual`, `usage`, `seed`, later `stripe` |
| external_ref | text null, unique | idempotency key (Stripe payment id later) |
| created_at | timestamptz | |

### Chat (P1)
- **`chat_sessions`**: `id`, `user_id`, `model_id`, `billing_account_id`, `title` (null until generated), `include_memories bool`, `created_at`, `last_activity_at`, `deleted_at` (soft delete), `crawled_at` (P4).
- **`messages`**

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| session_id | uuid FK | |
| role | enum `user`, `assistant` | |
| status | enum `pending`, `streaming`, `complete`, `truncated`, `refused`, `error` | |
| content | text | user text, or accumulated assistant text |
| options | jsonb | on user messages: `{effort, webSearch, multiTurn}` |
| sources | jsonb | `[{url,title}]` from tool.sources (P2) |
| error_code | text null | `insufficient_credit`, `provider_error`, `interrupted`, … |
| error_message | text null | |
| usage | jsonb null | normalized `Usage` |
| usage_raw | jsonb null | the provider's raw usage object, verbatim |
| pricing | jsonb null | price snapshot + markup used for the charge |
| cost_nano_usd | bigint null | computed charge (after markup) |
| created_at, completed_at | timestamptz | |

Later: `attachments` (P2: id, user_id, message_id, kind, mime, filename, size, storage_key, extracted_text), `memory_items` (P2: id, user_id, type, content, ai_generated, source_session_id), `ask_history` (P3), `agent_runs` + `agent_run_events` (P4).

pg-boss keeps its own `pgboss` schema.

## 4. API routes

Every route except `/api/auth/*` and `/api/health` requires a session. Guards:
- `requireUser`: 401 without a session, 403 when `profile.is_disabled`.
- `requireFrontend(app)`: 403 unless `app ∈ allowed_frontends`.
- `requireManager`: 403 unless `is_manager`.

Request and response bodies are Zod schemas in `packages/shared`.

| Method & path | Phase | Purpose |
|---|---|---|
| `* /api/auth/*` | P1 | Better Auth (sign-up/in/out, Google OAuth callback, session) |
| `GET /api/health` | P1 | liveness + DB check |
| `GET /api/config` | P1 | public config for the login page (`googleAuthEnabled`) |
| `GET /api/me` | P1 | user, profile, billing accounts (with `balanceCents`) |
| `GET /api/models` | P1 | picker catalog: non-retired, provider configured, `isFavorite` per row |
| `PUT / DELETE /api/models/:id/favorite` | P1 | toggle favorite |
| `GET /api/billing-accounts` | P1 | accounts the user belongs to |
| `GET /api/chat/v2/sessions` | P1 | user's sessions, newest activity first |
| `POST /api/chat/v2/sessions` | P1 | `{modelId, billingAccountId}` → session (model is fixed afterwards) |
| `GET /api/chat/v2/session/:id` | P1 | session + model + messages |
| `PATCH /api/chat/v2/session/:id` | P1 | `{title?, includeMemories?}` |
| `DELETE /api/chat/v2/session/:id` | P1 | soft delete |
| `POST /api/chat/v2/session/:id/post-message` | P1 | `{text, effort?, webSearch?, multiTurn?, attachmentIds?}` → `202 {userMessage, assistantMessage}` |
| `GET /api/chat/v2/session/:id/listen` | P1 | SSE stream (section 5) |
| `POST /api/uploads` | P2 | multipart upload → attachment id |
| `GET/PUT /api/profile`, `/api/memories` CRUD | P2 | profile page |
| `POST /api/ask` (+ `GET /api/ask/:id/listen`) | P3 | one-shot Q&A |
| `/api/iam/users`, `/api/iam/billing-accounts`, `/api/iam/models`, `/api/iam/usage(.csv)` | P3 | manager console |
| `POST /api/agent-run`, `GET /api/agent-run/:id`, `GET /api/agent-run/:id/events`, `POST /api/agent-run/:id/cancel` | P4 | agent mode |

### post-message flow (P1)
1. Load the session. It must be owned by the user, not deleted, and its model must not be retired (409 `model_retired`).
2. **Balance gate**: the account must be active, the user must be a member, and `balance_nano_usd > 0`. Otherwise respond 402 `insufficient_credit` (or 403 `account_disabled`).
3. Reject if a reply is already `streaming` in this session (409 `busy`).
4. In one transaction that holds a `FOR UPDATE` lock on the session row (so concurrent sends serialize), insert the user message (`complete`) and the assistant message (`pending`) with explicit timestamps (the reply's is 1 ms later, which keeps the pair ordered), then bump `last_activity_at`.
5. Hand the assistant message id to `GenerationRunner.start()` without awaiting it, and return 202.

## 5. Streaming: GenerationRunner, ChatEventHub, SSE

**GenerationRunner** (in-process, detached from the HTTP request):
1. Build the `ChatRequest`: system prompt (section 7), history of prior `complete`/`truncated` turns, the new user turn, effort, and tools.
2. `for await` the adapter's normalized events and forward each to the hub, which assigns a per-message `seq`.
3. Flush the accumulated `content` to the DB at most every 750 ms, and at the end.
4. On `done`: set the final status from the stop reason, then charge (section 8) in the same transaction that writes `usage`, `usage_raw`, `pricing` and `cost_nano_usd`. Publish `done`.
5. On error: if usage is known, still charge it; set `status=error`; publish `error`.
6. After the first successful assistant reply in a session, enqueue the pg-boss job `generate-title`.

On boot, any message still in `pending` or `streaming` is an orphan from a crash. It is set to `error` with the code `interrupted`.

**ChatEventHub** (`interface ChatEventHub { publish; snapshot; subscribe }`), in-memory implementation. It keeps an `InflightState {messageId, seq, content, status, sources, thinking}` per in-flight message, keyed by session, and a subscriber set per session. Node is single-threaded, so `snapshot()` followed by `subscribe()` in the same tick means no event can fall between them. That's what makes reconnect replay exact. In-flight state is dropped 30 s after the terminal event.

**SSE format** (`text/event-stream`). Each event:
```
id: <messageId>:<seq>
event: <type>
data: <JSON>
```

| event | data | notes |
|---|---|---|
| `snapshot` | `{inflight: {messageId, seq, content, status, thinking, sources} \| null}` | always first on (re)connect |
| `message.started` | `{messageId}` | generation began |
| `text.delta` | `{messageId, seq, text}` | append |
| `thinking` | `{messageId, seq, active: true}` | the model is reasoning; reasoning text is **never** sent |
| `tool.started` | `{messageId, seq, tool: "web_search", query?}` | |
| `tool.sources` | `{messageId, seq, sources: [{url, title?}]}` | rendered as footnotes/chips (P2) |
| `refusal` | `{messageId, seq, message?}` | terminal status `refused` follows in `done` |
| `error` | `{messageId, seq, code, message}` | terminal |
| `done` | `{messageId, seq, status, stopReason, usage, costNanoUsd, balanceCents}` | terminal |
| `session.updated` | `{sessionId, title}` | auto-title landed; the sidebar updates live |

The stream opens with `retry: 2000`, and the server sends `: ping` every 15 s. The client uses `EventSource` (cookies are sent same-origin) and reconnects automatically. On every `snapshot` it replaces the in-flight bubble's content, so a reconnect restores the partial reply and then continues with live deltas. Once a message is terminal, the client refetches the session to pick up the persisted row.

## 6. Provider layer

The rest of the app imports only `providers/index.ts`. No provider SDK is used anywhere else.

```ts
type Provider = 'openai' | 'anthropic' | 'google';
type Effort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string /* base64 */ }
  | { type: 'document'; mediaType: 'application/pdf'; data: string; filename: string };

interface ChatMessage { role: 'user' | 'assistant'; parts: ContentPart[] }

interface ChatRequest {
  model: string;                 // provider_model_id
  system: string;
  messages: ChatMessage[];       // consecutive same-role turns are merged by the adapter
  effort: Effort;
  thinkingBudgets?: Partial<Record<Effort, number>>;
  maxOutputTokens: number;
  webSearch: boolean;
  multiTurnTools: boolean;
  signal?: AbortSignal;
}

interface Usage {
  inputTokens: number;           // uncached input only
  cachedInputTokens: number;
  outputTokens: number;          // visible output, excluding reasoning where the provider separates it
  reasoningTokens: number;
  webSearches: number;
}

type StopReason = 'complete' | 'max_tokens' | 'refusal' | 'error';

type ProviderEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'reasoning.delta'; text?: string }     // counted, never shown
  | { type: 'tool.started'; tool: 'web_search'; query?: string }
  | { type: 'tool.sources'; sources: { url: string; title?: string }[] }
  | { type: 'refusal'; message?: string }
  | { type: 'error'; message: string; usage?: Usage; raw?: unknown }
  | { type: 'done'; stopReason: StopReason; usage: Usage; rawUsage: unknown };

interface LLMProvider {
  readonly id: Provider;
  isConfigured(): boolean;       // key present in env
  streamChat(req: ChatRequest): AsyncIterable<ProviderEvent>;
  listModels(): Promise<string[]>;
}
```

| | OpenAI | Anthropic | Google Gemini |
|---|---|---|---|
| SDK call | `responses.create({stream:true})` | `messages.stream()` | `models.generateContentStream()` |
| Effort | `reasoning: {effort}`; omitted for models without efforts | `none` = no thinking; a configured budget → `thinking: {type:'enabled', budget_tokens}` (max_tokens grows by the budget); no budget → `thinking: {type:'adaptive'}` + `output_config.effort` | `none` = `thinkingBudget: 0`; a configured budget → `thinkingBudget`; no budget → `thinkingLevel` (LOW/MEDIUM/HIGH) |
| Web search (P2) | built-in `web_search` tool; `web_search_call` action sources + `url_citation` annotations → sources; searches = completed `web_search_call` items | server tool `web_search_20250305`; `web_search_tool_result` blocks + citations → sources | `googleSearch` tool; `groundingMetadata.groundingChunks` → sources; searches = distinct `webSearchQueries` |
| Multi-turn tools | not applied: the SDK's create params expose no `max_tool_calls` (D14) | `max_uses` 1 vs 5 | n/a (grounding is single-shot) |
| Images / PDFs (P2) | `input_image` / `input_file` parts | `image` / `document` blocks | `inlineData` parts |
| Refusal | `refusal` content / `content_filter` | `stop_reason: refusal` | `finishReason: SAFETY`, `blockReason` |
| Usage mapping | input = `input_tokens − cached_tokens`; output = `output_tokens − reasoning_tokens` | input = `input_tokens + cache_creation_input_tokens`; cached = `cache_read_input_tokens`; output = `output_tokens − output_tokens_details.thinking_tokens`; reasoning = `thinking_tokens`; searches = `server_tool_use.web_search_requests` | input = `promptTokenCount − cachedContentTokenCount + toolUsePromptTokenCount`; output = `candidatesTokenCount`; reasoning = `thoughtsTokenCount` |

The `(output + reasoning) × output price` formula is correct for all three mappings above. Office files (docx/xlsx/pptx) are converted to text server-side (P2) before any adapter sees them. When a provider's key is missing, `isConfigured()` is false, its models are filtered out of `/api/models`, and new sessions can't be created for them. The app keeps running.

Base URLs: `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and `GEMINI_BASE_URL` are passed to the SDK constructors when set. Keys are read only from env and are never logged: Fastify's logger redacts `authorization`, `x-api-key`, `x-goog-api-key` and cookies.

`pnpm check-models` calls every configured provider's list-models endpoint and prints ✓ or ✗ for each seeded `provider_model_id`.

## 7. System prompt assembly

The parts are joined with blank lines:
1. Base prompt (`apps/api/src/chat/prompts.ts`).
2. The user's Global System Prompt, if non-empty (P2 UI; the column exists in P1).
3. The user's memory items, if the session's Include Memories is on (P2).
4. `Today's date is <weekday, month day, year>.`

## 8. Billing flow

```
base_nano = (input × in_price + cached × cached_price + (output + reasoning) × out_price) × 1000
          + searches × search_fee × 1e9
cost_nano = ceil(base_nano × MARKUP)
```
Prices are USD per million tokens (per call for search). Scaling: `tokens × usd_per_mtok × 1e9 / 1e6 = tokens × usd_per_mtok × 1000` nano-USD. The math uses `BigInt`. Prices are parsed from their exact `numeric` strings into integer micro-USD, and `MARKUP` (env, default `1.25`) into basis points. There's no floating point anywhere, and the result rounds up to the next nano-USD.

**Charging** (`billing/ledger.ts: charge()`), in one transaction:
1. `UPDATE billing_accounts SET balance_nano_usd = balance_nano_usd - $cost WHERE id = $acct RETURNING balance_nano_usd`. This takes the row lock.
2. `INSERT ledger_entries (kind 'usage_charge', amount -cost, balance_after, user_id, message_id)`.
3. `UPDATE messages SET usage, usage_raw, pricing, cost_nano_usd, status`.

Grants and adjustments use the same two first steps, through `grantCredit({accountId, amountNano, kind, reason, createdBy, source, externalRef})`. That function is the **Stripe seam**: a future webhook calls it with `source:'stripe'` and `externalRef = payment_intent id`, and the unique index makes retries idempotent.

**Gate**: sending requires that the account isn't disabled, the user is a member, and `balance_nano_usd > 0`. Charges are post-paid, so a single reply can push the balance negative; the next send is then blocked with 402 and the inline "insufficient credit" error. `pnpm billing:verify` (P3) recomputes every account's `SUM(ledger)` and compares it with the cache.

Every account holder's display balance is `floor(balance_nano / 10⁷)` cents.

## 9. Background jobs (pg-boss)

| queue | trigger | phase |
|---|---|---|
| `generate-title` | the first complete assistant reply in a session. Uses the cheapest configured, non-retired model (lowest input + output price) with a short prompt, charges the session's account, updates `chat_sessions.title`, and publishes `session.updated`. Retries 2×. | P1 |
| `crawl-memories` | nightly cron. Reads users with `generate_ai_memories` and sessions where `crawled_at IS NULL OR last_activity_at > crawled_at`, and proposes AI memory items. | P4 |
| `agent-run` | agent mode steps | P4 |

## 10. Web app

- Routes: `/login`, `/chat`, `/chat/:sessionId`, `/ask` (P3), `/profile` (P2), `/iam` (P3, managers). After login the user lands on `profile.default_app` (SimGen is external, so it falls back to `/chat`). A route whose frontend isn't allowed renders the 403 page, and the API enforces the same rule.
- Layout: a 300 px white sidebar (logo + logout; APPS; ACCOUNT; SESSIONS) and the main area. Below 768 px the sidebar and chat are separate full-screen views, with "Back to sessions".
- Data: TanStack Query for REST, plus a custom `useSessionStream(sessionId)` hook wrapping `EventSource` that feeds a small reducer. It patches the sessions list cache on `session.updated`.
- Markdown: `marked` (GFM) → `DOMPurify.sanitize` → `highlight.js` on code blocks, plus a copy button injected per `<pre>`. Assistant HTML is only ever set from sanitized output.
- Theme: Tailwind v4 `@theme` tokens mapped to the spec's CSS variables (`--blue`, `--dark`, …), with radii 4/8/12 and soft shadows. Fredoka for the logo and headings, Inter for body text, Helvetica Neue for uppercase section labels.

## 11. Configuration (.env)

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (API origin), `WEB_ORIGIN`, `GOOGLE_CLIENT_ID/SECRET` (optional), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_BASE_URL`/`ANTHROPIC_BASE_URL`/`GEMINI_BASE_URL` (optional), `MARKUP` (default 1.25), `SIGNUP_CREDIT_USD` (default 0), `SIMGEN_URL`, `STORAGE_DIR` (P2), `PORT`.

## 12. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Node 26 instead of 22 (`engines >=22`) | Owner's choice, since Node 26 is installed. |
| D2 | Local dev Postgres is native PG 16.14 from npm-distributed binaries; `docker-compose.yml` still ships | No Docker, and Homebrew can't reach ghcr.io on this network. Owner chose native PG16. |
| D3 | TypeScript pinned to 6.0.x | typescript-eslint doesn't support TS 7 yet. |
| D4 | Reply generation runs in an in-process `GenerationRunner` with an in-memory `ChatEventHub`; pg-boss handles titles, memories and agent runs | First-token latency and exact reconnect replay (see study 0001). The hub interface allows a multi-instance swap. |
| D5 | App fields live in `profiles`, not Better Auth `additionalFields` | Keeps the auth schema stock and decoupled. |
| D6 | The balance is cached in nano-USD on the account and updated in the ledger transaction; cents are derived | The cache stays exactly equal to the ledger sum. |
| D7 | Post-paid per-request charging; the balance may go negative once | Cost is only known after the reply. The gate stops the next send. |
| D8 | Title generation is charged | All provider spend is auditable in the ledger. |
| D9 | Sessions are soft-deleted | Ledger → message references stay valid for audits. |
| D10 | Anthropic cache-creation tokens are billed at the input price | The spec's formula has no cache-write term. This is a slight undercharge versus Anthropic's 1.25× write price, and the raw usage is stored for recalculation. |
| D11 | New sign-ups get a personal account with `SIGNUP_CREDIT_USD` (default 0) | There's no payment processor yet, so managers grant credit. |
| D12 | ESLint + typescript-eslint for lint | The health check needs lint and the spec doesn't name a linter. |
| D13 | Server-side retired-model enforcement and the read-only banner ship in P1 | Correctness (no sends to retired ids). Polish stays in P4. |
| D14 | "Allow multiple turns" isn't applied for OpenAI | openai@7 `responses.create` params have no `max_tool_calls`. Anthropic uses `max_uses`. Revisit when the SDK exposes the limit. |
| D15 | Effort falls back to the provider's native control when a model has no configured budget (Anthropic adaptive thinking + `output_config.effort`; Gemini `thinkingLevel`) | Newer Claude and Gemini models favour these over fixed budgets. Budgets in the seed config still win when set. |
| D16 | `buildApp` runs title jobs in-process by default; `main.ts` swaps in the pg-boss queue | Tests and scripts don't need a pg-boss worker. Production titles stay durable, with retries. |
| D17 | A refused or failed exchange is left out of later requests' history | Matches "Rephrase it before continuing": the declined prompt isn't replayed to the provider. |
