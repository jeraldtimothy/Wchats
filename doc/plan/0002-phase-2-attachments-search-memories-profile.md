# 0002 — Phase 2: attachments, web search, memories, profile

Study: [doc/study/0002-phase-2-attachments-search-memories-profile.md](../study/0002-phase-2-attachments-search-memories-profile.md)
Branch: `feat/0002-phase-2`

## feat(attachments): add uploads with storage, type sniffing and office text extraction
- [x] `Storage` interface + `LocalDiskStorage` (`STORAGE_DIR`), env + `.env.example`
- [x] `attachments` table + migration
- [x] magic-byte sniffing; office (docx/xlsx/pptx) and plain-text extraction with fflate, size limits, truncation
- [x] `POST /api/uploads` (multipart), `GET /api/uploads/:id/content`, `DELETE /api/uploads/:id` (unlinked only)
- [x] daily pg-boss job deleting unlinked uploads older than 24h
- [x] tests: sniffing, extraction per format (fixtures built in-test), zip-bomb limit, upload routes and ownership

## feat(chat): send attachments and web search options with messages
- [x] `post-message` accepts `attachmentIds` (owned, unlinked, allowed for the model), links them; files-only messages allowed
- [x] runner builds image/PDF/text parts for every turn with attachments; files-only placeholder prompt
- [x] message DTOs carry attachments
- [x] OpenAI adapter requests `web_search_call.action.sources` when searching
- [x] tests: attachments reach the provider request, model gating, files-only prompt, sources persisted

## feat(memories): add memory items and Include Memories
- [x] `memory_items` table + migration
- [x] `GET/POST /api/memories`, `PATCH/DELETE /api/memories/:id`
- [x] runner adds memories to the system prompt when the session's Include Memories is on
- [x] tests: CRUD + ownership, prompt includes memories only when enabled

## feat(profile): add profile endpoints
- [x] `GET /api/profile`, `PATCH /api/profile` (global system prompt, generate AI memories, default app ∈ allowed frontends)
- [x] tests

## feat(web): add attachments, tools, memories toggle and sources to chat
- [ ] composer: paperclip + drag-and-drop with type gating, upload chips with remove, files-only send
- [ ] composer bar: Include Memories toggle (PATCH), Tools popover (Web Search; Allow multiple turns + hint when supported)
- [ ] messages: attachment chips/thumbnails; web sources as numbered chips; search activity line

## feat(web): add profile page
- [ ] cards: User Profile, Global System Prompt, Memory Items (add/edit/delete, empty state), Generate AI Memories, Default App, Billing Accounts
- [ ] post-login landing honours the default app (SimGen → external URL)

## Wiki
- [ ] update api, chat-streaming, providers, web, getting-started; add attachments and profile pages

## Done when
- [ ] `pnpm check` passes on the branch and on `main`
- [ ] smoke: upload a docx and an image through the dev proxy against the mock provider; request contains the parts
