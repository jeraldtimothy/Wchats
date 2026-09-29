import { CHAT_ERROR_TEXT, type LedgerKind } from '@wchats/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { billingAccountMembers, billingAccounts, ledgerEntries } from '../db/schema.js';
import { HttpError, notFound } from '../http/errors.js';

interface EntryInput {
  accountId: string;
  kind: LedgerKind;
  /** Signed: positive adds credit, negative spends it. */
  amountNano: bigint;
  userId?: string | null;
  messageId?: string | null;
  modelId?: string | null;
  createdBy?: string | null;
  reason?: string | null;
  source?: string;
  externalRef?: string | null;
}

export type LedgerEntry = typeof ledgerEntries.$inferSelect;

/**
 * Appends a ledger entry and moves the cached balance in the same statement
 * sequence. Must run inside a transaction (the UPDATE takes the row lock, so
 * concurrent entries on one account serialize).
 */
export async function appendEntry(tx: DbOrTx, input: EntryInput): Promise<LedgerEntry> {
  const [account] = await tx
    .update(billingAccounts)
    .set({ balanceNanoUsd: sql`${billingAccounts.balanceNanoUsd} + ${input.amountNano.toString()}::bigint` })
    .where(eq(billingAccounts.id, input.accountId))
    .returning({ balance: billingAccounts.balanceNanoUsd });
  if (!account) throw notFound('Billing account');

  const [entry] = await tx
    .insert(ledgerEntries)
    .values({
      billingAccountId: input.accountId,
      kind: input.kind,
      amountNanoUsd: input.amountNano,
      balanceAfterNanoUsd: account.balance,
      userId: input.userId ?? null,
      messageId: input.messageId ?? null,
      modelId: input.modelId ?? null,
      createdBy: input.createdBy ?? null,
      reason: input.reason ?? null,
      source: input.source ?? 'manual',
      externalRef: input.externalRef ?? null,
    })
    .returning();
  return entry!;
}

export interface GrantInput {
  accountId: string;
  amountNano: bigint;
  kind?: Extract<LedgerKind, 'credit_grant' | 'adjustment' | 'refund'>;
  reason: string;
  createdBy?: string | null;
  userId?: string | null;
  /** 'manual' | 'seed' | 'signup' | later 'stripe' */
  source?: string;
  /** Idempotency key, e.g. a Stripe payment intent id. A repeat returns the original entry. */
  externalRef?: string;
}

/**
 * Adds (or, for adjustments, possibly removes) credit. This is the seam a
 * future Stripe webhook calls with `source: 'stripe'` and `externalRef`.
 */
export async function grantCredit(db: DbOrTx, input: GrantInput): Promise<LedgerEntry> {
  const kind = input.kind ?? 'credit_grant';
  if (!input.reason.trim()) throw new HttpError(400, 'validation', 'A reason is required.');
  if (kind === 'credit_grant' && input.amountNano <= 0n) {
    throw new HttpError(400, 'validation', 'A credit grant must be positive.');
  }
  if (input.externalRef) {
    const existing = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.externalRef, input.externalRef),
    });
    if (existing) return existing;
  }
  return db.transaction((tx) =>
    appendEntry(tx, {
      accountId: input.accountId,
      kind,
      amountNano: input.amountNano,
      reason: input.reason,
      createdBy: input.createdBy,
      userId: input.userId,
      source: input.source ?? 'manual',
      externalRef: input.externalRef,
    }),
  );
}

/** Records a usage charge. Call inside the transaction that also finalizes the message. */
export async function chargeUsage(
  tx: DbOrTx,
  input: {
    accountId: string;
    userId: string;
    messageId: string | null;
    modelId?: string | null;
    costNano: bigint;
    reason?: string;
  },
): Promise<LedgerEntry | null> {
  if (input.costNano <= 0n) return null;
  return appendEntry(tx, {
    accountId: input.accountId,
    kind: 'usage_charge',
    amountNano: -input.costNano,
    userId: input.userId,
    messageId: input.messageId,
    modelId: input.modelId ?? null,
    reason: input.reason ?? null,
    source: 'usage',
  });
}

/**
 * The balance gate: the account must be active, the user a member, and the
 * balance strictly positive.
 */
export async function assertCanSpend(db: DbOrTx, accountId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ account: billingAccounts, memberId: billingAccountMembers.userId })
    .from(billingAccounts)
    .leftJoin(
      billingAccountMembers,
      and(eq(billingAccountMembers.billingAccountId, billingAccounts.id), eq(billingAccountMembers.userId, userId)),
    )
    .where(eq(billingAccounts.id, accountId));
  if (!row) throw notFound('Billing account');
  if (!row.memberId) throw new HttpError(403, 'forbidden', 'You are not a member of this billing account.');
  if (row.account.isDisabled) {
    throw new HttpError(403, 'billing_account_disabled', 'This billing account is disabled.');
  }
  if (row.account.balanceNanoUsd <= 0n) {
    throw new HttpError(402, 'insufficient_credit', CHAT_ERROR_TEXT.insufficientCredit);
  }
}

/** Recomputes SUM(ledger) for an account (used by tests and `billing:verify`). */
export async function ledgerSum(db: DbOrTx, accountId: string): Promise<bigint> {
  const [row] = await db
    .select({ sum: sql<string>`coalesce(sum(${ledgerEntries.amountNanoUsd}), 0)::text` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.billingAccountId, accountId));
  return BigInt(row?.sum ?? '0');
}
