# 0002 — Phase 2: attachments, web search, memories, profile

**Ask:** Phase 2 of the LiteChat clone:
- **Attachments:** paperclip and drag-and-drop. Images (.png .jpg .jpeg .webp .gif) only if the model supports images. Documents (.pdf .docx .xlsx .pptx .txt .md .json .csv): PDFs go natively, office files become text server-side. Files-only messages use the prompt "Describe what you want to do with the attached files."
- **Web search with sources:** a Tools popover (Web Search, Allow multiple turns), with sources rendered as footnotes/chips.
- **Include Memories:** a per-session toggle, persisted on the server.
- **Profile page:** Global System Prompt, memory items, Generate AI Memories toggle (stored only; the job is Phase 4), Default App, and billing balances.

**Feasibility:** Phase 1 already has most of the seams. The provider adapters accept image and PDF parts and emit `tool.sources`. `chat_sessions.include_memories` and `profiles.global_system_prompt/default_app/generate_ai_memories` exist. Missing pieces: an upload path, storage, office-to-text conversion, the `attachments` and `memory_items` tables, and the UI. One adapter gap: OpenAI only returns web-search sources when the request sets `include: ["web_search_call.action.sources"]`.

## Options

The only choice with real alternatives is how to turn docx/xlsx/pptx into text.

| Option | Pros | Cons | Cost |
| ------ | ---- | ---- | ---- |
| A. `officeparser` | One call for all formats | Pulls in pdfjs-dist + tesseract.js (~28 MB unpacked, OCR we don't need); little control over resource limits | Low effort, heavy dependency |
| B. `mammoth` (docx) + `xlsx` (SheetJS) + a pptx lib | Mature docx output | npm `xlsx@0.18.5` is the stale build with published CVEs (fixes only on SheetJS's CDN); three dependencies with different APIs | Medium, security debt |
| C. `fflate` (zero-dependency unzip) + a small XML text walker per format | ~0.8 MB, no transitive dependencies; uncompressed-size limits enforced before inflating (zip-bomb safe); output shaped for LLMs (paragraphs, tab-separated rows, "## Slide N") | ~200 lines to own; plain text only (no styling) | Medium effort, minimal risk |

File types are checked by magic bytes (PNG/JPEG/GIF/WEBP/PDF/ZIP signatures) with a few lines of code; no `file-type` dependency is needed. Uploads use `@fastify/multipart`, the official Fastify plugin.

## Recommendation

**C.** Text extraction only needs text, and C gets it with no dependency risk and explicit limits. The other decisions, made without blocking:

- **Upload flow:** `POST /api/uploads` stores the file first (owned by the user, not yet linked). `post-message` then links the upload ids to the user message. Removing a file before sending deletes it. A daily pg-boss job deletes unlinked uploads older than 24 h.
- **Limits:** 20 MB per file, 10 files per message, extracted text truncated at 200 000 characters (with a note).
- **Which model accepts what:** images need `supports_images`; PDFs need `supports_documents`, since they go natively; text and office files work with every model because they become text.
- **History:** earlier turns keep their attachments, so the model retains the context. Images and PDFs are re-read from storage each turn.
- **Files-only messages:** the stored user text stays empty. The placeholder prompt is substituted only when building the provider request, so the bubble shows just the files.
- **Tools state:** Web Search and Allow multiple turns are per-message composer state, saved in the user message's `options`.
- **Default App "SimGen":** it's external, so after sign-in the user is sent to `SIMGEN_URL`. Visiting `/` directly still lands on an in-app page.
- **The profile's display name** is shown read-only, matching the spec's field list.

## Open questions

None blocking.
