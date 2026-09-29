import {
  CreateAccountBody,
  CreditBody,
  DateRangeQuery,
  PatchAccountBody,
  type IamAccount,
  type IamAccountDetail,
  type IamLedgerEntry,
  type IamLedgerResponse,
  type UsageResponse,
  type UsageRow,
} from '@wchats/shared';
import { aliasedTable, and, asc, count, desc, eq, gte, ilike, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getAuth } from '../../auth/guards.js';
import { grantCredit } from '../../billing/ledger.js';
import { nanoToCents, nanoToUsd, signedUsdToNano } from '../../billing/money.js';
import { db } from '../../db/client.js';
import { billingAccountMembers, billingAccounts, ledgerEntries, messages, models, user } from '../../db/schema.js';
import { toCsv } from '../../http/csv.js';
import { dateRange, type DateRange } from '../../http/dates.js';
import { HttpError, notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { escapeLike } from './users.js';

const IdParams = z.object({ id: z.uuid() });
const MemberParams = z.object({ id: z.uuid(), userId: z.string().min(1).max(100) });
const ListQuery = z.object({ q: z.string().trim().max(100).optional(), kind: z.enum(['personal', 'shared']).optional() });
const LedgerQuery = DateRangeQuery.extend({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const UsageQuery = DateRangeQuery.extend({
  groupBy: z.enum(['user', 'model']).default('user'),
  accountId: z.uuid().optional(),
});
const CSV_ROW_LIMIT = 50_000;

type AccountRow = typeof billingAccounts.$inferSelect;

function toIamAccount(a: AccountRow, memberCount: number): IamAccount {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    isDisabled: a.isDisabled,
    balanceCents: nanoToCents(a.balanceNanoUsd),
    balanceNanoUsd: a.balanceNanoUsd.toString(),
    memberCount,
    ownerUserId: a.ownerUserId,
    createdAt: a.createdAt.toISOString(),
  };
}

async function accountDetail(id: string): Promise<IamAccountDetail> {
  const account = await db.query.billingAccounts.findFirst({ where: eq(billingAccounts.id, id) });
  if (!account) throw notFound('Billing account');
  const members = await db
    .select({ userId: user.id, name: user.name, email: user.email, addedAt: billingAccountMembers.addedAt })
    .from(billingAccountMembers)
    .innerJoin(user, eq(user.id, billingAccountMembers.userId))
    .where(eq(billingAccountMembers.billingAccountId, id))
    .orderBy(asc(user.name));
  return {
    ...toIamAccount(account, members.length),
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      email: m.email,
      isOwner: account.kind === 'personal' && account.ownerUserId === m.userId,
      addedAt: m.addedAt.toISOString(),
    })),
  };
}

const actor = aliasedTable(user, 'actor');

function ledgerWhere(accountId: string, range: DateRange): SQL {
  return and(
    eq(ledgerEntries.billingAccountId, accountId),
    gte(ledgerEntries.createdAt, range.start),
    lt(ledgerEntries.createdAt, range.end),
  )!;
}

async function ledgerRows(where: SQL, limit: number): Promise<(IamLedgerEntry & { _cursorTs: string })[]> {
  const rows = await db
    .select({
      e: ledgerEntries,
      userName: user.name,
      userEmail: user.email,
      modelName: models.displayName,
      createdByName: actor.name,
      // Exact (microsecond) timestamp text for the keyset cursor; JS Dates only keep milliseconds.
      cursorTs: sql<string>`${ledgerEntries.createdAt}::text`,
    })
    .from(ledgerEntries)
    .leftJoin(user, eq(user.id, ledgerEntries.userId))
    .leftJoin(models, eq(models.id, ledgerEntries.modelId))
    .leftJoin(actor, eq(actor.id, ledgerEntries.createdBy))
    .where(where)
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.e.id,
    kind: r.e.kind,
    amountNanoUsd: r.e.amountNanoUsd.toString(),
    balanceAfterNanoUsd: r.e.balanceAfterNanoUsd.toString(),
    userName: r.userName,
    userEmail: r.userEmail,
    modelName: r.modelName,
    createdByName: r.createdByName,
    reason: r.e.reason,
    source: r.e.source,
    createdAt: r.e.createdAt.toISOString(),
    _cursorTs: r.cursorTs,
  }));
}

/** Usage charges grouped by user or model; tokens come from the charged message's normalized usage. */
export async function usageReport(groupBy: 'user' | 'model', range: DateRange, accountId?: string): Promise<UsageRow[]> {
  const token = (field: string) => sql<string>`coalesce(sum((${messages.usage} ->> ${field})::bigint), 0)::text`;
  const key = groupBy === 'user' ? ledgerEntries.userId : ledgerEntries.modelId;
  const label =
    groupBy === 'user'
      ? sql<string>`coalesce(max(${user.name}) || ' <' || max(${user.email}) || '>', 'Deleted user')`
      : sql<string>`coalesce(max(${models.displayName}), 'Unknown model')`;
  const rows = await db
    .select({
      key,
      label,
      requests: count(),
      cost: sql<string>`(-sum(${ledgerEntries.amountNanoUsd}))::text`,
      inputTokens: token('inputTokens'),
      cachedInputTokens: token('cachedInputTokens'),
      outputTokens: token('outputTokens'),
      reasoningTokens: token('reasoningTokens'),
      webSearches: token('webSearches'),
    })
    .from(ledgerEntries)
    .leftJoin(messages, eq(messages.id, ledgerEntries.messageId))
    .leftJoin(user, eq(user.id, ledgerEntries.userId))
    .leftJoin(models, eq(models.id, ledgerEntries.modelId))
    .where(
      and(
        eq(ledgerEntries.kind, 'usage_charge'),
        gte(ledgerEntries.createdAt, range.start),
        lt(ledgerEntries.createdAt, range.end),
        accountId ? eq(ledgerEntries.billingAccountId, accountId) : undefined,
      ),
    )
    .groupBy(key)
    .orderBy(sql`sum(${ledgerEntries.amountNanoUsd})`);
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    requests: r.requests,
    costNanoUsd: r.cost,
    inputTokens: Number(r.inputTokens),
    cachedInputTokens: Number(r.cachedInputTokens),
    outputTokens: Number(r.outputTokens),
    reasoningTokens: Number(r.reasoningTokens),
    webSearches: Number(r.webSearches),
  }));
}

function sendCsv(reply: FastifyReply, filename: string, body: string) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .header('cache-control', 'no-store')
    .send(body);
}

const encodeCursor = (ts: string, id: string) => Buffer.from(JSON.stringify([ts, id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const [ts, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    if (typeof ts === 'string' && typeof id === 'string' && z.uuid().safeParse(id).success && !Number.isNaN(Date.parse(ts))) {
      return [ts, id];
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, 'validation', 'Invalid cursor.');
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'account';

export async function iamAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/iam/billing-accounts', async (request): Promise<{ accounts: IamAccount[] }> => {
    const { q, kind } = parse(ListQuery, request.query);
    const rows = await db
      .select({ a: billingAccounts, members: count(billingAccountMembers.userId) })
      .from(billingAccounts)
      .leftJoin(billingAccountMembers, eq(billingAccountMembers.billingAccountId, billingAccounts.id))
      .where(and(q ? ilike(billingAccounts.name, `%${escapeLike(q)}%`) : undefined, kind ? eq(billingAccounts.kind, kind) : undefined))
      .groupBy(billingAccounts.id)
      .orderBy(desc(billingAccounts.kind), asc(billingAccounts.name))
      .limit(500);
    return { accounts: rows.map((r) => toIamAccount(r.a, r.members)) };
  });

  app.post('/api/iam/billing-accounts', async (request, reply): Promise<IamAccountDetail> => {
    const { name } = parse(CreateAccountBody, request.body);
    const [created] = await db.insert(billingAccounts).values({ name, kind: 'shared' }).returning();
    reply.status(201);
    return accountDetail(created!.id);
  });

  app.get('/api/iam/billing-accounts/:id', async (request) => accountDetail(parse(IdParams, request.params).id));

  app.patch('/api/iam/billing-accounts/:id', async (request): Promise<IamAccountDetail> => {
    const { id } = parse(IdParams, request.params);
    const body = parse(PatchAccountBody, request.body);
    const updated = await db.update(billingAccounts).set(body).where(eq(billingAccounts.id, id)).returning({ id: billingAccounts.id });
    if (!updated.length) throw notFound('Billing account');
    return accountDetail(id);
  });

  app.put('/api/iam/billing-accounts/:id/members/:userId', async (request): Promise<IamAccountDetail> => {
    const { id, userId } = parse(MemberParams, request.params);
    const account = await db.query.billingAccounts.findFirst({ where: eq(billingAccounts.id, id) });
    if (!account) throw notFound('Billing account');
    if (account.kind === 'personal') throw new HttpError(400, 'validation', 'Personal accounts belong to one user.');
    if (!(await db.query.user.findFirst({ where: eq(user.id, userId) }))) throw notFound('User');
    await db.insert(billingAccountMembers).values({ billingAccountId: id, userId }).onConflictDoNothing();
    return accountDetail(id);
  });

  app.delete('/api/iam/billing-accounts/:id/members/:userId', async (request): Promise<IamAccountDetail> => {
    const { id, userId } = parse(MemberParams, request.params);
    const account = await db.query.billingAccounts.findFirst({ where: eq(billingAccounts.id, id) });
    if (!account) throw notFound('Billing account');
    if (account.kind === 'personal' && account.ownerUserId === userId) {
      throw new HttpError(400, 'validation', "The owner can't be removed from a personal account.");
    }
    await db
      .delete(billingAccountMembers)
      .where(and(eq(billingAccountMembers.billingAccountId, id), eq(billingAccountMembers.userId, userId)));
    return accountDetail(id);
  });

  app.post('/api/iam/billing-accounts/:id/credit', async (request, reply): Promise<IamAccountDetail> => {
    const { id } = parse(IdParams, request.params);
    const body = parse(CreditBody, request.body);
    const amountNano = signedUsdToNano(body.amountUsd);
    if (body.kind === 'credit_grant' && amountNano <= 0n) {
      throw new HttpError(400, 'validation', 'A credit grant must be a positive amount. Use an adjustment to remove credit.');
    }
    if (amountNano === 0n) throw new HttpError(400, 'validation', 'The amount cannot be zero.');
    if (!(await db.query.billingAccounts.findFirst({ where: eq(billingAccounts.id, id) }))) throw notFound('Billing account');
    await grantCredit(db, {
      accountId: id,
      amountNano,
      kind: body.kind,
      reason: body.reason,
      createdBy: getAuth(request).user.id,
      source: 'manual',
    });
    reply.status(201);
    return accountDetail(id);
  });

  app.get('/api/iam/billing-accounts/:id/ledger', async (request): Promise<IamLedgerResponse> => {
    const { id } = parse(IdParams, request.params);
    const q = parse(LedgerQuery, request.query);
    const range = dateRange(q);
    let where = ledgerWhere(id, range);
    if (q.cursor) {
      const [ts, entryId] = decodeCursor(q.cursor);
      where = and(where, sql`(${ledgerEntries.createdAt}, ${ledgerEntries.id}) < (${ts}::timestamptz, ${entryId}::uuid)`)!;
    }
    const rows = await ledgerRows(where, q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      entries: page.map(({ _cursorTs: _c, ...e }) => e),
      from: range.from,
      to: range.to,
      nextCursor: rows.length > q.limit && last ? encodeCursor(last._cursorTs, last.id) : null,
    };
  });

  app.get('/api/iam/billing-accounts/:id/ledger.csv', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    const range = dateRange(parse(DateRangeQuery, request.query));
    const account = await db.query.billingAccounts.findFirst({ where: eq(billingAccounts.id, id) });
    if (!account) throw notFound('Billing account');
    const rows = await ledgerRows(ledgerWhere(id, range), CSV_ROW_LIMIT);
    const csv = toCsv(
      ['created_at', 'kind', 'amount_usd', 'balance_after_usd', 'user', 'user_email', 'model', 'created_by', 'reason', 'source', 'entry_id'],
      rows.map((r) => [
        r.createdAt,
        r.kind,
        nanoToUsd(BigInt(r.amountNanoUsd)),
        nanoToUsd(BigInt(r.balanceAfterNanoUsd)),
        r.userName,
        r.userEmail,
        r.modelName,
        r.createdByName,
        r.reason,
        r.source,
        r.id,
      ]),
    );
    return sendCsv(reply, `ledger-${slug(account.name)}-${range.from}-to-${range.to}.csv`, csv);
  });

  app.get('/api/iam/usage', async (request): Promise<UsageResponse> => {
    const q = parse(UsageQuery, request.query);
    const range = dateRange(q);
    return { groupBy: q.groupBy, from: range.from, to: range.to, rows: await usageReport(q.groupBy, range, q.accountId) };
  });

  app.get('/api/iam/usage.csv', async (request, reply) => {
    const q = parse(UsageQuery, request.query);
    const range = dateRange(q);
    const rows = await usageReport(q.groupBy, range, q.accountId);
    const csv = toCsv(
      [q.groupBy, 'requests', 'cost_usd', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens', 'web_searches'],
      rows.map((r) => [
        r.label,
        r.requests,
        nanoToUsd(BigInt(r.costNanoUsd)),
        r.inputTokens,
        r.cachedInputTokens,
        r.outputTokens,
        r.reasoningTokens,
        r.webSearches,
      ]),
    );
    return sendCsv(reply, `usage-by-${q.groupBy}-${range.from}-to-${range.to}.csv`, csv);
  });
}
