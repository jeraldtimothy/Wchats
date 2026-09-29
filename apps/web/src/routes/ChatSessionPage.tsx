import { CHAT_ERROR_TEXT, type Effort } from '@wchats/shared';
import { useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../api/client';
import { usePostMessage, useSession } from '../api/queries';
import { BackToSessions } from '../components/BackToSessions';
import { Composer } from '../components/chat/Composer';
import { MessageList, type LocalError } from '../components/chat/MessageList';
import { useSessionStream } from '../components/chat/useSessionStream';
import { useToast } from '../components/Toast';
import { usePicker } from '../lib/picker';
import { NotFoundPage } from './ForbiddenPage';

export function ChatSessionPage() {
  const { sessionId } = useParams() as { sessionId: string };
  // Remount per session so stream state and composer drafts never leak across chats.
  return <ChatSession key={sessionId} sessionId={sessionId} />;
}

function ChatSession({ sessionId }: { sessionId: string }) {
  const session = useSession(sessionId);
  const { inflight, connection, activity } = useSessionStream(sessionId);
  const post = usePostMessage(sessionId);
  const toast = useToast();
  const { openPicker } = usePicker();
  const [localError, setLocalError] = useState<LocalError | null>(null);

  if (session.error instanceof ApiError && session.error.status === 404) return <NotFoundPage />;
  if (!session.data) {
    return <div className="flex flex-1 items-center justify-center text-sm text-lc-grey">{session.isError ? 'Could not load this chat.' : 'Loading…'}</div>;
  }

  const { session: s, messages } = session.data;
  const replying =
    inflight !== null || post.isPending || messages.some((m) => m.status === 'pending' || m.status === 'streaming');

  async function send(text: string, effort: Effort | undefined): Promise<boolean> {
    setLocalError(null);
    try {
      await post.mutateAsync({ text, effort });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'insufficient_credit') {
        setLocalError({ afterMessageId: messages.at(-1)?.id ?? null, text: CHAT_ERROR_TEXT.insufficientCredit });
      } else {
        toast(e instanceof ApiError ? e.message : 'Could not send your message.', 'error');
      }
      return false;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-lc-border bg-lc-white px-4 py-3 md:px-8">
        <div className="min-w-0 flex-1">
          <BackToSessions />
          <h1 className="truncate text-lg font-medium">{s.title ?? 'New chat'}</h1>
          <p className="truncate text-xs text-lc-grey">
            {s.model.displayName} · {s.billingAccountName}
          </p>
        </div>
        {connection === 'reconnecting' && <span className="text-xs text-lc-grey">Reconnecting…</span>}
      </header>

      {s.isRetired && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-lc-border bg-lc-primary-light px-4 py-3 text-sm md:px-8">
          <span>This model is retired. You can read this chat, or start a new chat to continue.</span>
          <button
            type="button"
            onClick={openPicker}
            className="focus-ring rounded-md bg-lc-blue px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:brightness-110"
          >
            Start a new chat
          </button>
        </div>
      )}

      <MessageList messages={messages} inflight={inflight} activity={activity} localError={localError} />

      {!s.isRetired && <Composer model={s.model} disabled={false} busy={replying} onSend={send} />}
    </div>
  );
}
