# Ask

One-shot Q&A at `/ask` (web: `routes/AskPage.tsx`; API: `apps/api/src/routes/ask.ts`). Routes need the `ask` frontend.

## Model

Each question is a `chat_sessions` row with `kind = 'ask'` and a single exchange. It reuses the chat pipeline unchanged ([chat streaming](chat-streaming.md)): `createSession` and `postMessage` in `chat/send.ts`, the GenerationRunner, the event hub, `streamSession` SSE, billing and inline errors. The differences:

- Ask sessions never appear in chat lists or chat routes, and chat sessions never appear in Ask (`getOwnedSession(..., kind)`).
- Ask sessions get no auto-title; the history shows the question.
- No attachments. The options are model, billing account, thinking effort and Web Search.

## API

| Route | Purpose |
|---|---|
| `POST /api/ask` `{modelId, billingAccountId, text, effort?, webSearch?}` | checks the balance first (402 leaves nothing behind), creates the session, posts the question → 202 `{session, userMessage, assistantMessage}`. If posting fails (for example a bad effort), the new session is deleted. |
| `GET /api/ask/history` | the latest 50: question, model, reply status, date |
| `GET /api/ask/:id` | session detail (like chat) |
| `GET /api/ask/:id/listen` | SSE, same events as chat |
| `DELETE /api/ask/:id` | soft delete |

## Web

- **Form:** a model select grouped by provider with favorites starred first, a billing account select with balances, a thinking-effort select for models with efforts, a Web Search checkbox for models that support it, and a question box (Enter asks). The last model and account are remembered in `localStorage`.
- **Answer:** `MessageList`, fed by `useSessionStream(id, {url: /api/ask/:id/listen, detailKey})`. The history refreshes when the answer finishes.
- **History panel:** past questions to open or delete.
