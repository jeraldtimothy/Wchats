import { PROVIDERS, PROVIDER_LABELS, type ModelSummary, type Provider, type Tier } from '@wchats/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useCreateSession, useModels, useToggleFavorite } from '../api/queries';
import { formatCents } from '../lib/format';
import { useCurrentUser } from '../lib/me';
import { CloseIcon, GridIcon, ListIcon, SortIcon, StarIcon } from './icons';
import { Modal } from './Modal';
import { ProviderLogo } from './ProviderLogo';
import { TierPill } from './TierPill';

type View = 'cards' | 'compact';
type SortKey = 'provider' | 'model' | 'tier';
const TIER_RANK: Record<Tier, number> = { premium: 0, standard: 1, value: 2 };
const VIEW_KEY = 'litechat.picker.view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'compact' ? 'compact' : 'cards';
  } catch {
    return 'cards';
  }
}

export function ModelPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="picker-title" className="max-w-3xl">
      <PickerBody onClose={onClose} />
    </Modal>
  );
}

function PickerBody({ onClose }: { onClose: () => void }) {
  const me = useCurrentUser();
  const models = useModels();
  const create = useCreateSession();
  const navigate = useNavigate();
  const accounts = me.billingAccounts.filter((a) => !a.isDisabled);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [view, setViewState] = useState<View>(readView);
  const [error, setError] = useState<string | null>(null);

  function setView(v: View) {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Remembering the view is a convenience only.
    }
  }

  async function choose(model: ModelSummary) {
    if (!accountId || create.isPending) return;
    setError(null);
    try {
      const detail = await create.mutateAsync({ modelId: model.id, billingAccountId: accountId });
      onClose();
      navigate(`/chat/${detail.session.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the chat.');
    }
  }

  return (
    <div className="flex max-h-[90vh] flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-lc-border px-5 py-4">
        <h2 id="picker-title" className="text-xl font-medium">
          Select a Model
        </h2>
        <div className="flex items-center gap-1">
          <div className="flex rounded-md bg-lc-light p-0.5" role="group" aria-label="View">
            {(
              [
                ['cards', GridIcon, 'Cards'],
                ['compact', ListIcon, 'Compact'],
              ] as const
            ).map(([v, Icon, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                title={label}
                className={`focus-ring flex items-center gap-1 rounded-sm px-2 py-1 text-xs ${
                  view === v ? 'bg-lc-white text-lc-blue shadow-sm' : 'text-lc-grey hover:text-lc-dark'
                }`}
              >
                <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1.5 text-lc-grey hover:bg-lc-assistant-bg">
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="border-b border-lc-border px-5 py-3">
        <label className="block max-w-sm">
          <span className="section-label">Billing account</span>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="focus-ring mt-1 w-full rounded-md border border-lc-border bg-lc-input px-3 py-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatCents(a.balanceCents)}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-1 text-xs text-lc-grey">Costs for this session will be charged to the selected account.</p>
        {me.config.simulation && (
          <p className="mt-1 text-xs text-amber-700">
            Simulation mode is on: every model is answered by a built-in simulator, and charges use simulated usage.
          </p>
        )}
        {accounts.length === 0 && (
          <p className="mt-1 text-xs text-lc-error">You have no active billing account. Ask a manager for access.</p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-sm text-lc-error">
            {error}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {models.isPending && <p className="text-sm text-lc-grey">Loading models…</p>}
        {models.isError && <p className="text-sm text-lc-error">Could not load models.</p>}
        {models.data?.length === 0 && (
          <p className="text-sm text-lc-grey">No models are available yet. An administrator needs to add a provider API key.</p>
        )}
        {models.data && models.data.length > 0 &&
          (view === 'cards' ? (
            <CardsView models={models.data} onChoose={choose} busy={create.isPending} />
          ) : (
            <CompactView models={models.data} onChoose={choose} busy={create.isPending} />
          ))}
      </div>
    </div>
  );
}

interface ViewProps {
  models: ModelSummary[];
  onChoose: (m: ModelSummary) => void;
  busy: boolean;
}

function CardsView({ models, onChoose, busy }: ViewProps) {
  const groups = PROVIDERS.map((p) => ({ provider: p, models: models.filter((m) => m.provider === p) })).filter(
    (g) => g.models.length > 0,
  );
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.provider} aria-labelledby={`prov-${g.provider}`}>
          <h3 id={`prov-${g.provider}`} className="mb-2 flex items-center gap-2 text-base font-medium">
            <ProviderLogo provider={g.provider} /> {PROVIDER_LABELS[g.provider]}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.models.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busy}
                onClick={() => onChoose(m)}
                className="focus-ring flex flex-col items-start gap-2 rounded-lg border border-lc-border bg-lc-white p-4 text-left shadow-sm transition hover:-translate-y-px hover:border-lc-light-blue hover:shadow-md disabled:opacity-60"
              >
                <span className="font-display text-[17px] font-medium">{m.displayName}</span>
                <span className="text-sm leading-snug text-lc-grey">{m.description}</span>
                <span className="mt-auto pt-1">
                  <TierPill tier={m.tier} />
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CompactView({ models, onChoose, busy }: ViewProps) {
  const toggleFavorite = useToggleFavorite();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'provider', dir: 'asc' });

  const rows = useMemo(() => {
    const cmp = (a: ModelSummary, b: ModelSummary): number => {
      switch (sort.key) {
        case 'provider':
          return PROVIDER_LABELS[a.provider].localeCompare(PROVIDER_LABELS[b.provider]) || TIER_RANK[a.tier] - TIER_RANK[b.tier];
        case 'model':
          return a.displayName.localeCompare(b.displayName);
        case 'tier':
          return TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.displayName.localeCompare(b.displayName);
      }
    };
    // Favorites always come first; the chosen column sorts within each group.
    return [...models].sort(
      (a, b) => Number(b.isFavorite) - Number(a.isFavorite) || (sort.dir === 'asc' ? cmp(a, b) : cmp(b, a)),
    );
  }, [models, sort]);

  const header = (key: SortKey, label: string) => (
    <th scope="col" className="py-2 pr-3 text-left font-normal" aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className="focus-ring section-label inline-flex items-center gap-1 hover:text-lc-dark"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))}
      >
        {label} <SortIcon dir={sort.key === key ? sort.dir : null} />
      </button>
    </th>
  );

  return (
    <table className="w-full text-sm">
      <thead className="border-b border-lc-border">
        <tr>
          <th scope="col" className="w-8 py-2">
            <span className="sr-only">Favorite</span>
          </th>
          {header('provider', 'Provider')}
          {header('model', 'Model')}
          {header('tier', 'Tier')}
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id} className="group border-b border-lc-border last:border-0 hover:bg-lc-light">
            <td className="py-1.5">
              <button
                type="button"
                aria-label={m.isFavorite ? `Unfavorite ${m.displayName}` : `Favorite ${m.displayName}`}
                aria-pressed={m.isFavorite}
                onClick={() => toggleFavorite.mutate({ id: m.id, favorite: !m.isFavorite })}
                className={`focus-ring rounded-sm p-1 ${m.isFavorite ? 'text-amber-400' : 'text-lc-grey/50 hover:text-lc-grey'}`}
              >
                <StarIcon filled={m.isFavorite} size={16} />
              </button>
            </td>
            <td className="py-1.5 pr-3">
              <span className="inline-flex items-center gap-2">
                <ProviderLogo provider={m.provider as Provider} size={18} /> {PROVIDER_LABELS[m.provider]}
              </span>
            </td>
            <td className="py-1.5 pr-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose(m)}
                className="focus-ring rounded-sm text-left font-medium text-lc-dark hover:text-lc-blue hover:underline disabled:opacity-60"
              >
                {m.displayName}
              </button>
            </td>
            <td className="py-1.5">
              <TierPill tier={m.tier} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
