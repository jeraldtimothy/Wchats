import { CHAT_ERROR_TEXT, PROVIDERS, PROVIDER_LABELS, type Effort, type ModelSummary } from '@wchats/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '../api/client';
import { qk, useAsk, useAskDetail, useAskHistory, useDeleteAsk, useModels } from '../api/queries';
import { BackToSessions } from '../components/BackToSessions';
import { MessageList, type LocalError } from '../components/chat/MessageList';
import { useSessionStream } from '../components/chat/useSessionStream';
import { ArrowUpIcon, TrashIcon } from '../components/icons';
import { useToast } from '../components/Toast';
import { formatCents, formatSessionDate } from '../lib/format';
import { useCurrentUser } from '../lib/me';

const PREFS_KEY = 'litechat.ask.prefs';
const EFFORT_LABELS: Record<Effort, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };
const select = 'focus-ring w-full rounded-md border border-lc-border bg-lc-input px-3 py-2 text-sm';

function readPrefs(): { modelId?: string; accountId?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { modelId?: string; accountId?: string };
  } catch {
    return {};
  }
}

function writePrefs(prefs: { modelId: string; accountId: string }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Remembering the last choice is a convenience only.
  }
}

export function AskPage() {
  const me = useCurrentUser();
  const models = useModels();
  const history = useAskHistory();
  const ask = useAsk();
  const del = useDeleteAsk();
  const toast = useToast();
  const accounts = me.billingAccounts.filter((a) => !a.isDisabled);

  const [prefs] = useState(readPrefs);
  const [modelId, setModelId] = useState<string | null>(prefs.modelId ?? null);
  const [accountId, setAccountId] = useState(
    accounts.some((a) => a.id === prefs.accountId) ? prefs.accountId! : (accounts[0]?.id ?? ''),
  );
  const [effortChoice, setEffortChoice] = useState<{ modelId: string; effort: Effort } | null>(null);
  const [webSearchChoice, setWebSearch] = useState(false);
  const [text, setText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<LocalError | null>(null);

  // Favorites first, then catalog order.
  const available = useMemo(
    () => [...(models.data ?? [])].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite)),
    [models.data],
  );
  const model: ModelSummary | undefined = available.find((m) => m.id === modelId) ?? available[0];

  // The chosen effort only applies to the model it was chosen for; otherwise use the model's default.
  const effort: Effort | undefined =
    model && effortChoice?.modelId === model.id ? effortChoice.effort : (model?.defaultEffort ?? model?.reasoningEfforts[0]);
  const webSearch = Boolean(model?.webSearchEnabled) && webSearchChoice;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!model || !accountId || !text.trim() || ask.isPending) return;
    setLocalError(null);
    try {
      const res = await ask.mutateAsync({ modelId: model.id, billingAccountId: accountId, text, effort, webSearch });
      writePrefs({ modelId: model.id, accountId });
      setText('');
      setSelectedId(res.session.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'insufficient_credit') {
        setSelectedId(null);
        setLocalError({ afterMessageId: null, text: CHAT_ERROR_TEXT.insufficientCredit });
      } else {
        toast(err instanceof ApiError ? err.message : 'Could not send your question.', 'error');
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <form onSubmit={submit} className="shrink-0 border-b border-lc-border bg-lc-white px-4 py-4 md:px-8">
          <div className="mx-auto max-w-3xl space-y-3">
            <BackToSessions />
            <h1 className="text-2xl font-medium">Ask</h1>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="section-label">Model</span>
                <select
                  className={`${select} mt-1`}
                  value={model?.id ?? ''}
                  onChange={(e) => setModelId(e.target.value)}
                  disabled={!available.length}
                >
                  {!available.length && <option>{models.isPending ? 'Loading…' : 'No models available'}</option>}
                  {PROVIDERS.map((p) => {
                    const group = available.filter((m) => m.provider === p);
                    return group.length ? (
                      <optgroup key={p} label={PROVIDER_LABELS[p]}>
                        {group.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.isFavorite ? '★ ' : ''}
                            {m.displayName} · {m.tier}
                          </option>
                        ))}
                      </optgroup>
                    ) : null;
                  })}
                </select>
              </label>
              <label className="block">
                <span className="section-label">Billing account</span>
                <select className={`${select} mt-1`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {formatCents(a.balanceCents)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-lc-grey">
              {model && model.reasoningEfforts.length > 0 && (
                <label className="flex items-center gap-1.5">
                  Thinking effort
                  <select
                    value={effort}
                    onChange={(e) => setEffortChoice({ modelId: model.id, effort: e.target.value as Effort })}
                    className="focus-ring rounded-md border border-lc-border bg-lc-input px-2 py-1 text-xs text-lc-dark"
                  >
                    {model.reasoningEfforts.map((x) => (
                      <option key={x} value={x}>
                        {EFFORT_LABELS[x]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {model?.webSearchEnabled && (
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input type="checkbox" className="accent-[var(--blue)]" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
                  Web Search
                </label>
              )}
            </div>
            <div className="flex items-end gap-2 rounded-lg border border-lc-border bg-lc-input p-2 shadow-sm focus-within:border-lc-light-blue focus-within:bg-lc-white">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                placeholder="Ask a question…"
                aria-label="Question"
                className="max-h-48 min-h-[48px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none [field-sizing:content] placeholder:text-lc-grey"
              />
              <button
                type="submit"
                disabled={!model || !accountId || !text.trim() || ask.isPending}
                aria-label="Ask"
                className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-lc-blue text-white shadow-sm transition hover:brightness-110 disabled:bg-lc-grey/40 disabled:shadow-none"
              >
                <ArrowUpIcon size={18} />
              </button>
            </div>
          </div>
        </form>

        {selectedId ? (
          <AskAnswer key={selectedId} id={selectedId} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {localError ? (
              <MessageList messages={[]} inflight={null} activity={null} localError={localError} />
            ) : (
              <p className="m-auto p-6 text-center text-sm text-lc-grey">Ask anything. Answers are billed like chat replies.</p>
            )}
          </div>
        )}
      </div>

      <aside className="max-h-72 shrink-0 overflow-y-auto border-t border-lc-border bg-lc-white md:max-h-none md:w-72 md:border-t-0 md:border-l">
        <div className="section-label sticky top-0 bg-lc-white px-4 pt-4 pb-2">History</div>
        {history.data?.length === 0 && <p className="px-4 text-sm text-lc-grey">Your questions will appear here.</p>}
        <ul className="space-y-0.5 px-2 pb-4">
          {history.data?.map((item) => (
            <li key={item.id} className="group relative">
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`focus-ring block w-full rounded-md py-2 pr-9 pl-3 text-left transition ${
                  item.id === selectedId ? 'bg-lc-primary-light' : 'hover:bg-lc-assistant-bg'
                }`}
              >
                <span className="line-clamp-2 text-sm">{item.question || 'Untitled question'}</span>
                <span className="mt-0.5 block truncate text-xs text-lc-grey">
                  {formatSessionDate(item.createdAt)} · {item.modelName}
                  {item.status && item.status !== 'complete' && item.status !== 'pending' && item.status !== 'streaming'
                    ? ` · ${item.status}`
                    : ''}
                </span>
              </button>
              <button
                type="button"
                aria-label="Delete question"
                onClick={() =>
                  del.mutate(item.id, {
                    onSuccess: () => item.id === selectedId && setSelectedId(null),
                    onError: () => toast('Could not delete this question.', 'error'),
                  })
                }
                className="focus-ring absolute top-2 right-1.5 hidden rounded-sm p-1.5 text-lc-grey group-focus-within:block group-hover:block hover:text-lc-error"
              >
                <TrashIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function AskAnswer({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useAskDetail(id);
  const { inflight, activity } = useSessionStream(id, {
    url: `/api/ask/${id}/listen`,
    detailKey: qk.ask(id),
    onTerminal: () => void qc.invalidateQueries({ queryKey: qk.askHistory }),
  });
  if (!detail.data) {
    return <p className="m-auto p-6 text-sm text-lc-grey">{detail.isError ? 'Could not load this answer.' : 'Loading…'}</p>;
  }
  return <MessageList messages={detail.data.messages} inflight={inflight} activity={activity} localError={null} />;
}
