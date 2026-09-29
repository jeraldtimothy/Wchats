import type { BillingAccountSummary } from '@wchats/shared';
import { asc, eq } from 'drizzle-orm';
import { nanoToCents } from '../billing/money.js';
import type { DbOrTx } from '../db/client.js';
import { billingAccountMembers, billingAccounts } from '../db/schema.js';

export function toAccountSummary(a: typeof billingAccounts.$inferSelect): BillingAccountSummary {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    isDisabled: a.isDisabled,
    balanceCents: nanoToCents(a.balanceNanoUsd),
  };
}

/** Billing accounts the user is a member of; personal account first. */
export async function listAccountsForUser(db: DbOrTx, userId: string): Promise<BillingAccountSummary[]> {
  const rows = await db
    .select({ account: billingAccounts })
    .from(billingAccountMembers)
    .innerJoin(billingAccounts, eq(billingAccounts.id, billingAccountMembers.billingAccountId))
    .where(eq(billingAccountMembers.userId, userId))
    .orderBy(asc(billingAccounts.kind), asc(billingAccounts.name));
  return rows.map((r) => toAccountSummary(r.account));
}
