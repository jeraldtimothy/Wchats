import type { Effort, ModelSummary } from '@wchats/shared';
import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpIcon } from '../icons';

const EFFORT_LABELS: Record<Effort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
};

export function Composer({
  model,
  disabled,
  busy,
  onSend,
}: {
  model: ModelSummary;
  disabled: boolean;
  busy: boolean;
  onSend: (text: string, effort: Effort | undefined) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [effort, setEffort] = useState<Effort | undefined>(model.defaultEffort ?? model.reasoningEfforts[0]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && !busy && text.trim().length > 0;

  async function send() {
    if (!canSend) return;
    const sent = text;
    setText('');
    const ok = await onSend(sent, effort);
    if (!ok) setText(sent);
    ref.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="border-t border-lc-border bg-lc-white px-4 pt-2 pb-4 md:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <span className="section-label rounded-full bg-lc-primary-light px-2.5 py-1 !text-lc-blue" title="Model for this chat">
            {model.displayName}
          </span>
          {model.reasoningEfforts.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-lc-grey">
              Thinking effort
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value as Effort)}
                disabled={disabled}
                className="focus-ring rounded-md border border-lc-border bg-lc-input px-2 py-1 text-xs text-lc-dark"
              >
                {model.reasoningEfforts.map((e) => (
                  <option key={e} value={e}>
                    {EFFORT_LABELS[e]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex items-end gap-2 rounded-lg border border-lc-border bg-lc-input p-2 shadow-sm transition focus-within:border-lc-light-blue focus-within:bg-lc-white">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            rows={1}
            placeholder="Type a message or drop files here..."
            aria-label="Message"
            className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none [field-sizing:content] placeholder:text-lc-grey disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label="Send message"
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-lc-blue text-white shadow-sm transition hover:brightness-110 disabled:bg-lc-grey/40 disabled:shadow-none"
          >
            <ArrowUpIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
