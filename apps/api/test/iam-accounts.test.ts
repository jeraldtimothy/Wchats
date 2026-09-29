import type { IamAccountDetail, IamLedgerEntry, IamLedgerResponse, UsageRow } from '@wchats/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../seed/models.config.js';
import { buildApp } from '../src/app.js';
import { assertCanSpend, ledgerSum } from '../src/billing/ledger.js';
import type { InlineTitleQueue } from '../src/chat/titles.js';
import { db } from '../src/db/client.js';
import { ledgerEntries, models } from '../src/db/schema.js';
import { csvCell, toCsv } from '../src/http/csv.js';
import { dateRange } from '../src/http/dates.js';
import { upsertModels } from '../src/models/catalog.js';
import { fakeRegistry } from './fakes.js';
import { manager, signUp, type TestUser } from './helpers.js';

let app: FastifyInstance;
let m: TestUser;
beforeAll(async () => {
  await upsertModels(db, seedModels);
  app = await buildApp({ providers: fakeRegistry().registry });
  m = await manager(app);
});
afterAll(async () => {
  await app.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object, cookie = m.cookie) =>
  app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

async function shared(name = 'Team') {
  const res = await call('POST', '/api/iam/billing-accounts', { name });
  expect(res.statusCode).toBe(201);
  return res.json() as IamAccountDetail;
}

describe('billing accounts', () => {
  it('creates, renames and disables a shared account; disabled accounts block spending', async () => {
    const a = await shared('Research');
    expect(a).toMatchObject({ kind: 'shared', balanceCents: 0, memberCount: 0, members: [] });
    const u = await signUp(app);
    await call('PUT', `/api/iam/billing-accounts/${a.id}/members/${u.id}`);
    await call('POST', `/api/iam/billing-accounts/${a.id}/credit`, { kind: 'credit_grant', amountUsd: '10', reason: 'Kickoff' });
    await expect(assertCanSpend(db, a.id, u.id)).resolves.toBeUndefined();

    const renamed = await call('PATCH', `/api/iam/billing-accounts/${a.id}`, { name: 'Research Lab', isDisabled: true });
    expect(renamed.json()).toMatchObject({ name: 'Research Lab', isDisabled: true });
    await expect(assertCanSpend(db, a.id, u.id)).rejects.toMatchObject({ code: 'billing_account_disabled' });

    const list = await call('GET', '/api/iam/billing-accounts?q=research%20lab');
    expect(list.json().accounts.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });

  it('adds and removes members; personal accounts stay single-owner', async () => {
    const a = await shared();
    const u = await signUp(app, 'Member One');
    const added = (await call('PUT', `/api/iam/billing-accounts/${a.id}/members/${u.id}`)).json() as IamAccountDetail;
    expect(added.members).toEqual([expect.objectContaining({ userId: u.id, name: 'Member One', isOwner: false })]);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: u.cookie } });
    expect(me.json().billingAccounts.map((x: { id: string }) => x.id)).toContain(a.id);

    const removed = (await call('DELETE', `/api/iam/billing-accounts/${a.id}/members/${u.id}`)).json();
    expect(removed.members).toEqual([]);

    const personal = me.json().billingAccounts.find((x: { kind: string }) => x.kind === 'personal');
    expect((await call('DELETE', `/api/iam/billing-accounts/${personal.id}/members/${u.id}`)).statusCode).toBe(400);
    expect((await call('PUT', `/api/iam/billing-accounts/${personal.id}/members/${m.id}`)).statusCode).toBe(400);
    expect((await call('PUT', `/api/iam/billing-accounts/${a.id}/members/nobody`)).statusCode).toBe(404);
  });

  it('grants and adjusts credit with a reason and records who did it', async () => {
    const a = await shared();
    const grant = await call('POST', `/api/iam/billing-accounts/${a.id}/credit`, { kind: 'credit_grant', amountUsd: '25.50', reason: 'Q3 budget' });
    expect(grant.statusCode).toBe(201);
    expect(grant.json().balanceCents).toBe(2550);
    const adj = await call('POST', `/api/iam/billing-accounts/${a.id}/credit`, { kind: 'adjustment', amountUsd: '-0.50', reason: 'Correction' });
    expect(adj.json().balanceCents).toBe(2500);
    expect(await ledgerSum(db, a.id)).toBe(25_000_000_000n);

    const bad = (payload: object) => call('POST', `/api/iam/billing-accounts/${a.id}/credit`, payload).then((r) => r.statusCode);
    expect(await bad({ kind: 'credit_grant', amountUsd: '-5', reason: 'x' })).toBe(400);
    expect(await bad({ kind: 'adjustment', amountUsd: '0', reason: 'x' })).toBe(400);
    expect(await bad({ kind: 'credit_grant', amountUsd: '5', reason: '  ' })).toBe(400);
    expect(await bad({ kind: 'credit_grant', amountUsd: '5.123', reason: 'x' })).toBe(400);

    const ledger = (await call('GET', `/api/iam/billing-accounts/${a.id}/ledger`)).json();
    expect(ledger.entries.map((e: IamLedgerEntry) => [e.kind, e.reason, e.createdByName])).toEqual([
      ['adjustment', 'Correction', 'Manager'],
      ['credit_grant', 'Q3 budget', 'Manager'],
    ]);
  });

  it('pages the ledger exactly, newest first', async () => {
    const a = await shared();
    for (let i = 1; i <= 7; i++) {
      await call('POST', `/api/iam/billing-accounts/${a.id}/credit`, { kind: 'credit_grant', amountUsd: String(i), reason: `r${i}` });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: IamLedgerResponse = (await call('GET', `/api/iam/billing-accounts/${a.id}/ledger?limit=3${cursor ? `&cursor=${cursor}` : ''}`)).json();
      seen.push(...page.entries.map((e) => e.reason ?? ""));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1']);
    expect((await call('GET', `/api/iam/billing-accounts/${a.id}/ledger?cursor=garbage`)).statusCode).toBe(400);
  });

  it('filters the ledger by inclusive UTC date range', async () => {
    const a = await shared();
    await call('POST', `/api/iam/billing-accounts/${a.id}/credit`, { kind: 'credit_grant', amountUsd: '1', reason: 'old' });
    await db.update(ledgerEntries).set({ createdAt: new Date('2026-01-15T23:59:00Z') }).where(eq(ledgerEntries.reason, 'old'));
    const inRange = await call('GET', `/api/iam/billing-accounts/${a.id}/ledger?from=2026-01-15&to=2026-01-15`);
    expect(inRange.json().entries.map((e: IamLedgerEntry) => e.reason)).toEqual(['old']);
    const outside = await call('GET', `/api/iam/billing-accounts/${a.id}/ledger?from=2026-01-16&to=2026-01-20`);
    expect(outside.json().entries).toEqual([]);
    expect((await call('GET', `/api/iam/billing-accounts/${a.id}/ledger?from=2026-02-01&to=2026-01-01`)).statusCode).toBe(400);
    expect(dateRange({}, new Date('2026-09-29T10:00:00Z'))).toMatchObject({ from: '2026-08-31', to: '2026-09-29' });
  });

  it('reports usage by user and by model, and exports CSV', async () => {
    const a = await shared('Usage Co');
    const [u1, u2] = [await signUp(app, 'Uno'), await signUp(app, 'Dos')];
    for (const u of [u1, u2]) await call('PUT', `/api/iam/billing-accounts/${a.id}/members/${u.id}`);
    await call('POST', `/api/iam/billing-accounts/${a.id}/credit`, { kind: 'credit_grant', amountUsd: '10', reason: 'seed' });

    const chat = async (u: TestUser, slug: string) => {
      const model = (await db.query.models.findFirst({ where: eq(models.slug, slug) }))!;
      const s = (await call('POST', '/api/chat/v2/sessions', { modelId: model.id, billingAccountId: a.id }, u.cookie)).json();
      await call('POST', `/api/chat/v2/session/${s.session.id}/post-message`, { text: 'hi' }, u.cookie);
      await app.chat.runner.idle();
      await (app.chat.titles as InlineTitleQueue).idle();
    };
    await chat(u1, 'gpt-5.6-luna');
    await chat(u2, 'claude-sonnet-5');

    const byUser = (await call('GET', `/api/iam/usage?groupBy=user&accountId=${a.id}`)).json().rows as UsageRow[];
    expect(byUser.map((r) => r.label).sort()).toEqual([`Dos <${u2.email}>`, `Uno <${u1.email}>`]);
    const uno = byUser.find((r) => r.key === u1.id)!;
    expect(uno).toMatchObject({ requests: 2, inputTokens: 10, outputTokens: 5 }); // reply + title; title has no message tokens
    const total = byUser.reduce((s, r) => s + BigInt(r.costNanoUsd), 0n);
    expect(10_000_000_000n - total).toBe(await ledgerSum(db, a.id));

    const byModel = (await call('GET', `/api/iam/usage?groupBy=model&accountId=${a.id}`)).json().rows as UsageRow[];
    expect(byModel.map((r) => r.label)).toEqual(expect.arrayContaining(['GPT-5.6 Luna', 'Claude Sonnet 5']));

    const csv = await call('GET', `/api/iam/usage.csv?groupBy=model&accountId=${a.id}`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="usage-by-model-/);
    expect(csv.body.split('\r\n')[0]).toBe('model,requests,cost_usd,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,web_searches');

    const ledgerCsv = await call('GET', `/api/iam/billing-accounts/${a.id}/ledger.csv`);
    expect(ledgerCsv.headers['content-disposition']).toMatch(/ledger-usage-co-/);
    expect(ledgerCsv.body).toMatch(/usage_charge,-0\.\d{9},/);
  });

  it('is manager-only', async () => {
    const u = await signUp(app);
    expect((await call('GET', '/api/iam/billing-accounts', undefined, u.cookie)).statusCode).toBe(403);
    expect((await call('GET', '/api/iam/usage.csv', undefined, u.cookie)).statusCode).toBe(403);
  });
});

describe('csv', () => {
  it('quotes and neutralises formulas but keeps numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-0.500000000')).toBe('-0.500000000');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, 'x\ny']])).toBe('a,b\r\n1,"x\ny"\r\n');
  });
});
