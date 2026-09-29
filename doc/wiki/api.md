# API

Fastify app in `apps/api/src/app.ts` (`buildApp(options)`). Process entry is `src/main.ts`, which recovers orphaned replies, starts pg-boss and listens on `PORT`.

## Errors

Every error is `{ "error": { "code", "message" } }` with codes from `packages/shared/src/errors.ts`. `HttpError` (`src/http/errors.ts`) carries status + code; `parse(schema, value)` (`src/http/validate.ts`) turns Zod failures into 400 `validation`.

## Guards (`src/auth/guards.ts`)

- `requireUser`: 401 `unauthorized` without a session; 403 `account_disabled` when `profiles.is_disabled`.
- `requireFrontend(app)`: 403 `forbidden` unless `app ∈ profiles.allowed_frontends`.
- `requireManager`: 403 unless `profiles.is_manager`.

## Routes

| Route | Guard | Notes |
|---|---|---|
| `* /api/auth/*` | none | Better Auth (email/password; Google when `GOOGLE_CLIENT_ID/SECRET` are set). Bridge in `src/auth/bridge.ts` forwards the raw body. |
| `GET /api/health` | none | `{ok:true}` after a DB ping |
| `GET /api/config` | none | `{googleAuthEnabled}` |
| `GET /api/me` | user | user, profile, billing accounts (`balanceCents`), `config.simgenUrl` |
| `GET /api/billing-accounts` | user | accounts the user belongs to |
| `GET /api/models` | user | picker catalog (non-retired, provider configured, `isFavorite`); no ids or prices exposed |
| `PUT/DELETE /api/models/:id/favorite` | user | 204 |
| `GET/POST /api/chat/v2/sessions` | chat | list / create (`{modelId, billingAccountId}`) |
| `GET/PATCH/DELETE /api/chat/v2/session/:id` | chat | detail / rename or `includeMemories` / soft delete |
| `POST /api/chat/v2/session/:id/post-message` | chat | 202; see [chat streaming](chat-streaming.md) |
| `GET /api/chat/v2/session/:id/listen` | chat | SSE; see [chat streaming](chat-streaming.md) |

Sessions belonging to other users, or deleted ones, return 404.

## Auth and provisioning

`src/auth/auth.ts` configures Better Auth with the Drizzle adapter over the stock `user/session/account/verification` tables. On user creation, `provisionUser` (`src/accounts/provision.ts`) creates the `profiles` row (username from the email local part) and the `[Personal] NAME` billing account, and grants `SIGNUP_CREDIT_USD` if it's set. A `session.create.before` hook blocks sign-in for disabled users. Cookies are `httpOnly`, prefixed `litechat`.
