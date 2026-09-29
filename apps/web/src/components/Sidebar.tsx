import type { SessionSummary } from '@wchats/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router';
import { authClient } from '../api/auth';
import { useDeleteSession, useRenameSession, useSessions } from '../api/queries';
import { formatSessionDate } from '../lib/format';
import { canUse, useCurrentUser } from '../lib/me';
import { usePicker } from '../lib/picker';
import { LogoutIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';
import { Logo } from './Logo';
import { ConfirmDialog } from './Modal';
import { useToast } from './Toast';

const navItem = ({ isActive }: { isActive: boolean }) =>
  `focus-ring flex items-center justify-between rounded-md px-3 py-2 text-[15px] transition-colors ${
    isActive ? 'bg-lc-primary-light font-medium text-lc-blue' : 'text-lc-dark hover:bg-lc-assistant-bg'
  }`;

export function Sidebar({ className = '' }: { className?: string }) {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const chatAllowed = canUse(me, 'chat');

  async function logout() {
    await authClient.signOut();
    qc.clear();
    navigate('/login', { replace: true });
  }

  return (
    <aside className={`flex-col border-r border-lc-border bg-lc-white ${className}`}>
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <Logo />
        <button
          type="button"
          onClick={logout}
          title="Log out"
          aria-label="Log out"
          className="focus-ring rounded-md p-2 text-lc-grey hover:bg-lc-assistant-bg hover:text-lc-dark"
        >
          <LogoutIcon />
        </button>
      </div>

      <nav className="space-y-5 px-3" aria-label="Main">
        <div>
          <div className="section-label px-3 pb-1.5">Apps</div>
          <div className="space-y-0.5">
            {canUse(me, 'simgen') && (
              <a href={me.config.simgenUrl} target="_blank" rel="noopener noreferrer" className={navItem({ isActive: false })}>
                SimGen ↗
              </a>
            )}
            {canUse(me, 'ask') && (
              <NavLink to="/ask" className={navItem}>
                Ask
              </NavLink>
            )}
            {chatAllowed && (
              <NavLink to="/chat" className={navItem}>
                CHAT
              </NavLink>
            )}
          </div>
        </div>
        <div>
          <div className="section-label px-3 pb-1.5">Account</div>
          <div className="space-y-0.5">
            <NavLink to="/profile" className={navItem}>
              My Profile
            </NavLink>
            {me.profile.isManager && (
              <NavLink to="/iam" className={navItem}>
                IAM and Billing
              </NavLink>
            )}
          </div>
        </div>
      </nav>

      {chatAllowed && <SessionList />}
    </aside>
  );
}

function SessionList() {
  const { openPicker } = usePicker();
  const sessions = useSessions();
  const active = useMatch('/chat/:sessionId')?.params.sessionId;
  const navigate = useNavigate();
  const toast = useToast();
  const del = useDeleteSession();
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await del.mutateAsync(pendingDelete.id);
      if (pendingDelete.id === active) navigate('/chat');
    } catch {
      toast('Could not delete this chat.', 'error');
    }
    setPendingDelete(null);
  }

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-6 pb-1.5">
        <span className="section-label">Sessions</span>
        <button
          type="button"
          onClick={openPicker}
          aria-label="New chat"
          title="New chat"
          className="focus-ring rounded-md p-1 text-lc-blue hover:bg-lc-primary-light"
        >
          <PlusIcon />
        </button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {sessions.isPending && <li className="px-3 py-2 text-sm text-lc-grey">Loading…</li>}
        {sessions.data?.length === 0 && <li className="px-3 py-2 text-sm text-lc-grey">No chats yet.</li>}
        {sessions.data?.map((s) => (
          <SessionRow key={s.id} session={s} active={s.id === active} onDelete={() => setPendingDelete(s)} />
        ))}
      </ul>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this chat?"
        body={`"${pendingDelete?.title ?? 'New chat'}" will be removed from your sessions.`}
        confirmLabel="Delete"
        busy={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function SessionRow({ session, active, onDelete }: { session: SessionSummary; active: boolean; onDelete: () => void }) {
  const rename = useRenameSession();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const title = session.title ?? 'New chat';

  function startEdit() {
    setDraft(session.title ?? '');
    setEditing(true);
  }
  async function save() {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === session.title) return;
    try {
      await rename.mutateAsync({ id: session.id, title: next });
    } catch {
      toast('Could not rename this chat.', 'error');
    }
  }

  return (
    <li className="group relative">
      {active && <span className="absolute top-2 bottom-2 left-0 w-1 rounded-r-sm bg-lc-blue" aria-hidden="true" />}
      {editing ? (
        <div className="rounded-md bg-lc-primary-light px-3 py-2">
          <input
            autoFocus
            value={draft}
            maxLength={200}
            aria-label="Chat title"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full rounded-sm border border-lc-border bg-lc-white px-2 py-1 text-sm outline-none focus:border-lc-blue"
          />
        </div>
      ) : (
        <NavLink
          to={`/chat/${session.id}`}
          className={`focus-ring block rounded-md py-2 pr-16 pl-4 transition-colors ${
            active ? 'bg-lc-primary-light' : 'hover:bg-lc-assistant-bg'
          }`}
        >
          <div className={`truncate text-sm ${active ? 'font-medium text-lc-dark' : 'text-lc-dark'}`}>{title}</div>
          <div className="mt-0.5 truncate text-xs text-lc-grey">
            {formatSessionDate(session.lastActivityAt)}
            {session.isRetired && <span className="ml-1.5 rounded-sm bg-lc-assistant-bg px-1 text-[10px] uppercase">Retired</span>}
          </div>
        </NavLink>
      )}
      {!editing && (
        <div className="absolute top-1/2 right-2 hidden -translate-y-1/2 gap-0.5 group-focus-within:flex group-hover:flex">
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Rename ${title}`}
            className="focus-ring rounded-sm p-1.5 text-lc-grey hover:bg-lc-white hover:text-lc-dark"
          >
            <PencilIcon size={15} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${title}`}
            className="focus-ring rounded-sm p-1.5 text-lc-grey hover:bg-lc-white hover:text-lc-error"
          >
            <TrashIcon size={15} />
          </button>
        </div>
      )}
    </li>
  );
}
