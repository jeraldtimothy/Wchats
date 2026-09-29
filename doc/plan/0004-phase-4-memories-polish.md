# 0004 — Phase 4: AI memories, polish, tests

Study: [doc/study/0004-phase-4-memories-polish.md](../study/0004-phase-4-memories-polish.md)
Branch: `feat/0004-phase-4`

Agent mode was dropped by the owner (see the study).

## feat(memories): generate AI memory items nightly
- [x] `chat_sessions.crawled_at` + migration
- [x] `crawlMemories()`: opted-in users, uncrawled/updated sessions, cheapest model, strict JSON parse, dedupe against existing, cap, charge, mark crawled
- [x] pg-boss cron `crawl-memories` (02:30) + `pnpm memories:run`
- [x] tests (fake provider): items inserted as AI-generated, sessions marked, opt-out/zero-credit skipped, bad JSON tolerated, provider errors retried, recrawl only after new activity

## fix(web): polish error states, retired sessions and mobile
- [x] route error boundary; "Retired" badge on session rows; interrupted-reply text; mobile tweaks (dialogs, composer bar)

## test(web): add unit tests for formatting and Markdown sanitizing
- [x] Vitest + jsdom in apps/web; `formatNanoUsd`, `renderMarkdown` XSS cases

## Wiki
- [ ] document the memory job; update profile-and-memories, web, getting-started, index; ARCHITECTURE (agent mode dropped, decisions)

## Done when
- [ ] `pnpm check` passes on the branch and on `main`
- [ ] smoke: `pnpm memories:run` against the mock provider creates items for an opted-in user
