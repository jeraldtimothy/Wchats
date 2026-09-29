# 0004 — Phase 4: AI memories, polish, tests

**Ask:** Phase 4 of the LiteChat clone:
- **AI memory generation.** When "Generate AI Memories" is on, a nightly job reads the user's chats that haven't been crawled yet (`crawled_at`) and proposes memory items, marked as AI-generated.
- **Polish:** mobile, retired models, error states.
- **Tests:** broader coverage.

**Scope change:** The spec's Phase 4 also listed Agent mode. The owner dropped it on 2026-09-29 ("not something users actually see"). The `models.agent_enabled` column and the IAM switch stay as they are; nothing reads them.

**Feasibility:** Most pieces exist: the `ai_generated` flag, the Generate AI Memories toggle, pg-boss, and the cheapest-model helper used for titles. Gaps:
- `chat_sessions.crawled_at`.
- A parser that tolerates a model's JSON output.
- Web-side tests: the web app has none, and DOMPurify needs a DOM.

## Options

**How the memory job gets structured output**

| Option | Pros | Cons | Cost |
| ------ | ---- | ---- | ---- |
| A. Ask for strict JSON in the prompt, then extract and validate it with Zod (tolerating code fences and prose) | Works with every adapter as-is; invalid output just yields no items | Relies on prompt compliance | Low |
| B. Add provider-native structured output (JSON schema / tool calls) to all three adapters | Typed guarantee | New request surface in three SDKs for one nightly job | High |

## Recommendation

**A.**
- **Schedule:** pg-boss cron `crawl-memories` runs nightly at 02:30. `pnpm memories:run [--user id]` runs it on demand.
- **Per opted-in, enabled user whose personal account has credit:**
  - read up to 20 sessions (chat and Ask) that are new or have activity since `crawled_at`, oldest first, each transcript capped at about 12k characters;
  - ask the cheapest configured model for up to 5 new items, passing the existing items so it avoids duplicates;
  - drop duplicates after normalizing text, and respect the 200-item cap;
  - insert them with `ai_generated` and the source session;
  - charge the personal account (reason `AI memories`, model recorded) and set `crawled_at`.
- **Privacy:** the prompt excludes sensitive data (health, finances, credentials, government IDs, precise addresses) and details about other people.
- **Failures:** if the provider fails, the sessions stay uncrawled so the next run retries; an unusable reply still marks them crawled.
- **Polish:**
  - a route error boundary (no blank screen on a render error);
  - a "Retired" badge on session rows whose model is retired;
  - a clearer inline message for interrupted replies;
  - a mobile pass on dialogs and the composer bar.
- **Tests:**
  - API: the memory crawl (items, duplicates, charging, recrawl on new activity, opt-out and zero-credit skips, provider errors, JSON parsing).
  - Web: Vitest + jsdom unit tests for `formatNanoUsd` and the Markdown sanitizer (XSS cases).
  - `pnpm test` runs both apps.

## Open questions

None blocking.
