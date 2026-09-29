# IAM and Billing

Manager console at `/iam` (web: `routes/iam/`; API: `apps/api/src/routes/iam/`). Every `/api/iam/*` route runs `requireUser` + `requireManager`. There's a single tenant: managers see every user and account.

## Users (`users.ts`, `UsersTab.tsx`)

- `GET /api/iam/users?q=&limit=&offset=`: search by name, email or username (LIKE wildcards in `q` are escaped). Each user includes their billing accounts.
- `PATCH /api/iam/users/:id` with any of `isDisabled`, `isManager`, `allowedFrontends`.
  - A manager can't disable themselves or remove their own manager flag.
  - Disabling deletes the user's Better Auth sessions (they're signed out everywhere), and sign-in stays blocked.
  - If `default_app` is no longer allowed, it moves to the first allowed in-app frontend.
- UI: app chips (Chat / Ask / SimGen), a manager switch, enable/disable, and "Manage" to tick the shared accounts a user belongs to.

## Billing accounts (`accounts.ts`, `AccountsTab.tsx`)

| Route | Purpose |
|---|---|
| `GET /api/iam/billing-accounts?q=&kind=` | list with balance and member count |
| `POST /api/iam/billing-accounts` `{name}` | create a **shared** account (personal ones are created at sign-up) |
| `GET/PATCH /api/iam/billing-accounts/:id` | detail with members; rename and disable |
| `PUT/DELETE /api/iam/billing-accounts/:id/members/:userId` | add or remove a member; personal accounts refuse extra members and keep their owner |
| `POST /api/iam/billing-accounts/:id/credit` `{kind, amountUsd, reason}` | `credit_grant` (> 0) or `adjustment` (±, ≠ 0), up to 2 decimals, reason required; `created_by` = the manager |
| `GET /api/iam/billing-accounts/:id/ledger?from=&to=&cursor=&limit=` | newest first; `cursor` is opaque (base64url of the exact microsecond timestamp + id) |
| `GET /api/iam/billing-accounts/:id/ledger.csv?from=&to=` | up to 50 000 rows, exact 9-decimal USD |
| `GET /api/iam/usage?groupBy=user\|model&from=&to=&accountId=` | usage charges aggregated: requests, cost, token totals (from the charged message's `usage`) |
| `GET /api/iam/usage.csv?...` | the same as CSV |

**Dates:** `from`/`to` are inclusive UTC calendar days (`http/dates.ts`). The default is the last 30 days and the maximum is 366.

**CSV** (`http/csv.ts`): RFC 4180 quoting. Text starting with `= + - @`, tab or CR gets a leading `'` (formula injection); plain numbers such as `-0.001234567` are left alone.

**Usage per model** relies on `ledger_entries.model_id`, which every usage charge sets (replies and titles; migration 0003 backfilled reply charges). Title charges have no message, so they count as requests with cost but no tokens.

The UI has an account list with search and "Create", plus an "All accounts" usage overview. The account detail shows: rename, enable/disable, available credit (exact), a credit form, members (search to add), usage by user or model with totals, and the ledger with Load more. Both tables have Export CSV and share one date range picker (7/30/90-day presets).

## Models (`models.ts`, `ModelsTab.tsx`)

- `GET /api/iam/models`: every model (retired included) with prices (trailing zeros trimmed), efforts, budgets, capabilities, `providerConfigured` and `editedAt`.
- `PATCH /api/iam/models/:id`: any catalog field.
  - Prices: up to 6 decimals.
  - Thinking budgets: 1024–200 000.
  - The default effort must be one of the allowed efforts. When efforts change, it falls back to the first one, or `null` if there are none.
  - Every edit sets `edited_at`.
- Retiring hides a model from the picker and Ask and makes its chats read-only. The agent switch is stored for Phase 4.
- `pnpm seed` skips models with `edited_at` and names them; `pnpm seed --force-models` makes the config win and clears `edited_at`.
