# 0003 — Phase 3: IAM and Billing, Ask

Study: [doc/study/0003-phase-3-iam-billing-ask.md](../study/0003-phase-3-iam-billing-ask.md)
Branch: `feat/0003-phase-3`

## feat(billing): record the model on usage charges
- [x] `ledger_entries.model_id` + migration with backfill from message → session → model
- [x] runner and title charges set it
- [x] test

## feat(ask): add Ask as one-shot hidden sessions
- [ ] `chat_sessions.kind` (`chat` | `ask`) + migration; chat lists and routes only see `chat`
- [ ] `POST /api/ask` (model, account, text, effort, webSearch) → session + reply via the runner; `GET /api/ask/history`, `GET /api/ask/:id`, `GET /api/ask/:id/listen`, `DELETE /api/ask/:id`; `ask` frontend guard
- [ ] tests

## feat(iam): add user management API
- [ ] `GET /api/iam/users` (search, paging), `PATCH /api/iam/users/:id` (disabled, frontends, manager) with self-lockout guards; disabling revokes sessions
- [ ] tests

## feat(iam): add billing account, credit, ledger and usage API
- [ ] accounts: list/search, create shared, detail with members, rename, disable; add/remove members (personal owner locked)
- [ ] credit: grant/adjust with reason (USD input)
- [ ] ledger (date range, paging) and usage by user / by model; CSV for both with safe quoting
- [ ] tests

## feat(iam): add model catalog editing
- [ ] `GET /api/iam/models`, `PATCH /api/iam/models/:id` (validated fields, prices, retire, agent) setting `edited_at` (+ migration)
- [ ] seed skips IAM-edited models unless `--force-models`
- [ ] tests

## feat(web): add Ask page
- [ ] model + account + effort + web search, streamed Markdown answer with inline errors, history list with open/delete

## feat(web): add IAM users tab
- [ ] `/iam` shell with tabs; users table with search, frontends, manager, enable/disable, account assignment

## feat(web): add IAM billing tab
- [ ] accounts list + create; detail: rename, disable, credit form, members, ledger with date range, usage by user/model, CSV links

## feat(web): add IAM models tab
- [ ] catalog table with retire/agent toggles and an edit dialog

## Wiki
- [ ] add iam and ask pages; update api, billing, getting-started, web, README index

## Done when
- [ ] `pnpm check` passes on the branch and on `main`
- [ ] smoke: Ask streams through the proxy against the mock provider; a manager grants credit, exports CSV
