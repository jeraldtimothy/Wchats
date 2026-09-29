import { useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { authClient } from '../api/auth';
import { ApiError } from '../api/client';
import { useMe } from '../api/queries';
import { MeContext } from '../lib/me';
import { PickerContext } from '../lib/picker';
import { Mascot } from './Logo';
import { ModelPicker } from './ModelPicker';
import { Sidebar } from './Sidebar';

export function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-lc-grey">
      <Mascot size={44} />
      {children}
    </div>
  );
}

export function AppLayout() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (me.isPending) return <FullScreenMessage>Loading…</FullScreenMessage>;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (me.error instanceof ApiError && me.error.code === 'account_disabled') {
    return (
      <FullScreenMessage>
        <p className="text-lc-dark">Your account is disabled. Contact a manager for access.</p>
        <button
          type="button"
          className="focus-ring rounded-md border border-lc-border px-3 py-1.5 text-sm text-lc-dark hover:bg-lc-white"
          onClick={async () => {
            await authClient.signOut();
            navigate('/login', { replace: true });
          }}
        >
          Sign out
        </button>
      </FullScreenMessage>
    );
  }
  if (me.error || !me.data) {
    return (
      <FullScreenMessage>
        <p>Could not load your account.</p>
        <button type="button" className="focus-ring text-lc-blue underline" onClick={() => me.refetch()}>
          Try again
        </button>
      </FullScreenMessage>
    );
  }

  // On phones the sidebar and the main area are separate screens: the
  // sessions list lives at /chat, everything else shows the main area.
  const sidebarScreen = location.pathname === '/chat';

  return (
    <MeContext.Provider value={me.data}>
      <PickerContext.Provider value={{ openPicker: () => setPickerOpen(true) }}>
        <div className="flex h-full">
          <Sidebar className={`${sidebarScreen ? 'flex w-full' : 'hidden'} md:flex md:w-[300px] md:shrink-0`} />
          <main className={`${sidebarScreen ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
            <Outlet />
          </main>
        </div>
        <ModelPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
      </PickerContext.Provider>
    </MeContext.Provider>
  );
}

