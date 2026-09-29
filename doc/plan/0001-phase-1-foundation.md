# 0001 — Phase 1 foundation

Study: [doc/study/0001-phase-1-foundation.md](../study/0001-phase-1-foundation.md)
Design: [ARCHITECTURE.md](../../ARCHITECTURE.md)
Branch: `feat/0001-phase-1-foundation`

## build: scaffold pnpm monorepo with health check
- [x] root `package.json` (engines node >=22, scripts: dev, typecheck, lint, test, build, check, db:*, seed, check-models), `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint flat config, `.gitignore`, `.nvmrc`
- [x] `packages/shared` (Zod, exports TS source), `apps/api` (Fastify hello), `apps/web` (Vite React hello)
- [x] `docker-compose.yml` (postgres:16), `.env.example`
- [x] Vitest wired in `apps/api` with one smoke test
- [x] CLAUDE.md health check: `pnpm check`

## feat(db): add Drizzle schema and initial migration
- [x] `apps/api/src/db/schema.ts`: Better Auth tables, profiles, models, model_favorites, billing_accounts, billing_account_members, ledger_entries, chat_sessions, messages
- [x] `drizzle.config.ts`, generated migration in `apps/api/drizzle/`, `pnpm db:migrate`
- [x] env loader with Zod validation (`src/env.ts`)

## feat(auth): add Better Auth with profiles, personal accounts and guards
- [x] Better Auth (email/password, Google when configured), Fastify bridge on `/api/auth/*`
- [x] `user.create.after` hook → profile + `[Personal] <NAME>` account + membership (+ `SIGNUP_CREDIT_USD`)
- [x] guards `requireUser`, `requireFrontend`, `requireManager`; `GET /api/me`, `GET /api/health`
- [x] key/cookie redaction in logger

## feat(billing): add pricing math, ledger service and balance gate
- [x] `computeCostNano(usage, prices, markup)` BigInt math + tests
- [x] `grantCredit()` / `charge()` transactional ledger + cached balance; `assertCanSpend()` gate
- [x] integration tests against the test DB (ledger sum == cached balance; gate cases)
- [x] `GET /api/billing-accounts`

## feat(providers): add LLM provider layer with OpenAI, Anthropic and Gemini adapters
- [ ] `providers/types.ts` interface + registry (`isConfigured`, hidden when key missing)
- [ ] OpenAI Responses adapter, Anthropic Messages adapter, Gemini generateContentStream adapter (effort mapping, stop-reason + usage normalization, web search + sources, image/PDF parts)
- [ ] a mocked-SDK unit test per adapter
- [ ] `pnpm check-models` script

## feat(models): add model catalog, seed data and favorites
- [ ] `seed/models.config.ts` with clearly marked placeholder ids/prices/thinking settings (5 OpenAI, 3 Anthropic, 3 Google)
- [ ] `pnpm seed`: upsert models; admin + normal user; personal + shared accounts with starting credit
- [ ] `GET /api/models`, `PUT/DELETE /api/models/:id/favorite` + test

## feat(chat): add sessions, post-message generation and listen SSE
- [ ] sessions CRUD routes (soft delete), retired-model 409
- [ ] system prompt assembly (base + global prompt + date)
- [ ] `ChatEventHub` (in-memory, atomic snapshot/subscribe) + `GenerationRunner` (flush, charge, orphan recovery)
- [ ] `post-message` with gate / busy checks; `listen` SSE with snapshot replay + heartbeats
- [ ] pg-boss boot + `generate-title` job → `session.updated`
- [ ] tests: hub replay, post-message → done → charged (fake provider), insufficient credit 402

## feat(web): add app shell, auth pages and sidebar layout
- [ ] Tailwind v4 theme from the spec's CSS variables, fonts, logo mascot
- [ ] API client + TanStack Query, login/sign-up page (email + Google button when enabled)
- [ ] sidebar (APPS / ACCOUNT / SESSIONS with rename + delete-confirm), role-based nav, 403 page, placeholder Ask/Profile/IAM pages, mobile collapse

## feat(web): add model picker with cards and compact views
- [ ] modal "Select a Model", billing account dropdown + helper text
- [ ] cards grouped by provider with tier pills; compact sortable table with favorite stars (favorites first)
- [ ] selecting a model creates the session and navigates to it

## feat(web): add streaming chat view
- [ ] message list (user right/light-blue, assistant left/grey), sanitized Markdown + highlight.js + code copy, message copy + toast, scroll-to-bottom
- [ ] composer: model pill, thinking effort select, Enter/Shift+Enter
- [ ] `useSessionStream` SSE hook with reconnect replay; inline refusal/truncated/insufficient-credit errors
- [ ] retired-model read-only banner; empty state tile

## Wiki
- [ ] `doc/wiki/README.md` index + pages: getting-started, api, chat-streaming, providers, billing, web

## Done when
- [ ] `pnpm check` passes on the branch and on `main`
- [ ] manual smoke: seed, log in, pick a model, stream a reply (or a clean "provider not configured" path without keys), balance decreases
