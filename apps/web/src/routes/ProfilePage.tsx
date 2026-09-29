import {
  MAX_GLOBAL_PROMPT_CHARS,
  MAX_MEMORY_CHARS,
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  type Frontend,
  type MemoryItemDto,
  type MemoryType,
  type ProfileResponse,
} from '@wchats/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import {
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useProfile,
  useUpdateMemory,
  useUpdateProfile,
} from '../api/queries';
import { BackToSessions } from '../components/BackToSessions';
import { CopyIcon, PencilIcon, TrashIcon } from '../components/icons';
import { ConfirmDialog } from '../components/Modal';
import { useCopy, useToast } from '../components/Toast';
import { formatCents } from '../lib/format';

const input =
  'focus-ring w-full rounded-md border border-lc-border bg-lc-input px-3 py-2 text-sm outline-none transition focus:border-lc-light-blue focus:bg-lc-white';
const primaryButton =
  'focus-ring rounded-md bg-lc-blue px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110 disabled:opacity-50';

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-lc-border bg-lc-white p-5 shadow-sm md:p-6">
      <h2 className="text-lg font-medium">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-lc-grey">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ProfilePage() {
  const profile = useProfile();
  return (
    <div className="flex-1 overflow-y-auto bg-lc-light">
      <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-8">
        <BackToSessions />
        <h1 className="text-2xl font-medium">My Profile</h1>
        {profile.isPending && <p className="text-sm text-lc-grey">Loading…</p>}
        {profile.isError && <p className="text-sm text-lc-error">Could not load your profile.</p>}
        {profile.data && (
          <>
            <UserCard profile={profile.data} />
            <SystemPromptCard key={profile.data.globalSystemPrompt} initial={profile.data.globalSystemPrompt} />
            <MemoriesCard />
            <AiMemoriesCard enabled={profile.data.generateAiMemories} />
            <DefaultAppCard profile={profile.data} />
            <BillingCard profile={profile.data} />
          </>
        )}
      </div>
    </div>
  );
}

function UserCard({ profile }: { profile: ProfileResponse }) {
  const copy = useCopy();
  const rows: [string, ReactNode][] = [
    ['Display name', profile.user.name],
    ['Username', profile.user.username],
    [
      'User ID',
      <span className="inline-flex items-center gap-1.5">
        <code className="font-mono text-xs">{profile.user.id}</code>
        <button
          type="button"
          onClick={() => copy(profile.user.id)}
          aria-label="Copy user ID"
          className="focus-ring rounded-sm p-0.5 text-lc-grey hover:text-lc-dark"
        >
          <CopyIcon size={14} />
        </button>
      </span>,
    ],
    ['Member since', new Date(profile.user.memberSince).toLocaleDateString(undefined, { dateStyle: 'long' })],
  ];
  return (
    <Card title="User Profile">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="section-label">{label}</dt>
            <dd className="mt-0.5 text-sm break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function SystemPromptCard({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const update = useUpdateProfile();
  const toast = useToast();
  const dirty = value.trim() !== initial;

  async function save() {
    try {
      await update.mutateAsync({ globalSystemPrompt: value });
      toast('Prompt saved.');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the prompt.', 'error');
    }
  }

  return (
    <Card title="Global System Prompt">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        maxLength={MAX_GLOBAL_PROMPT_CHARS}
        aria-label="Global System Prompt"
        placeholder="For example: Answer concisely. Use British English."
        className={`${input} resize-y`}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-lc-grey">This instruction will apply to all chat sessions.</p>
        <button type="button" onClick={save} disabled={!dirty || update.isPending} className={primaryButton}>
          {update.isPending ? 'Saving…' : 'Save Prompt'}
        </button>
      </div>
    </Card>
  );
}

function MemoryTypeSelect({ value, onChange }: { value: MemoryType; onChange: (t: MemoryType) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MemoryType)}
      aria-label="Memory type"
      className={`${input} sm:w-36`}
    >
      {MEMORY_TYPES.map((t) => (
        <option key={t} value={t}>
          {MEMORY_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

function MemoriesCard() {
  const memories = useMemories();
  const create = useCreateMemory();
  const del = useDeleteMemory();
  const toast = useToast();
  const [type, setType] = useState<MemoryType>('preference');
  const [content, setContent] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MemoryItemDto | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      await create.mutateAsync({ type, content });
      setContent('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not add the memory item.', 'error');
    }
  }

  return (
    <Card title="Memory Items" description="Facts and preferences chats can use when Include Memories is on.">
      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
        <MemoryTypeSelect value={type} onChange={setType} />
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={MAX_MEMORY_CHARS}
          placeholder="Something to remember"
          aria-label="Memory content"
          className={`${input} flex-1`}
        />
        <button type="submit" disabled={!content.trim() || create.isPending} className={`${primaryButton} shrink-0`}>
          Add Memory Item
        </button>
      </form>

      <div className="mt-4">
        {memories.isPending && <p className="text-sm text-lc-grey">Loading…</p>}
        {memories.data?.length === 0 && (
          <p className="rounded-md border border-dashed border-lc-border px-4 py-6 text-center text-sm text-lc-grey">
            No memory items yet. Add your first one above.
          </p>
        )}
        {memories.data && memories.data.length > 0 && (
          <ul className="divide-y divide-lc-border rounded-md border border-lc-border">
            {memories.data.map((m) => (
              <MemoryRow key={m.id} item={m} onDelete={() => setPendingDelete(m)} />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this memory item?"
        body={pendingDelete?.content ?? ''}
        confirmLabel="Delete"
        busy={del.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await del.mutateAsync(pendingDelete.id).catch(() => toast('Could not delete the memory item.', 'error'));
          }
          setPendingDelete(null);
        }}
      />
    </Card>
  );
}

function MemoryRow({ item, onDelete }: { item: MemoryItemDto; onDelete: () => void }) {
  const update = useUpdateMemory();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(item.type);
  const [content, setContent] = useState(item.content);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({ id: item.id, type, content });
      setEditing(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save the memory item.', 'error');
    }
  }

  if (editing) {
    return (
      <li className="p-3">
        <form onSubmit={save} className="flex flex-col gap-2 sm:flex-row">
          <MemoryTypeSelect value={type} onChange={setType} />
          <input
            autoFocus
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={MAX_MEMORY_CHARS}
            aria-label="Memory content"
            className={`${input} flex-1`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setType(item.type);
                setContent(item.content);
              }}
              className="focus-ring rounded-md px-3 py-2 text-sm hover:bg-lc-assistant-bg"
            >
              Cancel
            </button>
            <button type="submit" disabled={!content.trim() || update.isPending} className={primaryButton}>
              Save
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="group flex items-start gap-3 p-3">
      <span className="section-label mt-0.5 w-20 shrink-0">{MEMORY_TYPE_LABELS[item.type]}</span>
      <span className="min-w-0 flex-1 text-sm break-words">
        {item.content}
        {item.aiGenerated && (
          <span className="ml-2 rounded-full bg-lc-primary-light px-1.5 py-0.5 align-middle text-[10px] font-medium text-lc-blue">
            AI-generated
          </span>
        )}
      </span>
      <span className="flex shrink-0 gap-0.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit memory item"
          className="focus-ring rounded-sm p-1.5 text-lc-grey hover:bg-lc-light hover:text-lc-dark"
        >
          <PencilIcon size={15} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete memory item"
          className="focus-ring rounded-sm p-1.5 text-lc-grey hover:bg-lc-light hover:text-lc-error"
        >
          <TrashIcon size={15} />
        </button>
      </span>
    </li>
  );
}

function AiMemoriesCard({ enabled }: { enabled: boolean }) {
  const update = useUpdateProfile();
  const toast = useToast();
  return (
    <Card title="Generate AI Memories">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-lc-grey">
          Each night, LiteChat reads chats it hasn't looked at yet and suggests memory items for you. They are
          marked as AI-generated, and you can edit or delete them.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Generate AI Memories"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ generateAiMemories: !enabled }, { onError: () => toast('Could not save this setting.', 'error') })
          }
          className={`focus-ring relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${enabled ? 'bg-lc-blue' : 'bg-lc-grey/40'}`}
        >
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
    </Card>
  );
}

const APPS: { id: Frontend; label: string }[] = [
  { id: 'simgen', label: 'SimGen' },
  { id: 'chat', label: 'Chat' },
];

function DefaultAppCard({ profile }: { profile: ProfileResponse }) {
  const update = useUpdateProfile();
  const toast = useToast();
  return (
    <Card title="Default App" description="Where you land after signing in.">
      <div className="inline-flex rounded-md bg-lc-light p-1" role="radiogroup" aria-label="Default app">
        {APPS.map((app) => {
          const allowed = profile.allowedFrontends.includes(app.id);
          const selected = profile.defaultApp === app.id;
          return (
            <button
              key={app.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!allowed || update.isPending}
              title={allowed ? undefined : "You don't have access to this app"}
              onClick={() =>
                !selected && update.mutate({ defaultApp: app.id }, { onError: () => toast('Could not save this setting.', 'error') })
              }
              className={`focus-ring rounded-sm px-4 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                selected ? 'bg-lc-white font-medium text-lc-blue shadow-sm' : 'text-lc-grey hover:text-lc-dark'
              }`}
            >
              {app.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function BillingCard({ profile }: { profile: ProfileResponse }) {
  return (
    <Card title="Billing Accounts">
      {profile.billingAccounts.length === 0 ? (
        <p className="text-sm text-lc-grey">You aren't a member of any billing account.</p>
      ) : (
        <ul className="divide-y divide-lc-border rounded-md border border-lc-border">
          {profile.billingAccounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{a.name}</span>
                <span
                  className={`section-label rounded-full px-2 py-0.5 !text-[10px] ${
                    a.isDisabled ? 'bg-lc-error/10 !text-lc-error' : 'bg-emerald-50 !text-emerald-700'
                  }`}
                >
                  {a.isDisabled ? 'Disabled' : 'Active'}
                </span>
              </div>
              <div className="text-right">
                <div className="section-label !text-[10px]">Available credit</div>
                <div className={`font-display text-lg ${a.balanceCents <= 0 ? 'text-lc-error' : 'text-lc-dark'}`}>
                  {formatCents(a.balanceCents)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
