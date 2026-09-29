import { CHAT_ERROR_TEXT, type SessionDetail } from '@wchats/shared';
import { useCallback, useState, type DragEvent } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../api/client';
import { usePostMessage, useSession, useSetIncludeMemories } from '../api/queries';
import { BackToSessions } from '../components/BackToSessions';
import { Composer, type SendInput } from '../components/chat/Composer';
import { MessageList, type LocalError } from '../components/chat/MessageList';
import { useAttachments } from '../components/chat/useAttachments';
import { useSessionStream } from '../components/chat/useSessionStream';
import { PaperclipIcon } from '../components/icons';
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
  if (session.error instanceof ApiError && session.error.status === 404) return <NotFoundPage />;
  if (!session.data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-lc-grey">
        {session.isError ? 'Could not load this chat.' : 'Loading…'}
      </div>
    );
  }
  return <ChatView detail={session.data} />;
}

function ChatView({ detail }: { detail: SessionDetail }) {
  const { session: s, messages } = detail;
  const { inflight, connection, activity } = useSessionStream(s.id);
  const post = usePostMessage(s.id);
  const setMemories = useSetIncludeMemories(s.id);
  const toast = useToast();
  const { openPicker } = usePicker();
  const [localError, setLocalError] = useState<LocalError | null>(null);
  const [dragging, setDragging] = useState(false);
  const onReject = useCallback((m: string) => toast(m, 'error'), [toast]);
  const attachments = useAttachments(s.model, onReject);

  const replying =
    inflight !== null || post.isPending || messages.some((m) => m.status === 'pending' || m.status === 'streaming');
  const canCompose = !s.isRetired;

  async function send(input: SendInput): Promise<boolean> {
    setLocalError(null);
    try {
      await post.mutateAsync({
        text: input.text,
        effort: input.effort,
        webSearch: input.webSearch,
        multiTurn: input.multiTurn,
        attachmentIds: input.attachmentIds,
      });
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

  const dragHandlers = canCompose
    ? {
        onDragEnter: (e: DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) attachments.add(e.dataTransfer.files);
        },
      }
    : {};

  return (
    <div className="relative flex h-full min-h-0 flex-col" {...dragHandlers}>
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

      {canCompose && (
        <Composer
          model={s.model}
          busy={replying}
          includeMemories={s.includeMemories}
          onToggleMemories={(on) => setMemories.mutate(on)}
          attachments={attachments}
          onSend={send}
        />
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-lc-blue bg-lc-primary-light/90">
          <div className="flex flex-col items-center gap-2 text-lc-blue">
            <PaperclipIcon size={28} />
            <span className="font-display text-lg">Drop files to attach</span>
          </div>
        </div>
      )}
    </div>
  );
}
