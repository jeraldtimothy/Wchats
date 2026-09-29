import { CHAT_ERROR_TEXT, type InflightMessage, type MessageDto } from '@wchats/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertIcon, ArrowDownIcon, CopyIcon } from '../icons';
import { useCopy } from '../Toast';
import { Markdown } from './Markdown';

export interface LocalError {
  afterMessageId: string | null;
  text: string;
}

export function MessageList({
  messages,
  inflight,
  activity,
  localError,
}: {
  messages: MessageDto[];
  inflight: InflightMessage | null;
  activity: string | null;
  localError: LocalError | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinned.current = atBottom;
    setShowJump(!atBottom);
  }

  // Follow the conversation while the user is at the bottom.
  useLayoutEffect(() => {
    if (pinned.current) scrollToBottom();
  }, [messages, inflight?.content, inflight?.thinking, localError, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  // Show the in-flight reply even if the list hasn't caught up with it yet.
  const rows = [...messages];
  if (inflight && !rows.some((m) => m.id === inflight.messageId)) {
    rows.push({
      id: inflight.messageId,
      role: 'assistant',
      status: inflight.status,
      content: '',
      sources: [],
      effort: null,
      errorCode: null,
      errorMessage: null,
      costNanoUsd: null,
      createdAt: new Date().toISOString(),
    });
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {rows.length === 0 && !localError && (
            <p className="mt-16 text-center text-sm text-lc-grey">Send a message to start the conversation.</p>
          )}
          {localError?.afterMessageId === null && <InlineError text={localError.text} />}
          {rows.map((m) => (
            <div key={m.id} className="flex flex-col gap-2">
              {m.role === 'user' ? (
                <UserBubble message={m} />
              ) : (
                <AssistantBubble message={m} live={inflight?.messageId === m.id ? inflight : null} activity={activity} />
              )}
              {localError?.afterMessageId === m.id && <InlineError text={localError.text} />}
            </div>
          ))}
        </div>
      </div>
      {showJump && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="focus-ring absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-lc-border bg-lc-white px-3 py-1.5 text-xs font-medium text-lc-dark shadow-md hover:text-lc-blue"
        >
          <ArrowDownIcon size={14} /> Scroll to bottom
        </button>
      )}
    </div>
  );
}

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const copy = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      aria-label="Copy message"
      title="Copy"
      className={`focus-ring rounded-sm p-1 text-lc-grey opacity-0 transition group-hover:opacity-100 hover:text-lc-dark focus-visible:opacity-100 ${className}`}
    >
      <CopyIcon size={15} />
    </button>
  );
}

function UserBubble({ message }: { message: MessageDto }) {
  return (
    <div className="group flex items-start justify-end gap-1">
      <CopyButton text={message.content} className="mt-2" />
      <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-lc-user-bg px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-lc-dark">
        {message.content}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  live,
  activity,
}: {
  message: MessageDto;
  live: InflightMessage | null;
  activity: string | null;
}) {
  const content = live ? live.content : message.content;
  const streaming = live !== null || message.status === 'pending' || message.status === 'streaming';
  const waiting = streaming && content.length === 0;
  const error =
    message.status === 'refused'
      ? CHAT_ERROR_TEXT.refused
      : message.status === 'truncated'
        ? CHAT_ERROR_TEXT.truncated
        : message.status === 'error'
          ? (message.errorMessage ?? 'Something went wrong.')
          : null;

  return (
    <div className="group flex flex-col items-start gap-2">
      <div className="flex max-w-full items-start gap-1">
        <div className="max-w-full min-w-0 rounded-lg rounded-tl-sm bg-lc-assistant-bg px-4 py-2.5 text-[15px] leading-relaxed text-lc-dark">
          {waiting ? (
            <span className="inline-flex items-center gap-2 text-sm text-lc-grey">
              <TypingDots />
              {activity ?? (live?.thinking ? 'Thinking…' : '')}
            </span>
          ) : content ? (
            <>
              <Markdown text={content} />
              {streaming && activity && <p className="mt-1 text-xs text-lc-grey">{activity}</p>}
            </>
          ) : (
            <span className="text-sm text-lc-grey italic">No response.</span>
          )}
        </div>
        {!streaming && content && <CopyButton text={content} className="mt-2" />}
      </div>
      {error && !streaming && <InlineError text={error} />}
    </div>
  );
}

function InlineError({ text }: { text: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-lc-error/30 bg-lc-error/5 px-3 py-2 text-sm text-lc-error">
      <AlertIcon size={16} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1" aria-label="Generating">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-lc-grey" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
