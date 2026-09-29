import { useEffect, useId, useRef, useState } from 'react';
import { ToolsIcon } from '../icons';

export interface ToolsState {
  webSearch: boolean;
  multiTurn: boolean;
}

export function ToolsPopover({
  value,
  onChange,
  showWebSearch,
  showMultiTurn,
  disabled,
}: {
  value: ToolsState;
  onChange: (v: ToolsState) => void;
  showWebSearch: boolean;
  showMultiTurn: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = (showWebSearch && value.webSearch) || (showMultiTurn && value.multiTurn);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`focus-ring flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
          active ? 'border-lc-light-blue bg-lc-primary-light text-lc-blue' : 'border-lc-border text-lc-grey hover:text-lc-dark'
        }`}
      >
        <ToolsIcon size={14} /> Tools{active ? ' · on' : ''}
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-lg border border-lc-border bg-lc-white p-3 shadow-lg"
        >
          {showWebSearch && (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--blue)]"
                checked={value.webSearch}
                onChange={(e) => onChange({ ...value, webSearch: e.target.checked })}
              />
              <span>Web Search</span>
            </label>
          )}
          {showMultiTurn && (
            <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--blue)]"
                checked={value.multiTurn}
                onChange={(e) => onChange({ ...value, multiTurn: e.target.checked })}
              />
              <span>
                Allow multiple turns
                <span className="mt-0.5 block text-xs text-lc-grey">The model may use tools several times per request.</span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
