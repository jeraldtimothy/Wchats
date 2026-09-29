import type { ReactNode } from 'react';

export const inputClass =
  'focus-ring w-full rounded-md border border-lc-border bg-lc-input px-3 py-2 text-sm outline-none transition focus:border-lc-light-blue focus:bg-lc-white';
export const primaryButton =
  'focus-ring rounded-md bg-lc-blue px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110 disabled:opacity-50';
export const secondaryButton =
  'focus-ring rounded-md border border-lc-border bg-lc-white px-3 py-1.5 text-sm transition hover:bg-lc-light disabled:opacity-50';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`focus-ring relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-lc-blue' : 'bg-lc-grey/40'
      }`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

export function Badge({ tone, children }: { tone: 'green' | 'red' | 'blue' | 'grey'; children: ReactNode }) {
  const tones = {
    green: 'bg-emerald-50 !text-emerald-700',
    red: 'bg-lc-error/10 !text-lc-error',
    blue: 'bg-lc-primary-light !text-lc-blue',
    grey: 'bg-lc-assistant-bg !text-lc-grey',
  };
  return <span className={`section-label inline-block rounded-full px-2 py-0.5 !text-[10px] ${tones[tone]}`}>{children}</span>;
}

export function Panel({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-lc-border bg-lc-white shadow-sm">
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-lc-border px-4 py-3">
          {title && <h2 className="text-base font-medium">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
