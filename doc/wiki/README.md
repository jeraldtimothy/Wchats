# Wiki

The living manual of the codebase. Every page here describes the code as it is on `main` today. The target design for all phases (including parts not built yet) is in [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Pages

- [Getting started](getting-started.md): prerequisites, setup, scripts, seed accounts
- [API](api.md): routes, guards, error format
- [Chat streaming](chat-streaming.md): post-message, GenerationRunner, event hub, listen SSE, titles
- [Providers](providers.md): the LLMProvider interface and the three adapters
- [Billing](billing.md): prices, cost math, the ledger and the balance gate
- [Attachments](attachments.md): uploads, type checks, office text extraction, storage
- [Profile and memories](profile-and-memories.md): profile API, memory items, system prompt assembly
- [Web app](web.md): routes, layout, picker, chat view, theme

## Status

Phases 1 and 2 are built. Phases 3–4 (IAM and Billing, Ask, AI memory generation, agent mode, polish) are not; see ARCHITECTURE.md.
