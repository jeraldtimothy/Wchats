/**
 * Development seed: model catalog, an admin (manager) and a normal user,
 * a shared billing account, and starting credit. Safe to re-run.
 *
 * The passwords below are for local development only.
 */
import { and, eq } from 'drizzle-orm';
import { provisionUser } from '../src/accounts/provision.js';
import { auth } from '../src/auth/auth.js';
import { grantCredit } from '../src/billing/ledger.js';
import { usdToNano } from '../src/billing/money.js';
import { db, pool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { billingAccountMembers, billingAccounts, profiles, user } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { upsertModels } from '../src/models/catalog.js';
import { seedModels } from './models.config.js';

const USERS = [
  {
    email: 'admin@litechat.local',
    password: 'admin-password-123',
    name: 'Ada Admin',
    isManager: true,
    allowedFrontends: ['chat', 'simgen'],
    credit: '25.00',
  },
  {
    email: 'user@litechat.local',
    password: 'user-password-123',
    name: 'Uma User',
    isManager: false,
    allowedFrontends: ['chat'],
    credit: '5.00',
  },
] as const;

const SHARED_ACCOUNT = { name: 'Acme Research', credit: '100.00' };

async function ensureUser(u: (typeof USERS)[number]): Promise<string> {
  let row = await db.query.user.findFirst({ where: eq(user.email, u.email) });
  if (!row) {
    await auth.api.signUpEmail({ body: { email: u.email, password: u.password, name: u.name } });
    row = await db.query.user.findFirst({ where: eq(user.email, u.email) });
  }
  if (!row) throw new Error(`Could not create ${u.email}`);
  await provisionUser(db, row);
  await db
    .update(profiles)
    .set({ isManager: u.isManager, allowedFrontends: [...u.allowedFrontends] })
    .where(eq(profiles.userId, row.id));
  return row.id;
}

async function main(): Promise<void> {
  await runMigrations(env.DATABASE_URL);
  const force = process.argv.includes('--force-models');
  const kept = await upsertModels(db, seedModels, { force });
  console.log(`✓ ${seedModels.length} models upserted${force ? ' (config overrides IAM edits)' : ''}`);
  if (kept.length) {
    console.log(`  kept IAM edits for: ${kept.join(', ')} (run \`pnpm seed --force-models\` to overwrite)`);
  }

  const ids: string[] = [];
  for (const u of USERS) {
    const id = await ensureUser(u);
    ids.push(id);
    const personal = await db.query.billingAccounts.findFirst({
      where: and(eq(billingAccounts.ownerUserId, id), eq(billingAccounts.kind, 'personal')),
    });
    await grantCredit(db, {
      accountId: personal!.id,
      amountNano: usdToNano(u.credit),
      reason: 'Seed starting credit',
      source: 'seed',
      externalRef: `seed:personal:${u.email}`,
    });
    console.log(`✓ ${u.email} / ${u.password}  (${u.isManager ? 'manager' : 'user'}, $${u.credit} personal credit)`);
  }

  let shared = await db.query.billingAccounts.findFirst({
    where: and(eq(billingAccounts.name, SHARED_ACCOUNT.name), eq(billingAccounts.kind, 'shared')),
  });
  if (!shared) {
    [shared] = await db.insert(billingAccounts).values({ name: SHARED_ACCOUNT.name, kind: 'shared' }).returning();
  }
  for (const id of ids) {
    await db.insert(billingAccountMembers).values({ billingAccountId: shared!.id, userId: id }).onConflictDoNothing();
  }
  await grantCredit(db, {
    accountId: shared!.id,
    amountNano: usdToNano(SHARED_ACCOUNT.credit),
    reason: 'Seed starting credit',
    source: 'seed',
    externalRef: 'seed:shared:acme',
  });
  console.log(`✓ shared account "${SHARED_ACCOUNT.name}" with $${SHARED_ACCOUNT.credit}, both users are members`);
}

try {
  await main();
} finally {
  await pool.end();
}
