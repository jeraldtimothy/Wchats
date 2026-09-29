import { eq } from 'drizzle-orm';
import { grantCredit } from '../billing/ledger.js';
import { usdToNano } from '../billing/money.js';
import type { DbOrTx } from '../db/client.js';
import { env } from '../env.js';
import { billingAccountMembers, billingAccounts, profiles } from '../db/schema.js';

export function usernameBase(email: string): string {
  const local = email.split('@')[0] ?? '';
  const cleaned = local.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 32) : 'user';
}

export function personalAccountName(name: string): string {
  return `[Personal] ${name.trim().toUpperCase()}`;
}

/**
 * Creates the app-side records every user needs: a profile and a personal
 * billing account they are a member of. Idempotent per user.
 */
export async function provisionUser(
  db: DbOrTx,
  user: { id: string; email: string; name: string },
): Promise<{ personalAccountId: string }> {
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, user.id) });
  if (!existing) {
    const base = usernameBase(user.email);
    for (let n = 1; ; n++) {
      const username = n === 1 ? base : `${base}${n}`;
      const inserted = await db
        .insert(profiles)
        .values({ userId: user.id, username })
        .onConflictDoNothing()
        .returning({ userId: profiles.userId });
      if (inserted.length > 0) break;
      const owned = await db.query.profiles.findFirst({ where: eq(profiles.userId, user.id) });
      if (owned) break;
    }
  }

  let account = await db.query.billingAccounts.findFirst({
    where: (a, { and, eq }) => and(eq(a.ownerUserId, user.id), eq(a.kind, 'personal')),
  });
  if (!account) {
    [account] = await db
      .insert(billingAccounts)
      .values({ name: personalAccountName(user.name || user.email), kind: 'personal', ownerUserId: user.id })
      .returning();
    const signupCredit = usdToNano(env.SIGNUP_CREDIT_USD);
    if (signupCredit > 0n) {
      await grantCredit(db, {
        accountId: account!.id,
        amountNano: signupCredit,
        reason: 'Sign-up credit',
        userId: user.id,
        source: 'signup',
        externalRef: `signup:${user.id}`,
      });
    }
  }
  await db
    .insert(billingAccountMembers)
    .values({ billingAccountId: account!.id, userId: user.id })
    .onConflictDoNothing();
  return { personalAccountId: account!.id };
}
