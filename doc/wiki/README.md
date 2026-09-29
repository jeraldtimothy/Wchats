# Wiki

The living manual of the codebase. Every page here describes the code as it is on `main` today. The target design for all phases (including parts not built yet) is in [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Pages

- [Getting started](getting-started.md): prerequisites, setup, scripts, seed accounts
- [API](api.md): routes, guards, error format
- [Chat streaming](chat-streaming.md): post-message, GenerationRunner, event hub, listen SSE, titles
- [Providers](providers.md): the LLMProvider interface and the three adapters
- [Billing](billing.md): prices, cost math, the ledger and the balance gate
- [Web app](web.md): routes, layout, picker, chat view, theme

## Status

Phase 1 is built. Phases 2–4 (attachments, web search UI, memories, profile, IAM, Ask, agent mode) are not built yet; see [plan 0001](../plan/0001-phase-1-foundation.md) and ARCHITECTURE.md.
