import type { Effort, ModelSummary } from '@wchats/shared';
import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpIcon, CloseIcon, FileIcon, PaperclipIcon } from '../icons';
import { ToolsPopover, type ToolsState } from './ToolsPopover';
import type { useAttachments } from './useAttachments';

const EFFORT_LABELS: Record<Effort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
};

export interface SendInput {
  text: string;
  effort: Effort | undefined;
  webSearch: boolean;
  multiTurn: boolean;
  attachmentIds: string[];
}

export function Composer({
  model,
  busy,
  includeMemories,
  onToggleMemories,
  attachments,
  onSend,
}: {
  model: ModelSummary;
  busy: boolean;
  includeMemories: boolean;
  onToggleMemories: (on: boolean) => void;
  attachments: ReturnType<typeof useAttachments>;
  onSend: (input: SendInput) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [effort, setEffort] = useState<Effort | undefined>(model.defaultEffort ?? model.reasoningEfforts[0]);
  const [tools, setTools] = useState<ToolsState>({ webSearch: false, multiTurn: false });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasContent = text.trim().length > 0 || attachments.readyIds.length > 0;
  const canSend = !busy && hasContent && !attachments.uploading && !attachments.hasErrors;

  async function send() {
    if (!canSend) return;
    const sent = text;
    setText('');
    const ok = await onSend({
      text: sent,
      effort,
      webSearch: model.webSearchEnabled && tools.webSearch,
      multiTurn: model.supportsMultiTurnTools && tools.multiTurn,
      attachmentIds: attachments.readyIds,
    });
    if (ok) attachments.clear();
    else setText(sent);
    textRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const showTools = model.webSearchEnabled || model.supportsMultiTurnTools;

  return (
    <div className="border-t border-lc-border bg-lc-white px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <span className="section-label rounded-full bg-lc-primary-light px-2.5 py-1 !text-lc-blue" title="Model for this chat">
            {model.displayName}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={includeMemories}
            onClick={() => onToggleMemories(!includeMemories)}
            className="focus-ring flex items-center gap-1.5 rounded-full py-1 pr-1 text-xs text-lc-grey hover:text-lc-dark"
          >
            <span
              aria-hidden="true"
              className={`relative inline-block h-4 w-7 rounded-full transition ${includeMemories ? 'bg-lc-blue' : 'bg-lc-grey/40'}`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all ${includeMemories ? 'left-3.5' : 'left-0.5'}`}
              />
            </span>
            Include Memories
          </button>
          {showTools && (
            <ToolsPopover
              value={tools}
              onChange={setTools}
              showWebSearch={model.webSearchEnabled}
              showMultiTurn={model.supportsMultiTurnTools}
            />
          )}
          {model.reasoningEfforts.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-lc-grey">
              Thinking effort
              <select
                value={effort}
                onChange={(e) => setEffort(e.target.value as Effort)}
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

        <div className="rounded-lg border border-lc-border bg-lc-input p-2 shadow-sm transition focus-within:border-lc-light-blue focus-within:bg-lc-white">
          {attachments.files.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-1 pb-2" aria-label="Attached files">
              {attachments.files.map((f) => (
                <li
                  key={f.localId}
                  className={`flex max-w-[220px] items-center gap-2 rounded-md border bg-lc-white py-1 pr-1 pl-1.5 text-xs ${
                    f.status === 'error' ? 'border-lc-error/40 text-lc-error' : 'border-lc-border'
                  }`}
                  title={f.error ?? f.name}
                >
                  {f.preview ? (
                    <img src={f.preview} alt="" className="h-7 w-7 rounded-sm object-cover" />
                  ) : (
                    <FileIcon size={16} className="shrink-0 text-lc-grey" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {f.name}
                    {f.status === 'uploading' && <span className="block text-[10px] text-lc-grey">Uploading…</span>}
                    {f.status === 'error' && <span className="block truncate text-[10px]">{f.error}</span>}
                    {f.attachment?.truncated && <span className="block text-[10px] text-lc-grey">Long file: truncated</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => attachments.remove(f.localId)}
                    aria-label={`Remove ${f.name}`}
                    className="focus-ring rounded-sm p-0.5 text-lc-grey hover:bg-lc-assistant-bg hover:text-lc-dark"
                  >
                    <CloseIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach files"
              title="Attach files"
              className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-lc-grey hover:bg-lc-assistant-bg hover:text-lc-dark"
            >
              <PaperclipIcon />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={attachments.accept}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) attachments.add(e.target.files);
                e.target.value = '';
              }}
            />
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  attachments.add(e.clipboardData.files);
                }
              }}
              rows={1}
              placeholder="Type a message or drop files here..."
              aria-label="Message"
              className="max-h-48 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-[15px] outline-none [field-sizing:content] placeholder:text-lc-grey"
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
    </div>
  );
}
