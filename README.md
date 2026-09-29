# Wchats

**LiteChat Clone**: metered, pay-as-you-go access to OpenAI, Anthropic and Google models for everyday users, with no monthly subscription. Sessions are charged per request to a billing account through an append-only ledger.

- Quick start: [doc/wiki/getting-started.md](doc/wiki/getting-started.md)
- Design (all phases): [ARCHITECTURE.md](ARCHITECTURE.md)
- How the code works today: [doc/wiki/](doc/wiki/README.md)

## Working on this repo

Agents (and humans) follow the workflow in [CLAUDE.md](CLAUDE.md):

```
study => plan => execute plan => rendezvous => sync docs
```

- `doc/study/` holds studies: feasibility and tradeoffs.
- `doc/plan/` holds plans: checklists of concrete steps.
- `doc/wiki/` holds the living manual of the codebase.
