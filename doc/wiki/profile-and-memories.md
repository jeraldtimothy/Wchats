# Profile and memories

## API

- `GET /api/profile`: `{user: {id, name, username, email, memberSince}, globalSystemPrompt, generateAiMemories, defaultApp, allowedFrontends, billingAccounts}`.
- `PATCH /api/profile`: any of `globalSystemPrompt` (≤ 10 000 chars, trimmed), `generateAiMemories`, `defaultApp` (must be in `allowedFrontends`).
- `GET/POST /api/memories`, `PATCH/DELETE /api/memories/:id`: `{type: preference|fact|reminder|other, content ≤ 2000}`, at most 200 per user, owner-scoped (others get 404).

## System prompt

`buildSystemPrompt` (`apps/api/src/chat/prompts.ts`) joins the base prompt, `User instructions …` (the Global System Prompt), `Things to remember about the user:` with `- (Type) content` lines (only when the session's `include_memories` is on; oldest first), and `Today's date is …`. The composer's Include Memories switch sends `PATCH /api/chat/v2/session/:id {includeMemories}`.

## Generate AI Memories

The toggle is stored (`profiles.generate_ai_memories`), and `memory_items.ai_generated` exists for the badge. The nightly job that proposes items is Phase 4.

## Web (`routes/ProfilePage.tsx`)

Cards: User Profile (display name, username, copyable user id, member since), Global System Prompt ("Save Prompt" enabled only when changed), Memory Items (add form, inline edit, confirm delete, empty state "No memory items yet. Add your first one above."), Generate AI Memories switch, Default App segmented buttons (apps the user can't use are disabled), and Billing Accounts (ACTIVE/DISABLED badge, available credit). After sign-in, a SimGen default sends the browser to `SIMGEN_URL`; other defaults land through `/`.
