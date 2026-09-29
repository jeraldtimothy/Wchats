import type { ChatStreamEvent, InflightMessage, SessionDetail, SessionSummary } from '@wchats/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { qk } from '../../api/queries';

export type Connection = 'connecting' | 'open' | 'reconnecting';

/**
 * Subscribes to /listen. Every (re)connect starts with a snapshot of the
 * in-flight reply, so a dropped connection resumes where it left off; deltas
 * are applied only if their seq is newer than what we have.
 */
export interface StreamOptions {
  /** SSE endpoint; defaults to the chat listen URL. */
  url?: string;
  /** Query key of the session detail to refetch; defaults to the chat session key. */
  detailKey?: readonly unknown[];
  /** Called when a reply finishes (done or error). */
  onTerminal?: () => void;
}

export function useSessionStream(sessionId: string, options: StreamOptions = {}) {
  const qc = useQueryClient();
  const url = options.url ?? `/api/chat/v2/session/${sessionId}/listen`;
  const detailKey = options.detailKey ?? qk.session(sessionId);
  const detailKeyJson = JSON.stringify(detailKey);
  const onTerminal = useRef(options.onTerminal);
  useEffect(() => {
    onTerminal.current = options.onTerminal;
  });
  const [inflight, setInflight] = useState<InflightMessage | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [activity, setActivity] = useState<string | null>(null);

  // The caller remounts per session (key={sessionId}), so state starts fresh for each one.
  useEffect(() => {
    const es = new EventSource(url);
    const key = JSON.parse(detailKeyJson) as unknown[];
    const refetch = () => {
      void qc.invalidateQueries({ queryKey: key });
    };

    const apply = (ev: Exclude<ChatStreamEvent, { type: 'snapshot' | 'session.updated' }>) => {
      setInflight((prev) => {
        const base: InflightMessage =
          prev && prev.messageId === ev.messageId
            ? prev
            : { messageId: ev.messageId, seq: 0, status: 'pending', content: '', thinking: false, sources: [] };
        if (ev.seq <= base.seq) return prev;
        const next = { ...base, seq: ev.seq };
        switch (ev.type) {
          case 'message.started':
            return { ...next, status: 'streaming' };
          case 'text.delta':
            return { ...next, status: 'streaming', content: base.content + ev.text, thinking: false };
          case 'thinking':
            return { ...next, thinking: ev.active };
          case 'tool.sources':
            return { ...next, sources: [...base.sources, ...ev.sources] };
          default:
            return next;
        }
      });
    };

    const handlers: { [K in ChatStreamEvent['type']]: (ev: Extract<ChatStreamEvent, { type: K }>) => void } = {
      snapshot: (ev) => {
        setConnection('open');
        setInflight(ev.inflight);
        refetch();
      },
      'message.started': (ev) => {
        setActivity(null);
        apply(ev);
      },
      'text.delta': (ev) => {
        setActivity(null);
        apply(ev);
      },
      thinking: apply,
      'tool.started': (ev) => {
        setActivity(ev.query ? `Searching the web for “${ev.query}”…` : 'Searching the web…');
        apply(ev);
      },
      'tool.sources': apply,
      refusal: apply,
      error: () => {
        setInflight(null);
        setActivity(null);
        refetch();
        onTerminal.current?.();
      },
      done: () => {
        setInflight(null);
        setActivity(null);
        refetch();
        void qc.invalidateQueries({ queryKey: qk.me });
        onTerminal.current?.();
      },
      'session.updated': (ev) => {
        qc.setQueryData<SessionSummary[]>(qk.sessions, (list) =>
          list?.map((s) => (s.id === ev.sessionId ? { ...s, title: ev.title } : s)),
        );
        qc.setQueryData<SessionDetail>(qk.session(ev.sessionId), (d) =>
          d ? { ...d, session: { ...d.session, title: ev.title } } : d,
        );
      },
    };

    for (const type of Object.keys(handlers) as ChatStreamEvent['type'][]) {
      es.addEventListener(type, (e) => {
        const data = JSON.parse((e as MessageEvent<string>).data) as ChatStreamEvent;
        (handlers[type] as (ev: ChatStreamEvent) => void)(data);
      });
    }
    es.onerror = () => setConnection('reconnecting');
    return () => es.close();
  }, [sessionId, url, detailKeyJson, qc]);

  return { inflight, connection, activity };
}
