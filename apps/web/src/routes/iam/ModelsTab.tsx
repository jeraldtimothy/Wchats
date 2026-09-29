import { EFFORTS, PROVIDERS, PROVIDER_LABELS, TIERS, type Effort, type IamModel, type PatchIamModelBody, type Tier } from '@wchats/shared';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useIamModels, usePatchModel } from '../../api/iam';
import { Modal } from '../../components/Modal';
import { ProviderLogo } from '../../components/ProviderLogo';
import { useToast } from '../../components/Toast';
import { Badge, Panel, Switch, inputClass, primaryButton, secondaryButton } from './ui';

const EFFORT_LABELS: Record<Effort, string> = { none: 'None', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' };

export function ModelsTab() {
  const models = useIamModels();
  const patch = usePatchModel();
  const toast = useToast();
  const [editing, setEditing] = useState<IamModel | null>(null);

  const save = (id: string, body: PatchIamModelBody) =>
    patch.mutate({ id, ...body }, { onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error') });

  return (
    <div className="space-y-4">
      <p className="text-sm text-lc-grey">
        Edits here take precedence over the seed config: <code className="text-xs">pnpm seed</code> leaves edited models alone unless run with{' '}
        <code className="text-xs">--force-models</code>. Prices are USD per million tokens (web search: per call), before markup.
      </p>
      {models.isPending && <p className="text-sm text-lc-grey">Loading…</p>}
      {PROVIDERS.map((provider) => {
        const group = models.data?.filter((m) => m.provider === provider) ?? [];
        if (!group.length) return null;
        const configured = group[0]!.providerConfigured;
        return (
          <Panel
            key={provider}
            title={PROVIDER_LABELS[provider]}
            actions={<Badge tone={configured ? 'green' : 'grey'}>{configured ? 'API key set' : 'No API key: hidden from users'}</Badge>}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-lc-border text-left">
                  <tr>
                    {['Model', 'Tier', 'Input', 'Cached', 'Output', 'Search', 'Retired', 'Agent', ''].map((h, i) => (
                      <th key={h || i} scope="col" className={`section-label px-4 py-2 font-normal ${i >= 2 && i <= 5 ? 'text-right' : ''}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.map((m) => (
                    <tr key={m.id} className={`border-b border-lc-border last:border-0 ${m.isRetired ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <ProviderLogo provider={m.provider} size={18} />
                          <span className="font-medium">{m.displayName}</span>
                          {m.editedAt && <Badge tone="blue">Edited</Badge>}
                        </div>
                        <code className="text-xs text-lc-grey">{m.providerModelId}</code>
                      </td>
                      <td className="px-4 py-2.5 capitalize">{m.tier}</td>
                      <td className="px-4 py-2.5 text-right">${m.inputUsdPerMtok}</td>
                      <td className="px-4 py-2.5 text-right">${m.cachedInputUsdPerMtok}</td>
                      <td className="px-4 py-2.5 text-right">${m.outputUsdPerMtok}</td>
                      <td className="px-4 py-2.5 text-right">${m.webSearchUsdPerCall}</td>
                      <td className="px-4 py-2.5">
                        <Switch checked={m.isRetired} label={`Retire ${m.displayName}`} disabled={patch.isPending} onChange={(v) => save(m.id, { isRetired: v })} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Switch
                          checked={m.agentEnabled}
                          label={`Agent mode for ${m.displayName}`}
                          disabled={patch.isPending}
                          onChange={(v) => save(m.id, { agentEnabled: v })}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => setEditing(m)} className="focus-ring text-xs text-lc-blue hover:underline">
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
      <Modal open={editing !== null} onClose={() => setEditing(null)} labelledBy="model-edit-title" className="max-w-2xl">
        {editing && <EditModelForm key={editing.id} model={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function EditModelForm({ model, onDone }: { model: IamModel; onDone: () => void }) {
  const patch = usePatchModel();
  const toast = useToast();
  const [f, setF] = useState({
    displayName: model.displayName,
    description: model.description,
    providerModelId: model.providerModelId,
    tier: model.tier,
    reasoningEfforts: model.reasoningEfforts,
    defaultEffort: model.defaultEffort,
    budgets: Object.fromEntries(EFFORTS.map((e) => [e, model.thinkingBudgets[e]?.toString() ?? ''])) as Record<Effort, string>,
    maxOutputTokens: String(model.maxOutputTokens),
    supportsImages: model.supportsImages,
    supportsDocuments: model.supportsDocuments,
    supportsMultiTurnTools: model.supportsMultiTurnTools,
    webSearchEnabled: model.webSearchEnabled,
    inputUsdPerMtok: model.inputUsdPerMtok,
    cachedInputUsdPerMtok: model.cachedInputUsdPerMtok,
    outputUsdPerMtok: model.outputUsdPerMtok,
    webSearchUsdPerCall: model.webSearchUsdPerCall,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  function toggleEffort(e: Effort, on: boolean) {
    const next = EFFORTS.filter((x) => (x === e ? on : f.reasoningEfforts.includes(x)));
    setF((s) => ({ ...s, reasoningEfforts: next, defaultEffort: s.defaultEffort && next.includes(s.defaultEffort) ? s.defaultEffort : (next[0] ?? null) }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const thinkingBudgets = Object.fromEntries(
      f.reasoningEfforts.filter((x) => x !== 'none' && f.budgets[x].trim() !== '').map((x) => [x, Number(f.budgets[x])]),
    ) as Partial<Record<Effort, number>>;
    try {
      await patch.mutateAsync({
        id: model.id,
        displayName: f.displayName,
        description: f.description,
        providerModelId: f.providerModelId,
        tier: f.tier,
        reasoningEfforts: f.reasoningEfforts,
        defaultEffort: f.defaultEffort,
        thinkingBudgets,
        maxOutputTokens: Number(f.maxOutputTokens),
        supportsImages: f.supportsImages,
        supportsDocuments: f.supportsDocuments,
        supportsMultiTurnTools: f.supportsMultiTurnTools,
        webSearchEnabled: f.webSearchEnabled,
        inputUsdPerMtok: f.inputUsdPerMtok,
        cachedInputUsdPerMtok: f.cachedInputUsdPerMtok,
        outputUsdPerMtok: f.outputUsdPerMtok,
        webSearchUsdPerCall: f.webSearchUsdPerCall,
      });
      toast('Model saved.');
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save the model.', 'error');
    }
  }

  const field = (label: string, input: React.ReactNode, hint?: string) => (
    <label className="block">
      <span className="section-label">{label}</span>
      <div className="mt-1">{input}</div>
      {hint && <span className="mt-0.5 block text-xs text-lc-grey">{hint}</span>}
    </label>
  );
  const check = (key: 'supportsImages' | 'supportsDocuments' | 'supportsMultiTurnTools' | 'webSearchEnabled', label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="accent-[var(--blue)]" checked={f[key]} onChange={(e) => set(key, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} className="flex max-h-[90vh] flex-col">
      <header className="border-b border-lc-border px-5 py-4">
        <h2 id="model-edit-title" className="text-lg font-medium">
          Edit {model.displayName}
        </h2>
        <p className="text-xs text-lc-grey">
          {PROVIDER_LABELS[model.provider]} · seed key <code>{model.slug}</code>
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {field('Display name', <input className={inputClass} value={f.displayName} maxLength={100} onChange={(e) => set('displayName', e.target.value)} />)}
          {field(
            'Provider model id',
            <input className={`${inputClass} font-mono`} value={f.providerModelId} maxLength={200} onChange={(e) => set('providerModelId', e.target.value)} />,
          )}
        </div>
        {field('Description', <input className={inputClass} value={f.description} maxLength={300} onChange={(e) => set('description', e.target.value)} />)}
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            'Tier',
            <select className={inputClass} value={f.tier} onChange={(e) => set('tier', e.target.value as Tier)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t[0]!.toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Max output tokens',
            <input className={inputClass} inputMode="numeric" value={f.maxOutputTokens} onChange={(e) => set('maxOutputTokens', e.target.value)} />,
          )}
        </div>

        <fieldset>
          <legend className="section-label">Thinking efforts</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {EFFORTS.map((e) => (
              <label key={e} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--blue)]"
                  checked={f.reasoningEfforts.includes(e)}
                  onChange={(ev) => toggleEffort(e, ev.target.checked)}
                />
                {EFFORT_LABELS[e]}
              </label>
            ))}
          </div>
        </fieldset>
        {f.reasoningEfforts.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {field(
              'Default effort',
              <select className={inputClass} value={f.defaultEffort ?? ''} onChange={(e) => set('defaultEffort', e.target.value as Effort)}>
                {f.reasoningEfforts.map((e) => (
                  <option key={e} value={e}>
                    {EFFORT_LABELS[e]}
                  </option>
                ))}
              </select>,
            )}
            {f.reasoningEfforts
              .filter((e) => e !== 'none')
              .map((e) => (
                <div key={e}>
                  {field(
                    `${EFFORT_LABELS[e]} budget`,
                    <input
                      className={inputClass}
                      inputMode="numeric"
                      placeholder="adaptive"
                      value={f.budgets[e]}
                      onChange={(ev) => set('budgets', { ...f.budgets, [e]: ev.target.value })}
                    />,
                  )}
                </div>
              ))}
          </div>
        )}
        {f.reasoningEfforts.length > 0 && (
          <p className="text-xs text-lc-grey">Budgets are thinking tokens (at least 1024). Leave blank to use the provider's own effort control.</p>
        )}

        <fieldset>
          <legend className="section-label">Capabilities</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {check('supportsImages', 'Images')}
            {check('supportsDocuments', 'PDF documents')}
            {check('webSearchEnabled', 'Web search')}
            {check('supportsMultiTurnTools', 'Multiple tool turns')}
          </div>
        </fieldset>

        <fieldset>
          <legend className="section-label">Prices (USD)</legend>
          <div className="mt-1 grid gap-3 sm:grid-cols-4">
            {(
              [
                ['inputUsdPerMtok', 'Input / 1M'],
                ['cachedInputUsdPerMtok', 'Cached / 1M'],
                ['outputUsdPerMtok', 'Output / 1M'],
                ['webSearchUsdPerCall', 'Per search'],
              ] as const
            ).map(([k, label]) => (
              <div key={k}>{field(label, <input className={inputClass} inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} />)}</div>
            ))}
          </div>
        </fieldset>
      </div>
      <footer className="flex justify-end gap-2 border-t border-lc-border px-5 py-3">
        <button type="button" onClick={onDone} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={patch.isPending} className={primaryButton}>
          {patch.isPending ? 'Saving…' : 'Save model'}
        </button>
      </footer>
    </form>
  );
}
