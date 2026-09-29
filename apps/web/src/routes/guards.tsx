import type { Frontend } from '@wchats/shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { canUse, useCurrentUser } from '../lib/me';
import { ForbiddenPage } from './ForbiddenPage';

export function RequireFrontend({ app, children }: { app: Frontend; children: ReactNode }) {
  return canUse(useCurrentUser(), app) ? children : <ForbiddenPage />;
}

export function RequireManager({ children }: { children: ReactNode }) {
  return useCurrentUser().profile.isManager ? children : <ForbiddenPage />;
}

/** Sends the user to their default app (SimGen is external, so it falls back to an in-app page). */
export function DefaultAppRedirect() {
  const me = useCurrentUser();
  const order: Frontend[] = [me.profile.defaultApp, 'chat', 'ask'];
  const target = order.find((app) => app !== 'simgen' && canUse(me, app));
  return <Navigate to={target ? `/${target}` : '/profile'} replace />;
}
