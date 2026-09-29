# Billing

Code: `apps/api/src/billing/` (`pricing.ts`, `ledger.ts`, `money.ts`).

## Units

Money is `bigint` nano-USD (1 USD = 10⁹). Model prices are `numeric(12,6)` USD per million tokens (`web_search_usd_per_call` per search) and are parsed exactly as strings. Cents appear only for display: `nanoToCents` floors toward −∞.

## Cost (`computeCost`)

```
base  = (input × in + cached × cachedIn + (output + reasoning) × out) / 1M + searches × searchFee
cost  = ceil(base × MARKUP)        # MARKUP env, default 1.25, ≤ 4 decimals
```

All the arithmetic is integer (pico-USD internally), rounded up to the next nano-USD. The result also carries a `pricing` snapshot (prices + markup), which is stored on the message.

## Ledger (`ledger_entries`, append-only)

- `appendEntry(tx, …)` runs `UPDATE billing_accounts SET balance = balance + amount RETURNING` (taking the row lock), then inserts the entry with `balance_after_nano_usd`. Code never updates or deletes entries.
- `grantCredit(db, {accountId, amountNano, kind?, reason, createdBy?, source?, externalRef?})` handles credit grants (> 0), adjustments and refunds. A reason is required. It's idempotent on `externalRef`, which is the seam for Stripe top-ups (`source: 'stripe'`, `externalRef` = payment id).
- `chargeUsage(tx, …)` records a `usage_charge` (negative) linked to the message. It's called inside the transaction that finalizes the reply.
- `ledgerSum` recomputes the sum; tests assert it equals the cached balance, including under concurrent charges.

## Gate (`assertCanSpend`)

Sending requires that the user is a member (else 403), the account isn't disabled (403 `billing_account_disabled`) and `balance > 0` (402 `insufficient_credit`). Charges are post-paid per request, so one reply can take the balance below zero; the next send is then blocked.

## What gets charged

Every assistant reply with reported usage (including provider errors that report usage), and every auto-title call (reason `Session title (<model>)`, no message link).

## Accounts

Each user gets a personal account `[Personal] NAME` on sign-up (`SIGNUP_CREDIT_USD`, default 0). Shared accounts and memberships live in `billing_accounts` / `billing_account_members`; managing them from the UI comes in phase 3.
