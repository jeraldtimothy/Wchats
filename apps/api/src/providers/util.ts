import type { ChatMessage, ContentPart, Source } from './types.js';

/** Merges consecutive same-role turns (providers expect alternation). */
export function mergeTurns(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (last && last.role === m.role) last.parts = [...last.parts, ...m.parts];
    else out.push({ role: m.role, parts: [...m.parts] });
  }
  return out;
}

export function textOf(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
}

/** Tracks URLs already emitted so each source is reported once per reply. */
export class SourceSet {
  private readonly seen = new Set<string>();
  add(sources: Source[]): Source[] {
    const fresh = sources.filter((s) => s.url && !this.seen.has(s.url));
    for (const s of fresh) this.seen.add(s.url);
    return fresh;
  }
}

const SECRET_PATTERN = /\b(sk-[A-Za-z0-9_-]{6,}|sk-ant-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]{10,})[A-Za-z0-9_*.-]*/g;

/**
 * Turns an SDK error into a message that is safe to store and show: no keys,
 * no request bodies. Auth failures get a generic text.
 */
export function safeErrorMessage(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return 'The provider rejected the API credentials.';
  if (status === 429) return 'The provider is rate limiting requests. Try again shortly.';
  if (status === 404) return 'The provider does not recognise this model id.';
  if ((err as { name?: string })?.name === 'AbortError') return 'The request was cancelled.';
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw.replace(SECRET_PATTERN, '[redacted]').slice(0, 300);
  return status && status >= 500 ? `The provider had an internal error (${status}).` : cleaned || 'Provider error';
}

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
