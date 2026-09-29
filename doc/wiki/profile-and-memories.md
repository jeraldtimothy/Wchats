# Profile and memories

## API

- `GET /api/profile`: `{user: {id, name, username, email, memberSince}, globalSystemPrompt, generateAiMemories, defaultApp, allowedFrontends, billingAccounts}`.
- `PATCH /api/profile`: any of `globalSystemPrompt` (≤ 10 000 chars, trimmed), `generateAiMemories`, `defaultApp` (must be in `allowedFrontends`).
- `GET/POST /api/memories`, `PATCH/DELETE /api/memories/:id`: `{type: preference|fact|reminder|other, content ≤ 2000}`, at most 200 per user, owner-scoped (others get 404).

## System prompt

`buildSystemPrompt` (`apps/api/src/chat/prompts.ts`) joins the base prompt, `User instructions …` (the Global System Prompt), `Things to remember about the user:` with `- (Type) content` lines (only when the session's `include_memories` is on; oldest first), and `Today's date is …`. The composer's Include Memories switch sends `PATCH /api/chat/v2/session/:id {includeMemories}`.

## Generate AI Memories

When `profiles.generate_ai_memories` is on, the pg-boss cron job `crawl-memories` (02:30 nightly; `apps/api/src/memories/crawl.ts`) proposes items. Run it on demand with `pnpm memories:run [--user <id>]`.

For each opted-in, enabled user whose **personal** account has credit:

1. It reads up to 20 chat sessions (not deleted) where `crawled_at IS NULL OR last_activity_at > crawled_at`, oldest activity first. Each transcript uses complete user and assistant turns, capped at 12 000 characters.
2. It sends the existing items plus the numbered conversations to the cheapest configured model (lowest effort) with `MEMORY_SYSTEM`. That prompt asks for at most 5 new durable items as JSON, excluding sensitive data (health, finances, credentials, government IDs, precise addresses) and details about other people.
3. `parseProposal` extracts the JSON, tolerating fences and prose; unknown types become `other`.
4. Items that duplicate existing ones (after normalizing text) are dropped, and the 200-item cap is respected.
5. It inserts the items with `ai_generated = true` and `source_session_id`, charges the personal account (`usage_charge`, reason `AI memories`, model recorded), and sets `crawled_at` on the sessions it read.

If the provider errors, the charge for any reported usage is still recorded, but the sessions stay uncrawled so the next run retries. An unusable reply marks them crawled with no items. The Profile page shows these items with an "AI-generated" badge.

## Web (`routes/ProfilePage.tsx`)

Cards: User Profile (display name, username, copyable user id, member since), Global System Prompt ("Save Prompt" enabled only when changed), Memory Items (add form, inline edit, confirm delete, empty state "No memory items yet. Add your first one above."), Generate AI Memories switch, Default App segmented buttons (apps the user can't use are disabled), and Billing Accounts (ACTIVE/DISABLED badge, available credit). After sign-in, a SimGen default sends the browser to `SIMGEN_URL`; other defaults land through `/`.
