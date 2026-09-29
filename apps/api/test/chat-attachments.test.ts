import { FILES_ONLY_PROMPT, type SessionDetail } from '@wchats/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedModels } from '../seed/models.config.js';
import { buildApp } from '../src/app.js';
import { grantCredit } from '../src/billing/ledger.js';
import type { InlineTitleQueue } from '../src/chat/titles.js';
import { db } from '../src/db/client.js';
import { billingAccounts, messages, models } from '../src/db/schema.js';
import { upsertModels } from '../src/models/catalog.js';
import type { ContentPart, ProviderEvent } from '../src/providers/types.js';
import { fakeRegistry } from './fakes.js';
import { signUp } from './helpers.js';
import { PDF, PNG, docx, para } from './office-fixtures.js';

const { registry, providers } = fakeRegistry();
const defaultScript = providers.openai.script;
let app: FastifyInstance;

beforeAll(async () => {
  await upsertModels(db, seedModels);
  app = await buildApp({ providers: registry });
});
afterEach(async () => {
  await app.chat.runner.idle();
  await (app.chat.titles as InlineTitleQueue).idle();
  providers.openai.script = defaultScript;
  await upsertModels(db, seedModels);
});
afterAll(async () => {
  await app.close();
});

async function setup(slug = 'gpt-5.6-luna') {
  const u = await signUp(app);
  const account = (await db.query.billingAccounts.findFirst({
    where: and(eq(billingAccounts.ownerUserId, u.id), eq(billingAccounts.kind, 'personal')),
  }))!;
  await grantCredit(db, { accountId: account.id, amountNano: 1_000_000_000n, reason: 'test' });
  const model = (await db.query.models.findFirst({ where: eq(models.slug, slug) }))!;
  const s = (
    await app.inject({
      method: 'POST',
      url: '/api/chat/v2/sessions',
      headers: { cookie: u.cookie },
      payload: { modelId: model.id, billingAccountId: account.id },
    })
  ).json() as SessionDetail;
  return { u, sessionId: s.session.id };
}

async function upload(cookie: string, filename: string, data: Uint8Array) {
  const boundary = '----b';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`),
    Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    payload,
    headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const post = (cookie: string, sessionId: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/chat/v2/session/${sessionId}/post-message`, headers: { cookie }, payload });

const lastUserParts = (): ContentPart[] => {
  const req = providers.openai.requests.filter((r) => !r.system.startsWith('You write short titles')).at(-1)!;
  return req.messages.at(-1)!.parts;
};

describe('attachments in chat', () => {
  it('sends office text, images and PDFs as parts, then the prompt', async () => {
    const { u, sessionId } = await setup();
    const ids = [
      await upload(u.cookie, 'plan.docx', docx(para('Launch in May'))),
      await upload(u.cookie, 'chart.png', PNG),
      await upload(u.cookie, 'report.pdf', PDF),
    ];
    const res = await post(u.cookie, sessionId, { text: 'Summarize these', attachmentIds: ids });
    expect(res.statusCode).toBe(202);
    expect(res.json().userMessage.attachments.map((a: { filename: string }) => a.filename)).toEqual([
      'plan.docx',
      'chart.png',
      'report.pdf',
    ]);
    await app.chat.runner.idle();

    expect(lastUserParts()).toEqual([
      { type: 'text', text: '[Attached file: plan.docx]\n\nLaunch in May' },
      { type: 'image', mediaType: 'image/png', data: PNG.toString('base64') },
      { type: 'document', mediaType: 'application/pdf', data: PDF.toString('base64'), filename: 'report.pdf' },
      { type: 'text', text: 'Summarize these' },
    ]);
    const detail = (await app.inject({ method: 'GET', url: `/api/chat/v2/session/${sessionId}`, headers: { cookie: u.cookie } })).json() as SessionDetail;
    expect(detail.messages[0]!.attachments).toHaveLength(3);

    // Attachments stay in the history on later turns.
    await post(u.cookie, sessionId, { text: 'And the risks?' });
    await app.chat.runner.idle();
    const req = providers.openai.requests.filter((r) => !r.system.startsWith('You write short titles')).at(-1)!;
    expect(req.messages[0]!.parts.map((p) => p.type)).toEqual(['text', 'image', 'document', 'text']);
  });

  it('uses the placeholder prompt for files-only messages', async () => {
    const { u, sessionId } = await setup();
    const id = await upload(u.cookie, 'data.csv', Buffer.from('a,b\n1,2'));
    const res = await post(u.cookie, sessionId, { text: '   ', attachmentIds: [id] });
    expect(res.statusCode).toBe(202);
    expect(res.json().userMessage.content).toBe('');
    await app.chat.runner.idle();
    expect(lastUserParts().at(-1)).toEqual({ type: 'text', text: FILES_ONLY_PROMPT });
  });

  it("gates images and PDFs by the model's capabilities", async () => {
    const { u, sessionId } = await setup();
    await db.update(models).set({ supportsImages: false, supportsDocuments: false }).where(eq(models.slug, 'gpt-5.6-luna'));
    const img = await upload(u.cookie, 'a.png', PNG);
    const pdf = await upload(u.cookie, 'a.pdf', PDF);
    const txt = await upload(u.cookie, 'a.txt', Buffer.from('fine'));
    expect((await post(u.cookie, sessionId, { text: 'x', attachmentIds: [img] })).json().error.message).toContain("can't read images");
    expect((await post(u.cookie, sessionId, { text: 'x', attachmentIds: [pdf] })).json().error.message).toContain("can't read PDFs");
    expect((await post(u.cookie, sessionId, { text: 'x', attachmentIds: [txt] })).statusCode).toBe(202);
  });

  it("rejects files that were already sent or belong to someone else", async () => {
    const a = await setup();
    const b = await setup();
    const id = await upload(a.u.cookie, 'a.txt', Buffer.from('mine'));
    expect((await post(b.u.cookie, b.sessionId, { text: 'x', attachmentIds: [id] })).statusCode).toBe(400);
    expect((await post(a.u.cookie, a.sessionId, { text: 'x', attachmentIds: [id] })).statusCode).toBe(202);
    await app.chat.runner.idle();
    expect((await post(a.u.cookie, a.sessionId, { text: 'again', attachmentIds: [id] })).statusCode).toBe(400);
    const del = await app.inject({ method: 'DELETE', url: `/api/uploads/${id}`, headers: { cookie: a.u.cookie } });
    expect(del.statusCode).toBe(409);
  });
});

describe('web search', () => {
  it('passes web search and multi-turn options through and stores sources', async () => {
    const { u, sessionId } = await setup('claude-sonnet-5');
    providers.anthropic.script = async function* (): AsyncGenerator<ProviderEvent> {
      yield { type: 'tool.started', tool: 'web_search', query: 'weather' };
      yield { type: 'tool.sources', sources: [{ url: 'https://w.test', title: 'Weather' }] };
      yield { type: 'text.delta', text: 'Sunny.' };
      yield {
        type: 'done',
        stopReason: 'complete',
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 0, webSearches: 1 },
        rawUsage: {},
      };
    };
    const res = await post(u.cookie, sessionId, { text: 'Weather?', webSearch: true, multiTurn: true });
    expect(res.json().userMessage.webSearch).toBe(true);
    await app.chat.runner.idle();
    const req = providers.anthropic.requests.at(-1)!;
    expect(req).toMatchObject({ webSearch: true, multiTurnTools: true });

    const reply = (await db.query.messages.findFirst({ where: eq(messages.id, res.json().assistantMessage.id) }))!;
    expect(reply.sources).toEqual([{ url: 'https://w.test', title: 'Weather' }]);
    expect(reply.usage).toMatchObject({ webSearches: 1 });
    providers.anthropic.script = defaultScript;
  });

  it('ignores web search for models without it', async () => {
    const { u, sessionId } = await setup();
    await db.update(models).set({ webSearchEnabled: false }).where(eq(models.slug, 'gpt-5.6-luna'));
    const res = await post(u.cookie, sessionId, { text: 'x', webSearch: true });
    expect(res.json().userMessage.webSearch).toBe(false);
    await app.chat.runner.idle();
    expect(providers.openai.requests.at(-1)!.webSearch).toBe(false);
  });
});

