import { PROVIDER_LABELS, type Effort, type Provider } from '@wchats/shared';
import type { ChatRequest, ContentPart, LLMProvider, ProviderEvent, Source, Usage } from './types.js';

/**
 * A stand-in for a real provider, used when LLM_SIMULATION=1. It never calls
 * the network: replies are generated locally but travel through the normal
 * pipeline (streaming, reasoning indicator, web search sources, usage,
 * billing), so the whole app can be exercised without real API keys.
 *
 * Trigger phrases in the user's message demo the error states:
 *   [simulate refusal] · [simulate truncation] · [simulate error]
 */
export interface SimulatedProviderOptions {
  /** Pause between streamed chunks, in ms (tests use 0). */
  delayMs?: number;
}

const REASONING_TOKENS: Record<Effort, number> = { none: 0, low: 120, medium: 360, high: 900, xhigh: 1600 };
const IMAGE_TOKENS = 800;
const DOCUMENT_TOKENS = 1500;

const sleep = (ms: number, signal?: AbortSignal) =>
  ms <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      });

const tokens = (chars: number) => Math.max(1, Math.ceil(chars / 4));
const textOf = (parts: ContentPart[]) =>
  parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n');

function lastUserParts(req: ChatRequest): ContentPart[] {
  return [...req.messages].reverse().find((m) => m.role === 'user')?.parts ?? [];
}

/** The user's own words in the last turn (attachment text parts excluded). */
function question(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text' && !p.text.startsWith('[Attached file'))
    .map((p) => p.text)
    .join(' ')
    .trim();
}

function titleFrom(prompt: string): string {
  const user = /User:\s*([^\n]*)/.exec(prompt)?.[1] ?? '';
  const words = user
    .replace(/\[simulate [a-z]+\]/gi, '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length === 0) return 'Simulated conversation';
  const t = words.join(' ');
  return t[0]!.toUpperCase() + t.slice(1);
}

function memoriesFrom(prompt: string): string {
  const items: { type: string; content: string; session: number }[] = [];
  let session = 0;
  for (const line of prompt.split('\n')) {
    const header = /^## Conversation (\d+)/.exec(line);
    if (header) session = Number(header[1]);
    const m = /^User:\s*((I (?:prefer|like|love|am|live|work)\b|Remember\b)[^\n]{0,160})/i.exec(line);
    if (!m || items.length >= 5) continue;
    const said = m[1]!.trim();
    const type = /^remember/i.test(said) ? 'reminder' : /^I (prefer|like|love)/i.test(said) ? 'preference' : 'fact';
    items.push({ type, content: `(Simulated) The user said: "${said}"`, session });
  }
  return JSON.stringify({ items });
}

function replyFor(provider: Provider, req: ChatRequest, parts: ContentPart[], sources: Source[]): string {
  const q = question(parts).replace(/\[simulate [a-z]+\]/gi, '').trim();
  const files = parts.filter((p) => p.type !== 'text' || p.text.startsWith('[Attached file'));
  const fileNames = files.map((p) =>
    p.type === 'image' ? 'an image' : p.type === 'document' ? p.filename : (/\[Attached file: ([^\]]+)\]/.exec(p.text)?.[1] ?? 'a file'),
  );
  const lines = [
    `**Simulated reply** from \`${req.model}\` (${PROVIDER_LABELS[provider]}). No real model was called.`,
    '',
    q ? `You asked: “${q.length > 240 ? `${q.slice(0, 237)}…` : q}”` : 'You sent files without a question.',
  ];
  if (fileNames.length) lines.push('', `I received ${fileNames.length} attachment${fileNames.length > 1 ? 's' : ''}: ${fileNames.join(', ')}.`);
  lines.push(
    '',
    'A real model would answer here. This simulated answer shows how replies render:',
    '',
    '- A direct answer to your question',
    `- Supporting detail${sources.length ? ` citing web results [1](${sources[0]!.url})` : ''}`,
    '- Suggested next steps',
    '',
    '| Setting | Value |',
    '|---|---|',
    `| Thinking effort | ${req.effort ?? 'not available'} |`,
    `| Web search | ${req.webSearch ? 'on' : 'off'} |`,
    `| Attachments | ${fileNames.length} |`,
    '',
    '```ts',
    `const reply = await ask(${JSON.stringify(req.model)}, question);`,
    '```',
  );
  return lines.join('\n');
}

export class SimulatedProvider implements LLMProvider {
  private readonly delayMs: number;

  constructor(
    readonly id: Provider,
    opts: SimulatedProviderOptions = {},
  ) {
    this.delayMs = opts.delayMs ?? 20;
  }

  isConfigured(): boolean {
    return true;
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async *streamChat(req: ChatRequest): AsyncIterable<ProviderEvent> {
    const parts = lastUserParts(req);
    const promptText = textOf(parts);
    const inputChars = req.system.length + req.messages.reduce((n, m) => n + textOf(m.parts).length, 0);
    const binaryTokens = req.messages
      .flatMap((m) => m.parts)
      .reduce((n, p) => n + (p.type === 'image' ? IMAGE_TOKENS : p.type === 'document' ? DOCUMENT_TOKENS : 0), 0);
    const usage = (outputChars: number, extra: Partial<Usage> = {}): Usage => ({
      inputTokens: tokens(inputChars) + binaryTokens,
      cachedInputTokens: 0,
      outputTokens: tokens(outputChars),
      reasoningTokens: 0,
      webSearches: 0,
      ...extra,
    });

    // Background prompts get answers in the format their callers parse.
    if (req.system.startsWith('You write short titles')) {
      const title = titleFrom(promptText);
      yield { type: 'text.delta', text: title };
      yield { type: 'done', stopReason: 'complete', usage: usage(title.length), rawUsage: { simulated: true } };
      return;
    }
    if (req.system.startsWith('You maintain a short list')) {
      const json = memoriesFrom(promptText);
      yield { type: 'text.delta', text: json };
      yield { type: 'done', stopReason: 'complete', usage: usage(json.length), rawUsage: { simulated: true } };
      return;
    }

    const lowered = promptText.toLowerCase();
    if (lowered.includes('[simulate refusal]')) {
      yield { type: 'refusal' };
      yield { type: 'done', stopReason: 'refusal', usage: usage(0), rawUsage: { simulated: true } };
      return;
    }
    if (lowered.includes('[simulate error]')) {
      await sleep(this.delayMs * 5, req.signal);
      yield { type: 'error', message: 'Simulated provider error.', usage: usage(0), rawUsage: { simulated: true } };
      return;
    }

    const reasoning = req.effort ? REASONING_TOKENS[req.effort] : 0;
    if (reasoning > 0) {
      yield { type: 'reasoning.delta' };
      await sleep(this.delayMs * 15, req.signal);
    }

    const sources: Source[] = [];
    let webSearches = 0;
    if (req.webSearch) {
      const q = question(parts).split(/\s+/).slice(0, 8).join(' ') || 'your question';
      const rounds = req.multiTurnTools ? 2 : 1;
      for (let i = 1; i <= rounds; i++) {
        const query = i === 1 ? q : `${q} details`;
        yield { type: 'tool.started', tool: 'web_search', query };
        await sleep(this.delayMs * 10, req.signal);
        const found = [
          { url: `https://example.com/search?q=${encodeURIComponent(query)}&r=1`, title: `Example result for “${query}”` },
          { url: `https://example.org/articles/${i}`, title: `Example article ${i} (simulated source)` },
        ];
        sources.push(...found);
        webSearches += 1;
        yield { type: 'tool.sources', sources: found };
      }
    }

    const full = replyFor(this.id, req, parts, sources);
    const truncate = lowered.includes('[simulate truncation]');
    const text = truncate ? full.slice(0, Math.floor(full.length / 3)) : full;
    let sent = 0;
    for (const chunk of text.match(/\S+\s*/g) ?? []) {
      if (req.signal?.aborted) {
        yield { type: 'error', message: 'The request was cancelled.', usage: usage(sent, { reasoningTokens: reasoning, webSearches }), rawUsage: { simulated: true } };
        return;
      }
      yield { type: 'text.delta', text: chunk };
      sent += chunk.length;
      await sleep(this.delayMs, req.signal);
    }
    yield {
      type: 'done',
      stopReason: truncate ? 'max_tokens' : 'complete',
      usage: usage(sent, { reasoningTokens: reasoning, webSearches }),
      rawUsage: { simulated: true },
    };
  }
}
