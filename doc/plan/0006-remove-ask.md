# 0006 — Remove the Ask app

Branch: `feat/0006-remove-ask`

The owner decided Ask isn't needed ("we can just remove it completely"). It overlaps with Chat. Existing Ask questions stay in the database (sessions of kind `ask`) but are no longer reachable. The `session_kind` enum keeps the `ask` value, since dropping an enum value in Postgres is invasive and gains nothing.

## feat!: remove the Ask app
- [x] API: delete `routes/ask.ts` and its registration; session helpers (`createSession`, `getOwnedSession`, `getSessionDetail`, `listSessions`) always mean chat; the memory crawl reads chat sessions only
- [x] shared: delete `ask.ts`; `FRONTENDS` = `chat`, `simgen`
- [x] migration: strip `ask` from `profiles.allowed_frontends`, move `default_app = 'ask'` to `chat`, change the column default to `{chat}`
- [x] web: delete `AskPage`, Ask queries, the sidebar link and route; Default App and IAM app chips drop Ask; default-app redirect order
- [x] seed + tests: drop Ask (`ask.test.ts` removed; frontend expectations updated)

## Wiki
- [ ] delete `ask.md`; update README index, api, web, iam, profile-and-memories, chat-streaming; ARCHITECTURE (routes, frontends, decision)

## Done when
- [ ] `pnpm check` passes on the branch and on `main`
- [ ] the running app shows no Ask tab, and chat still works end to end through the proxies
