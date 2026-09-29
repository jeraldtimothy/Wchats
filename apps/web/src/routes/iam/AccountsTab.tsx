import type { IamAccountDetail, IamLedgerEntry, LedgerKind } from '@wchats/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import {
  ledgerCsvUrl,
  useCreateAccount,
  useGrantCredit,
  useIamAccount,
  useIamAccounts,
  useIamUsers,
  useLedger,
  usePatchAccount,
  useSetMember,
  useUsage,
  usageCsvUrl,
  type DateRange,
} from '../../api/iam';
import { useToast } from '../../components/Toast';
import { daysAgoUtc, formatCents, formatNanoUsd, todayUtc } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { Badge, Panel, inputClass, primaryButton, secondaryButton } from './ui';

const KIND_LABELS: Record<LedgerKind, string> = {
  credit_grant: 'Credit grant',
  usage_charge: 'Usage',
  refund: 'Refund',
  adjustment: 'Adjustment',
};

export function AccountsTab() {
  const [query, setQuery] = useState('');
  const accounts = useIamAccounts(useDebounced(query.trim()));
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: daysAgoUtc(29), to: todayUtc() });

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Panel title="Billing accounts">
        <div className="space-y-3 p-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts"
            aria-label="Search accounts"
            className={inputClass}
          />
          <CreateAccountForm onCreated={setSelected} />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto border-t border-lc-border">
          <li>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className={`focus-ring block w-full px-4 py-2.5 text-left text-sm ${selected === null ? 'bg-lc-primary-light font-medium' : 'hover:bg-lc-light'}`}
            >
              All accounts: usage overview
            </button>
          </li>
          {accounts.data?.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelected(a.id)}
                className={`focus-ring flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left ${
                  a.id === selected ? 'bg-lc-primary-light' : 'hover:bg-lc-light'
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{a.name}</span>
                  <span className="flex gap-1.5 pt-0.5">
                    <Badge tone={a.kind === 'shared' ? 'blue' : 'grey'}>{a.kind}</Badge>
                    {a.isDisabled && <Badge tone="red">Disabled</Badge>}
                  </span>
                </span>
                <span className={`shrink-0 text-sm ${a.balanceCents <= 0 ? 'text-lc-error' : ''}`}>{formatCents(a.balanceCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="min-w-0 space-y-4">
        <DateRangePicker value={range} onChange={setRange} />
        {selected ? <AccountDetail key={selected} id={selected} range={range} /> : <UsagePanel range={range} />}
      </div>
    </div>
  );
}

function CreateAccountForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const create = useCreateAccount();
  const toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const detail = await create.mutateAsync(name);
      setName('');
      onCreated(detail.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the account.', 'error');
    }
  }
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        placeholder="New shared account name"
        aria-label="New shared account name"
        className={inputClass}
      />
      <button type="submit" disabled={!name.trim() || create.isPending} className={`${primaryButton} shrink-0`}>
        Create
      </button>
    </form>
  );
}

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-lc-border bg-lc-white px-4 py-3 shadow-sm">
      {(['from', 'to'] as const).map((k) => (
        <label key={k} className="block">
          <span className="section-label">{k === 'from' ? 'From' : 'To'} (UTC)</span>
          <input
            type="date"
            value={value[k]}
            max={todayUtc()}
            onChange={(e) => e.target.value && onChange({ ...value, [k]: e.target.value })}
            className={`${inputClass} mt-1`}
          />
        </label>
      ))}
      <div className="flex gap-1.5 pb-0.5">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" className={secondaryButton} onClick={() => onChange({ from: daysAgoUtc(d - 1), to: todayUtc() })}>
            {d} days
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountDetail({ id, range }: { id: string; range: DateRange }) {
  const account = useIamAccount(id);
  if (!account.data) return <Panel>{<p className="p-4 text-sm text-lc-grey">{account.isError ? 'Could not load this account.' : 'Loading…'}</p>}</Panel>;
  const a = account.data;
  return (
    <>
      <AccountHeader account={a} />
      <div className="grid gap-4 xl:grid-cols-2">
        <CreditForm account={a} />
        <Members account={a} />
      </div>
      <UsagePanel range={range} accountId={a.id} />
      <LedgerPanel account={a} range={range} />
    </>
  );
}

function AccountHeader({ account }: { account: IamAccountDetail }) {
  const patch = usePatchAccount();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const save = (body: { name?: string; isDisabled?: boolean }) =>
    patch.mutate(
      { id: account.id, ...body },
      { onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'), onSuccess: () => setEditing(false) },
    );

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) save({ name });
              }}
              className="flex gap-2"
            >
              <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Account name" className={inputClass} />
              <button type="submit" className={primaryButton} disabled={!name.trim() || patch.isPending}>
                Save
              </button>
              <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-medium">{account.name}</h2>
              <button type="button" onClick={() => setEditing(true)} className="focus-ring text-xs text-lc-blue hover:underline">
                Rename
              </button>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={account.kind === 'shared' ? 'blue' : 'grey'}>{account.kind}</Badge>
            <Badge tone={account.isDisabled ? 'red' : 'green'}>{account.isDisabled ? 'Disabled' : 'Active'}</Badge>
            <button
              type="button"
              disabled={patch.isPending}
              onClick={() => save({ isDisabled: !account.isDisabled })}
              className="focus-ring text-xs text-lc-blue hover:underline"
            >
              {account.isDisabled ? 'Enable account' : 'Disable account'}
            </button>
          </div>
        </div>
        <div className="text-right">
          <div className="section-label">Available credit</div>
          <div className={`font-display text-3xl ${account.balanceCents <= 0 ? 'text-lc-error' : ''}`}>
            {formatNanoUsd(account.balanceNanoUsd)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function CreditForm({ account }: { account: IamAccountDetail }) {
  const grant = useGrantCredit();
  const toast = useToast();
  const [kind, setKind] = useState<'credit_grant' | 'adjustment'>('credit_grant');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await grant.mutateAsync({ id: account.id, kind, amountUsd: amount.trim(), reason });
      toast(kind === 'credit_grant' ? 'Credit granted.' : 'Adjustment recorded.');
      setAmount('');
      setReason('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not record the change.', 'error');
    }
  }

  return (
    <Panel title="Add or adjust credit">
      <form onSubmit={submit} className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="section-label">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={`${inputClass} mt-1`}>
              <option value="credit_grant">Grant credit</option>
              <option value="adjustment">Adjustment (±)</option>
            </select>
          </label>
          <label className="block">
            <span className="section-label">Amount (USD)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={kind === 'credit_grant' ? '25.00' : '-5.00'}
              className={`${inputClass} mt-1`}
            />
          </label>
        </div>
        <label className="block">
          <span className="section-label">Reason</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Shown in the ledger"
            className={`${inputClass} mt-1`}
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-lc-grey">Grants must be positive. Adjustments can be negative.</p>
          <button type="submit" disabled={!amount.trim() || !reason.trim() || grant.isPending} className={primaryButton}>
            {kind === 'credit_grant' ? 'Grant' : 'Adjust'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function Members({ account }: { account: IamAccountDetail }) {
  const setMember = useSetMember();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const search = useIamUsers(q);
  const results = q ? (search.data?.pages[0]?.users ?? []).filter((u) => !account.members.some((m) => m.userId === u.id)).slice(0, 6) : [];

  const change = (userId: string, member: boolean) =>
    setMember.mutate(
      { accountId: account.id, userId, member },
      { onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update membership.', 'error'), onSuccess: () => setQuery('') },
    );

  return (
    <Panel title={`Members (${account.members.length})`}>
      <div className="p-4">
        {account.kind === 'shared' && (
          <div className="relative mb-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add a user by name or email"
              aria-label="Add member"
              className={inputClass}
            />
            {results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-lc-border bg-lc-white shadow-lg">
                {results.map((u) => (
                  <li key={u.id}>
                    <button type="button" onClick={() => change(u.id, true)} className="focus-ring block w-full px-3 py-2 text-left text-sm hover:bg-lc-light">
                      {u.name} <span className="text-lc-grey">{u.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {account.members.length === 0 ? (
          <p className="text-sm text-lc-grey">No members yet.</p>
        ) : (
          <ul className="divide-y divide-lc-border rounded-md border border-lc-border">
            {account.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 text-sm">
                  <span className="block truncate">{m.name}</span>
                  <span className="block truncate text-xs text-lc-grey">{m.email}</span>
                </span>
                {m.isOwner ? (
                  <Badge tone="grey">Owner</Badge>
                ) : (
                  <button type="button" onClick={() => change(m.userId, false)} className="focus-ring text-xs text-lc-error hover:underline">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function UsagePanel({ range, accountId }: { range: DateRange; accountId?: string }) {
  const [groupBy, setGroupBy] = useState<'user' | 'model'>('user');
  const usage = useUsage(groupBy, range, accountId);
  const rows = usage.data?.rows ?? [];
  const total = rows.reduce((s, r) => s + BigInt(r.costNanoUsd), 0n);
  const num = (n: number) => n.toLocaleString();

  return (
    <Panel
      title={accountId ? 'Usage' : 'Usage across all accounts'}
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-md bg-lc-light p-0.5" role="group" aria-label="Group usage by">
            {(['user', 'model'] as const).map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={groupBy === g}
                onClick={() => setGroupBy(g)}
                className={`focus-ring rounded-sm px-2.5 py-1 text-xs ${groupBy === g ? 'bg-lc-white font-medium text-lc-blue shadow-sm' : 'text-lc-grey'}`}
              >
                By {g}
              </button>
            ))}
          </div>
          <a href={usageCsvUrl(groupBy, range, accountId)} className={secondaryButton} download>
            Export CSV
          </a>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-lc-border text-left">
            <tr>
              {[groupBy === 'user' ? 'User' : 'Model', 'Requests', 'Cost', 'Input', 'Cached', 'Output', 'Reasoning', 'Searches'].map((h, i) => (
                <th key={h} scope="col" className={`section-label px-4 py-2 font-normal ${i > 0 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key ?? 'none'} className="border-b border-lc-border last:border-0">
                <td className="max-w-[260px] truncate px-4 py-2" title={r.label}>
                  {r.label}
                </td>
                <td className="px-4 py-2 text-right">{num(r.requests)}</td>
                <td className="px-4 py-2 text-right font-medium">{formatNanoUsd(r.costNanoUsd)}</td>
                <td className="px-4 py-2 text-right">{num(r.inputTokens)}</td>
                <td className="px-4 py-2 text-right">{num(r.cachedInputTokens)}</td>
                <td className="px-4 py-2 text-right">{num(r.outputTokens)}</td>
                <td className="px-4 py-2 text-right">{num(r.reasoningTokens)}</td>
                <td className="px-4 py-2 text-right">{num(r.webSearches)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-lc-border">
              <tr>
                <td className="px-4 py-2 font-medium">Total</td>
                <td className="px-4 py-2 text-right">{num(rows.reduce((s, r) => s + r.requests, 0))}</td>
                <td className="px-4 py-2 text-right font-medium">{formatNanoUsd(total.toString())}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {usage.isPending && <p className="px-4 py-3 text-sm text-lc-grey">Loading…</p>}
      {usage.data && rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-lc-grey">No usage in this range.</p>}
    </Panel>
  );
}

function LedgerPanel({ account, range }: { account: IamAccountDetail; range: DateRange }) {
  const ledger = useLedger(account.id, range);
  const entries: IamLedgerEntry[] = ledger.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <Panel
      title="Ledger"
      actions={
        <a href={ledgerCsvUrl(account.id, range)} className={secondaryButton} download>
          Export CSV
        </a>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-lc-border text-left">
            <tr>
              {['When', 'Type', 'Amount', 'Balance', 'User', 'Model', 'Reason', 'By'].map((h, i) => (
                <th key={h} scope="col" className={`section-label px-4 py-2 font-normal ${i === 2 || i === 3 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const negative = e.amountNanoUsd.startsWith('-');
              return (
                <tr key={e.id} className="border-b border-lc-border last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap text-lc-grey">
                    {new Date(e.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="px-4 py-2">{KIND_LABELS[e.kind]}</td>
                  <td className={`px-4 py-2 text-right font-medium ${negative ? 'text-lc-dark' : 'text-emerald-700'}`}>
                    {negative ? '' : '+'}
                    {formatNanoUsd(e.amountNanoUsd)}
                  </td>
                  <td className="px-4 py-2 text-right">{formatNanoUsd(e.balanceAfterNanoUsd)}</td>
                  <td className="max-w-[160px] truncate px-4 py-2" title={e.userEmail ?? undefined}>
                    {e.userName ?? '—'}
                  </td>
                  <td className="px-4 py-2">{e.modelName ?? '—'}</td>
                  <td className="max-w-[220px] truncate px-4 py-2" title={e.reason ?? undefined}>
                    {e.reason ?? '—'}
                  </td>
                  <td className="px-4 py-2">{e.createdByName ?? (e.source === 'usage' ? 'System' : '—')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ledger.isPending && <p className="px-4 py-3 text-sm text-lc-grey">Loading…</p>}
      {ledger.data && entries.length === 0 && <p className="px-4 py-6 text-center text-sm text-lc-grey">No entries in this range.</p>}
      {ledger.hasNextPage && (
        <div className="border-t border-lc-border p-3 text-center">
          <button type="button" className={secondaryButton} disabled={ledger.isFetchingNextPage} onClick={() => ledger.fetchNextPage()}>
            {ledger.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </Panel>
  );
}
