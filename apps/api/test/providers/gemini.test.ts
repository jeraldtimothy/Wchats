import type { GoogleGenAI } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../../src/providers/gemini.js';
import { baseRequest, collect, stream, texts } from './helpers.js';

function mockClient(chunks: unknown[]) {
  const generateContentStream = vi.fn(async (_params: Record<string, unknown>) => stream(chunks));
  const list = vi.fn(async () => stream([{ name: 'models/gemini-x' }, { name: 'models/gemini-y' }]));
  return { client: { models: { generateContentStream, list } } as unknown as GoogleGenAI, generateContentStream };
}

const usageMetadata = {
  promptTokenCount: 1200,
  cachedContentTokenCount: 200,
  toolUsePromptTokenCount: 50,
  candidatesTokenCount: 300,
  thoughtsTokenCount: 150,
};

describe('GeminiProvider', () => {
  it('maps contents, system instruction, search tool and thinking budget', async () => {
    const { client, generateContentStream } = mockClient([{ candidates: [{ finishReason: 'STOP' }], usageMetadata }]);
    await collect(
      new GeminiProvider({ client }).streamChat(baseRequest({ effort: 'low', thinkingBudgets: { low: 2048 }, webSearch: true })),
    );
    const params = generateContentStream.mock.calls[0]![0] as {
      model: string;
      contents: { role: string; parts: unknown[] }[];
      config: Record<string, unknown>;
    };
    expect(params.model).toBe('test-model');
    expect(params.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(params.contents[2]!.parts).toEqual([
      { text: 'Look at these' },
      { inlineData: { mimeType: 'image/png', data: 'aW1n' } },
      { inlineData: { mimeType: 'application/pdf', data: 'cGRm' } },
    ]);
    expect(params.config).toMatchObject({
      systemInstruction: 'You are helpful.',
      maxOutputTokens: 1000,
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: 2048 },
    });
  });

  it('turns thinking off for none and uses thinking levels without a budget', async () => {
    const a = mockClient([{ candidates: [{ finishReason: 'STOP' }] }]);
    await collect(new GeminiProvider({ client: a.client }).streamChat(baseRequest({ effort: 'none' })));
    expect(a.generateContentStream.mock.calls[0]![0]).toMatchObject({ config: { thinkingConfig: { thinkingBudget: 0 } } });

    const b = mockClient([{ candidates: [{ finishReason: 'STOP' }] }]);
    await collect(new GeminiProvider({ client: b.client }).streamChat(baseRequest({ effort: 'high' })));
    expect(b.generateContentStream.mock.calls[0]![0]).toMatchObject({ config: { thinkingConfig: { thinkingLevel: 'HIGH' } } });
  });

  it('normalizes thoughts, text, grounding sources and usage', async () => {
    const { client } = mockClient([
      { candidates: [{ content: { parts: [{ thought: true, text: 'hmm' }] } }] },
      {
        candidates: [
          {
            content: { parts: [{ text: 'Paris is ' }] },
            groundingMetadata: {
              webSearchQueries: ['capital of france'],
              groundingChunks: [{ web: { uri: 'https://a.test', title: 'A' } }],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: { parts: [{ text: 'the capital.' }] },
            finishReason: 'STOP',
            groundingMetadata: {
              webSearchQueries: ['capital of france'],
              groundingChunks: [{ web: { uri: 'https://a.test', title: 'A' } }, { web: { uri: 'https://b.test' } }],
            },
          },
        ],
        usageMetadata,
      },
    ]);
    const events = await collect(new GeminiProvider({ client }).streamChat(baseRequest({ webSearch: true })));
    expect(texts(events)).toBe('Paris is the capital.');
    expect(events).toContainEqual({ type: 'reasoning.delta', text: 'hmm' });
    expect(events).toContainEqual({ type: 'tool.started', tool: 'web_search', query: 'capital of france' });
    expect(events.flatMap((e) => (e.type === 'tool.sources' ? e.sources : []))).toEqual([
      { url: 'https://a.test', title: 'A' },
      { url: 'https://b.test', title: undefined },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'done',
      stopReason: 'complete',
      usage: { inputTokens: 1050, cachedInputTokens: 200, outputTokens: 300, reasoningTokens: 150, webSearches: 1 },
      rawUsage: usageMetadata,
    });
  });

  it('maps SAFETY to refusal, MAX_TOKENS to max_tokens, and prompt blocks to refusal', async () => {
    const s = mockClient([{ candidates: [{ finishReason: 'SAFETY' }], usageMetadata }]);
    const a = await collect(new GeminiProvider({ client: s.client }).streamChat(baseRequest()));
    expect(a.map((e) => e.type)).toEqual(['refusal', 'done']);

    const m = mockClient([{ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata }]);
    const b = await collect(new GeminiProvider({ client: m.client }).streamChat(baseRequest()));
    expect(b.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_tokens' });

    const blocked = mockClient([{ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata }]);
    const c = await collect(new GeminiProvider({ client: blocked.client }).streamChat(baseRequest()));
    expect(c.at(-1)).toMatchObject({ type: 'done', stopReason: 'refusal' });
  });

  it('lists model ids without the models/ prefix', async () => {
    const { client } = mockClient([]);
    expect(await new GeminiProvider({ client }).listModels()).toEqual(['gemini-x', 'gemini-y']);
  });
});
