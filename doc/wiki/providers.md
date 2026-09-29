# Providers

Code: `apps/api/src/providers/`. Nothing outside this folder imports a provider SDK.

## Interface (`types.ts`)

`LLMProvider { id; isConfigured(); streamChat(ChatRequest): AsyncIterable<ProviderEvent>; listModels() }`.

- `ChatRequest`: provider model id, system prompt, `messages` (user/assistant turns of text, image and PDF parts), optional `effort`, `thinkingBudgets`, `maxOutputTokens`, `webSearch`, `multiTurnTools`, `signal`.
- `ProviderEvent`: `text.delta`, `reasoning.delta`, `tool.started`, `tool.sources`, `refusal`, then exactly one terminal `done {stopReason, usage, rawUsage}` or `error {message, usage?, rawUsage?}`. Adapters never throw from `streamChat`.
- `Usage`: `inputTokens` (uncached), `cachedInputTokens`, `outputTokens` (excluding reasoning), `reasoningTokens`, `webSearches`.

`index.ts` builds the `ProviderRegistry` from env (`createProvidersFromEnv`). A provider without a key is `isConfigured() === false`; its models are hidden and nothing crashes. `buildApp({providers})` accepts a fake registry (see `apps/api/test/fakes.ts`).

## Adapters

| | OpenAI (`openai.ts`) | Anthropic (`anthropic.ts`) | Gemini (`gemini.ts`) |
|---|---|---|---|
| Call | `responses.create({stream:true, store:false})` | `messages.create({stream:true})` raw events | `models.generateContentStream` |
| Effort | `reasoning.effort` | budget → `thinking.enabled/budget_tokens`; else adaptive + `output_config.effort`; `none` = off | budget → `thinkingBudget`; else `thinkingLevel`; `none` = budget 0 |
| Web search | `web_search` tool + `include: ['web_search_call.action.sources']` | `web_search_20250305`, `max_uses` 1/5 | `googleSearch` |
| Images / PDFs | `input_image` / `input_file` data URLs | `image` / `document` base64 blocks | `inlineData` |
| Refusal | refusal deltas, `content_filter` | `stop_reason: refusal` | SAFETY-type finish reasons, `promptFeedback.blockReason` |

The usage normalization for each provider is in ARCHITECTURE.md §6. `util.ts` has `mergeTurns` (merges consecutive same-role turns), `SourceSet` (de-duplicates URLs) and `safeErrorMessage` (generic texts for 401/403/429/404/5xx and for invalid-key errors reported with other statuses, such as Google's 400 `API_KEY_INVALID`; unwraps JSON error bodies to their message; redacts anything that looks like a key).

## Tests

`apps/api/test/providers/*.test.ts` run each adapter against a mocked SDK client (request mapping, event normalization, stop reasons, usage, key redaction).

## check-models

`pnpm check-models` (`src/models/check-models.ts`) lists each configured provider's models and prints ✓/✗ per seeded `providerModelId`. It exits 1 when any are missing.
