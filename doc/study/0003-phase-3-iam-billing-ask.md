# 0003 — Phase 3: IAM and Billing, Ask

**Ask:** Phase 3 of the LiteChat clone.
- **IAM and Billing** (`/iam`, managers only):
  - Users: list and search, enable/disable, set `allowed_frontends` and `is_manager`, assign users to billing accounts.
  - Billing accounts: create, rename, disable, grant or adjust credit with a reason, view the ledger and per-user/per-model usage over a date range, export CSV.
  - Models: edit catalog fields (including prices), retire/unretire, enable agent mode.
- **Ask** (`/ask`): pick a model, ask one question, get a streamed answer. It isn't saved as a chat session (or is saved to a separate history) and is billed the same way.

**Feasibility:** Phases 1–2 supply the pieces: the ledger (`grantCredit` is the adjustment path), guards (`requireManager`), the model catalog, and the whole streaming pipeline. Four gaps:
1. Usage reports need the model behind every charge. Title charges have no message, so their model only appears in free text.
2. Nothing marks a session as an Ask.
3. `pnpm seed` upserts the whole config, so it would overwrite prices a manager edited in IAM.
4. There are no manager-scoped APIs or UI yet.

## Options

**Ask**

| Option | Pros | Cons | Cost |
| ------ | ---- | ---- | ---- |
| A. An Ask is a hidden session (`chat_sessions.kind = 'ask'`) with one exchange, driven by the existing post-message / GenerationRunner / listen pipeline | Streaming, reconnect replay, billing, refusals and errors are reused unchanged; the history is a filtered session list | A `kind` column, and every chat list must filter by it | Low |
| B. A separate `ask_requests` table, streamed directly in the POST response | Fully separate from chat | A second streaming and billing path to maintain; no reconnect; duplicated error handling | High |

**Keeping IAM edits across re-seeds**

| Option | Pros | Cons | Cost |
| ------ | ---- | ---- | ---- |
| A. Seed inserts new models only | Simple | Filling in the placeholder ids and prices in the config would no longer take effect for existing rows | Low |
| B. `models.edited_at` is set by IAM edits; seed updates only rows never edited in IAM, and `pnpm seed --force-models` overrides | The config still drives untouched models, and manager edits win | One column plus a flag | Low |

## Recommendation

- **Ask: A.** One pipeline, and Ask gets reconnect and the inline error states for free. Ask sessions never appear in the chat sidebar. The Ask page shows its own history.
- **Seeding: B.**
- **Usage by model:** add `ledger_entries.model_id`, set on every usage charge (replies and titles). The migration backfills existing reply charges through message → session → model.
- **Manager scope:** single-tenant. Managers see and manage all users and accounts. Guard rails:
  - A manager can't disable themselves or remove their own manager flag.
  - A personal account's owner can't be removed from it.
  - Disabling a user also signs out their sessions.
- **Money input:** managers enter USD with up to 2 decimals. Grants must be positive; adjustments may be negative. Both need a reason.
- **Date ranges:** `from`/`to` are inclusive calendar dates in UTC, defaulting to the last 30 days.
- **CSV:** generated server-side with RFC 4180 quoting. Cells starting with `= + - @` are prefixed with `'` (spreadsheet formula injection); signed amount columns are numeric, so they're exempt.
- **Ask options:** model, billing account, thinking effort, and Web Search. No attachments; the spec doesn't call for them.

## Open questions

None blocking.
