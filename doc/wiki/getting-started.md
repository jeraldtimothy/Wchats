# Getting started

## Prerequisites

- Node ≥ 22 (developed on Node 26) and pnpm (`npm i -g pnpm`).
- PostgreSQL 16 at `DATABASE_URL`. Either `docker compose up -d` (from `docker-compose.yml`) or any local PG16 with user `postgres` / password `postgres`.

## Setup

```sh
pnpm install
cp .env.example .env        # then set BETTER_AUTH_SECRET and any provider keys
pnpm db:migrate             # creates the database if needed and applies migrations (run again after pulling)
pnpm seed                   # models, users, accounts, starting credit (safe to re-run)
pnpm dev                    # API on :3000, web on :5173 (open http://localhost:5173)
```

A provider's models only appear once its key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) is set. Without any key the app runs, but the picker says no models are available.

**No real keys yet?** Set `LLM_SIMULATION=1` in `.env` and every model is answered by a built-in simulator; see [providers → simulation mode](providers.md#simulation-mode-simulatedts). Charges are recorded against simulated usage. Set it back to `0` once real keys are in.

Uploads are stored under `apps/api/storage` (gitignored) unless `STORAGE_DIR` is set.

## Seed accounts (development only)

| Email | Password | Role | Credit |
|---|---|---|---|
| `admin@litechat.local` | `admin-password-123` | manager; chat, simgen | $25 personal |
| `user@litechat.local` | `user-password-123` | user; chat, simgen | $5 personal |

Both are members of the shared account "Acme Research" ($100).

## Scripts (repo root)

| Script | What it does |
|---|---|
| `pnpm dev` | API (`tsx watch`) + web (Vite) |
| `pnpm check` | health check: typecheck, lint, test, build |
| `pnpm test` | API tests (Vitest; recreates `TEST_DATABASE_URL` each run) and web unit tests (Vitest + jsdom) |
| `pnpm db:generate` | new migration from `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | apply migrations to `DATABASE_URL` |
| `pnpm seed` | upsert models from `apps/api/seed/models.config.ts` (skipping models edited in IAM), users, accounts, credit |
| `pnpm seed --force-models` | the same, but the config overwrites IAM edits |
| `pnpm memories:run [--user <id>]` | run the nightly AI-memory job now |
| `pnpm check-models` | list each configured provider's models and mark which seeded ids exist |

## Model ids and prices

`apps/api/seed/models.config.ts` holds every provider model id, price and thinking budget, each marked `PLACEHOLDER`. Fill in real values, run `pnpm check-models`, then `pnpm seed`. A re-seed updates catalog fields from the config for every model **not** edited in IAM → Models. Edited models are listed and left alone unless you pass `--force-models`. Managers can also change ids and prices directly in IAM.

## Layout

`apps/api` (Fastify, Drizzle, pg-boss, providers), `apps/web` (React SPA), `packages/shared` (Zod schemas and types used by both, consumed as TS source).
