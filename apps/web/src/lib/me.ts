import type { Frontend, MeResponse } from '@wchats/shared';
import { createContext, useContext } from 'react';

export const MeContext = createContext<MeResponse | null>(null);

export function useCurrentUser(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error('useCurrentUser outside of the signed-in layout');
  return me;
}

export const canUse = (me: MeResponse, app: Frontend) => me.profile.allowedFrontends.includes(app);
