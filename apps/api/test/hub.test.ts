import type { ChatStreamEvent } from '@wchats/shared';
import { describe, expect, it } from 'vitest';
import { InMemoryChatEventHub } from '../src/chat/hub.js';

describe('InMemoryChatEventHub', () => {
  it('accumulates in-flight state and numbers events', () => {
    const hub = new InMemoryChatEventHub();
    hub.begin('s1', 'm1');
    hub.publish('s1', { type: 'message.started', messageId: 'm1' });
    hub.publish('s1', { type: 'thinking', messageId: 'm1', active: true });
    hub.publish('s1', { type: 'text.delta', messageId: 'm1', text: 'Hel' });
    hub.publish('s1', { type: 'tool.sources', messageId: 'm1', sources: [{ url: 'https://a.test' }] });
    const e = hub.publish('s1', { type: 'text.delta', messageId: 'm1', text: 'lo' });
    expect(e).toMatchObject({ seq: 5 });
    expect(hub.inflight('s1')).toEqual({
      messageId: 'm1',
      seq: 5,
      status: 'streaming',
      content: 'Hello',
      thinking: false,
      sources: [{ url: 'https://a.test' }],
    });
  });

  it('replays exactly: snapshot + later events reconstruct the full reply', () => {
    const hub = new InMemoryChatEventHub();
    hub.begin('s1', 'm1');
    hub.publish('s1', { type: 'text.delta', messageId: 'm1', text: 'one ' });
    hub.publish('s1', { type: 'text.delta', messageId: 'm1', text: 'two ' });

    const received: ChatStreamEvent[] = [];
    const { snapshot, unsubscribe } = hub.snapshotAndSubscribe('s1', (ev) => received.push(ev));
    hub.publish('s1', { type: 'text.delta', messageId: 'm1', text: 'three' });
    hub.finish('s1', { type: 'done', messageId: 'm1', status: 'complete', costNanoUsd: '1', balanceCents: 0 });

    const rebuilt =
      snapshot!.content + received.map((ev) => (ev.type === 'text.delta' ? ev.text : '')).join('');
    expect(rebuilt).toBe('one two three');
    expect(received.at(-1)).toMatchObject({ type: 'done', seq: 4 });
    expect(hub.inflight('s1')).toBeNull();

    unsubscribe();
    hub.publishSession('s1', { type: 'session.updated', sessionId: 's1', title: 'x' });
    expect(received).toHaveLength(2);
  });

  it('isolates sessions and survives a throwing listener', () => {
    const hub = new InMemoryChatEventHub();
    hub.begin('a', 'ma');
    const got: string[] = [];
    hub.snapshotAndSubscribe('a', () => {
      throw new Error('socket closed');
    });
    hub.snapshotAndSubscribe('a', (ev) => got.push(ev.type));
    hub.snapshotAndSubscribe('b', (ev) => got.push(`b:${ev.type}`));
    hub.publish('a', { type: 'text.delta', messageId: 'ma', text: 'x' });
    expect(got).toEqual(['text.delta']);
  });
});
