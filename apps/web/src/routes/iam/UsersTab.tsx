import { FRONTENDS, type Frontend, type IamUser } from '@wchats/shared';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { useIamAccounts, useIamUsers, usePatchIamUser, useSetMember } from '../../api/iam';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { useCurrentUser } from '../../lib/me';
import { useDebounced } from '../../lib/useDebounced';
import { Badge, Panel, Switch, inputClass, secondaryButton } from './ui';

const APP_LABELS: Record<Frontend, string> = { chat: 'Chat', simgen: 'SimGen' };

export function UsersTab() {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const users = useIamUsers(q);
  const [assigning, setAssigning] = useState<IamUser | null>(null);
  const rows = users.data?.pages.flatMap((p) => p.users) ?? [];
  const total = users.data?.pages[0]?.total ?? 0;

  return (
    <Panel
      title={`Users${users.data ? ` (${total})` : ''}`}
      actions={
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email or username"
          aria-label="Search users"
          className={`${inputClass} sm:w-72`}
        />
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-lc-border text-left">
            <tr>
              {['User', 'Apps', 'Manager', 'Status', 'Billing accounts'].map((h) => (
                <th key={h} scope="col" className="section-label px-4 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <UserRow key={u.id} user={u} onAssign={() => setAssigning(u)} />
            ))}
          </tbody>
        </table>
      </div>
      {users.isPending && <p className="px-4 py-3 text-sm text-lc-grey">Loading…</p>}
      {users.data && rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-lc-grey">No users match.</p>}
      {users.hasNextPage && (
        <div className="border-t border-lc-border p-3 text-center">
          <button type="button" className={secondaryButton} disabled={users.isFetchingNextPage} onClick={() => users.fetchNextPage()}>
            {users.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      <AssignAccountsDialog user={assigning} onClose={() => setAssigning(null)} />
    </Panel>
  );
}

function UserRow({ user, onAssign }: { user: IamUser; onAssign: () => void }) {
  const me = useCurrentUser();
  const patch = usePatchIamUser();
  const toast = useToast();
  const self = user.id === me.user.id;

  const save = (body: Parameters<typeof patch.mutate>[0]) =>
    patch.mutate(body, { onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not save.', 'error') });

  function toggleApp(app: Frontend, on: boolean) {
    const next = on ? [...user.allowedFrontends, app] : user.allowedFrontends.filter((a) => a !== app);
    save({ id: user.id, allowedFrontends: FRONTENDS.filter((a) => next.includes(a)) });
  }

  return (
    <tr className="border-b border-lc-border align-top last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium">
          {user.name} {self && <span className="text-xs font-normal text-lc-grey">(you)</span>}
        </div>
        <div className="text-xs text-lc-grey">{user.email}</div>
        <div className="text-xs text-lc-grey">@{user.username}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {FRONTENDS.map((app) => {
            const on = user.allowedFrontends.includes(app);
            return (
              <button
                key={app}
                type="button"
                aria-pressed={on}
                disabled={patch.isPending}
                onClick={() => toggleApp(app, !on)}
                className={`focus-ring rounded-full border px-2.5 py-0.5 text-xs transition ${
                  on ? 'border-lc-light-blue bg-lc-primary-light text-lc-blue' : 'border-lc-border text-lc-grey hover:text-lc-dark'
                }`}
              >
                {APP_LABELS[app]}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-4 py-3">
        <Switch
          checked={user.isManager}
          label={`Manager: ${user.name}`}
          disabled={patch.isPending || (self && user.isManager)}
          title={self ? "You can't remove your own manager access" : undefined}
          onChange={(v) => save({ id: user.id, isManager: v })}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge tone={user.isDisabled ? 'red' : 'green'}>{user.isDisabled ? 'Disabled' : 'Active'}</Badge>
          <button
            type="button"
            disabled={patch.isPending || self}
            title={self ? "You can't disable your own account" : undefined}
            onClick={() => save({ id: user.id, isDisabled: !user.isDisabled })}
            className="focus-ring text-xs text-lc-blue hover:underline disabled:cursor-not-allowed disabled:text-lc-grey disabled:no-underline"
          >
            {user.isDisabled ? 'Enable' : 'Disable'}
          </button>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {user.accounts.map((a) => (
            <span key={a.id} className="max-w-[180px] truncate rounded-full bg-lc-assistant-bg px-2 py-0.5 text-xs" title={a.name}>
              {a.name}
            </span>
          ))}
          <button type="button" onClick={onAssign} className="focus-ring text-xs text-lc-blue hover:underline">
            Manage
          </button>
        </div>
      </td>
    </tr>
  );
}

function AssignAccountsDialog({ user, onClose }: { user: IamUser | null; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const accounts = useIamAccounts(useDebounced(query.trim()), 'shared');
  const setMember = useSetMember();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  // Local copy so checkboxes update immediately; the users list refreshes behind it.
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [forUser, setForUser] = useState<string | null>(null);
  if (user && forUser !== user.id) {
    setForUser(user.id);
    setMemberOf(new Set(user.accounts.map((a) => a.id)));
  }

  async function toggle(accountId: string, member: boolean) {
    if (!user) return;
    setPending(accountId);
    try {
      await setMember.mutateAsync({ accountId, userId: user.id, member });
      setMemberOf((s) => {
        const next = new Set(s);
        if (member) next.add(accountId);
        else next.delete(accountId);
        return next;
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update membership.', 'error');
    } finally {
      setPending(null);
    }
  }

  return (
    <Modal open={user !== null} onClose={onClose} labelledBy="assign-title" className="max-w-md">
      <div className="p-5">
        <h2 id="assign-title" className="text-lg font-medium">
          Billing accounts for {user?.name}
        </h2>
        <p className="mt-0.5 text-sm text-lc-grey">Members can charge sessions to these shared accounts.</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search shared accounts"
          aria-label="Search shared accounts"
          className={`${inputClass} mt-4`}
        />
        <ul className="mt-3 max-h-72 divide-y divide-lc-border overflow-y-auto rounded-md border border-lc-border">
          {accounts.data?.length === 0 && (
            <li className="p-3 text-sm text-lc-grey">No shared accounts yet. Create one in Billing Accounts.</li>
          )}
          {accounts.data?.map((a) => (
            <li key={a.id}>
              <label className="flex cursor-pointer items-center gap-3 p-3 text-sm hover:bg-lc-light">
                <input
                  type="checkbox"
                  className="accent-[var(--blue)]"
                  checked={memberOf.has(a.id)}
                  disabled={pending === a.id}
                  onChange={(e) => toggle(a.id, e.target.checked)}
                />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                {a.isDisabled && <Badge tone="red">Disabled</Badge>}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-right">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
