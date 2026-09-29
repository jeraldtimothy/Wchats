import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { provisionUser } from '../src/accounts/provision.js';
import { assertCanSpend, chargeUsage, grantCredit, ledgerSum } from '../src/billing/ledger.js';
import { db } from '../src/db/client.js';
import { billingAccounts, user } from '../src/db/schema.js';
import { HttpError } from '../src/http/errors.js';

async function makeUser() {
  const id = randomUUID();
  await db.insert(user).values({ id, name: 'Ledger Tester', email: `${id}@example.com` });
  const { personalAccountId } = await provisionUser(db, { id, name: 'Ledger Tester', email: `${id}@example.com` });
  return { userId: id, accountId: personalAccountId };
}

async function balance(accountId: string) {
  const a = await db.query.billingAccounts.findFirst({ where: eq(billingAccounts.id, accountId) });
  return a!.balanceNanoUsd;
}

async function expectHttpError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).code).toBe(code);
}

describe('ledger', () => {
  it('keeps the cached balance equal to the ledger sum', async () => {
    const { userId, accountId } = await makeUser();
    await grantCredit(db, { accountId, amountNano: 5_000_000_000n, reason: 'test grant' });
    await db.transaction((tx) => chargeUsage(tx, { accountId, userId, messageId: null, costNano: 1_234_567n }));
    await grantCredit(db, { accountId, amountNano: -100n, kind: 'adjustment', reason: 'fix' });
    expect(await balance(accountId)).toBe(5_000_000_000n - 1_234_567n - 100n);
    expect(await ledgerSum(db, accountId)).toBe(await balance(accountId));
  });

  it('serializes concurrent charges without losing updates', async () => {
    const { userId, accountId } = await makeUser();
    await grantCredit(db, { accountId, amountNano: 1_000_000n, reason: 'seed' });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        db.transaction((tx) => chargeUsage(tx, { accountId, userId, messageId: null, costNano: 1_000n })),
      ),
    );
    expect(await balance(accountId)).toBe(980_000n);
    expect(await ledgerSum(db, accountId)).toBe(980_000n);
  });

  it('is idempotent on externalRef', async () => {
    const { accountId } = await makeUser();
    const ref = `test:${randomUUID()}`;
    const a = await grantCredit(db, { accountId, amountNano: 100n, reason: 'x', externalRef: ref });
    const b = await grantCredit(db, { accountId, amountNano: 100n, reason: 'x', externalRef: ref });
    expect(b.id).toBe(a.id);
    expect(await balance(accountId)).toBe(100n);
  });

  it('rejects grants without a reason or with a non-positive amount', async () => {
    const { accountId } = await makeUser();
    await expectHttpError(grantCredit(db, { accountId, amountNano: 100n, reason: ' ' }), 'validation');
    await expectHttpError(grantCredit(db, { accountId, amountNano: 0n, reason: 'x' }), 'validation');
  });
});

describe('balance gate', () => {
  it('blocks at zero, allows when positive, blocks again when negative', async () => {
    const { userId, accountId } = await makeUser();
    await expectHttpError(assertCanSpend(db, accountId, userId), 'insufficient_credit');
    await grantCredit(db, { accountId, amountNano: 10n, reason: 'x' });
    await expect(assertCanSpend(db, accountId, userId)).resolves.toBeUndefined();
    await db.transaction((tx) => chargeUsage(tx, { accountId, userId, messageId: null, costNano: 50n }));
    await expectHttpError(assertCanSpend(db, accountId, userId), 'insufficient_credit');
  });

  it('blocks disabled accounts and non-members', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await grantCredit(db, { accountId: a.accountId, amountNano: 10n, reason: 'x' });
    await expectHttpError(assertCanSpend(db, a.accountId, b.userId), 'forbidden');
    await db.update(billingAccounts).set({ isDisabled: true }).where(eq(billingAccounts.id, a.accountId));
    await expectHttpError(assertCanSpend(db, a.accountId, a.userId), 'billing_account_disabled');
  });
});
