import type { ChatStreamEvent, InflightMessage } from '@wchats/shared';

type Listener = (event: ChatStreamEvent) => void;

/** Distributive Omit so each member of the event union keeps its own fields. */
type WithoutSeq<T> = T extends unknown ? Omit<T, 'seq'> : never;
export type MessageEventInput = WithoutSeq<Exclude<ChatStreamEvent, { type: 'snapshot' | 'session.updated' }>>;

/**
 * Fan-out of chat events to SSE listeners, plus the accumulated state of the
 * reply currently being generated in each session.
 *
 * `snapshotAndSubscribe` reads the state and registers the listener in the
 * same synchronous tick, so no event can fall between them: a reconnecting
 * client gets the partial reply and then every later delta, exactly once.
 *
 * This implementation is in-memory (one API process). A multi-instance
 * deployment swaps in a Postgres NOTIFY / Redis implementation of this interface.
 */
export interface ChatEventHub {
  begin(sessionId: string, messageId: string): void;
  publish(sessionId: string, event: MessageEventInput): ChatStreamEvent;
  /** Terminal event for the in-flight message; clears its state. */
  finish(sessionId: string, event: MessageEventInput & { type: 'done' | 'error' }): void;
  publishSession(sessionId: string, event: Extract<ChatStreamEvent, { type: 'session.updated' }>): void;
  snapshotAndSubscribe(sessionId: string, listener: Listener): { snapshot: InflightMessage | null; unsubscribe: () => void };
  inflight(sessionId: string): InflightMessage | null;
}

export class InMemoryChatEventHub implements ChatEventHub {
  private readonly states = new Map<string, InflightMessage>();
  private readonly listeners = new Map<string, Set<Listener>>();

  begin(sessionId: string, messageId: string): void {
    this.states.set(sessionId, { messageId, seq: 0, status: 'pending', content: '', thinking: false, sources: [] });
  }

  publish(sessionId: string, input: MessageEventInput): ChatStreamEvent {
    const state = this.states.get(sessionId);
    const seq = state && state.messageId === input.messageId ? ++state.seq : 0;
    const event = { ...input, seq } as ChatStreamEvent;
    if (state && state.messageId === input.messageId) {
      switch (event.type) {
        case 'message.started':
          state.status = 'streaming';
          break;
        case 'text.delta':
          state.status = 'streaming';
          state.content += event.text;
          state.thinking = false;
          break;
        case 'thinking':
          state.thinking = event.active;
          break;
        case 'tool.sources':
          state.sources = [...state.sources, ...event.sources];
          break;
        default:
          break;
      }
    }
    this.emit(sessionId, event);
    return event;
  }

  finish(sessionId: string, input: MessageEventInput & { type: 'done' | 'error' }): void {
    this.publish(sessionId, input);
    if (this.states.get(sessionId)?.messageId === input.messageId) this.states.delete(sessionId);
  }

  publishSession(sessionId: string, event: Extract<ChatStreamEvent, { type: 'session.updated' }>): void {
    this.emit(sessionId, event);
  }

  snapshotAndSubscribe(sessionId: string, listener: Listener) {
    const state = this.states.get(sessionId);
    const snapshot = state ? { ...state, sources: [...state.sources] } : null;
    let set = this.listeners.get(sessionId);
    if (!set) this.listeners.set(sessionId, (set = new Set()));
    set.add(listener);
    return {
      snapshot,
      unsubscribe: () => {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(sessionId);
      },
    };
  }

  inflight(sessionId: string): InflightMessage | null {
    return this.states.get(sessionId) ?? null;
  }

  private emit(sessionId: string, event: ChatStreamEvent): void {
    for (const l of this.listeners.get(sessionId) ?? []) {
      try {
        l(event);
      } catch {
        // A broken listener (closed socket) must not affect the others.
      }
    }
  }
}
