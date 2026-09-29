import type {
  CreditBody,
  IamAccount,
  IamAccountDetail,
  IamLedgerResponse,
  IamModel,
  IamUser,
  IamUsersResponse,
  PatchAccountBody,
  PatchIamModelBody,
  PatchIamUserBody,
  UsageResponse,
} from '@wchats/shared';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { qk as appKeys } from './queries';

export interface DateRange {
  from: string;
  to: string;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const iamKeys = {
  users: (q: string) => ['iam', 'users', q] as const,
  accounts: (q: string, kind?: string) => ['iam', 'accounts', q, kind ?? ''] as const,
  account: (id: string) => ['iam', 'account', id] as const,
  ledger: (id: string, r: DateRange) => ['iam', 'ledger', id, r.from, r.to] as const,
  usage: (groupBy: string, r: DateRange, accountId?: string) => ['iam', 'usage', groupBy, r.from, r.to, accountId ?? ''] as const,
  models: ['iam', 'models'] as const,
};

export const ledgerCsvUrl = (id: string, r: DateRange) => `/api/iam/billing-accounts/${id}/ledger.csv${qs({ ...r })}`;
export const usageCsvUrl = (groupBy: string, r: DateRange, accountId?: string) =>
  `/api/iam/usage.csv${qs({ groupBy, ...r, accountId })}`;

// ---- users ---------------------------------------------------------------

const PAGE = 50;

export function useIamUsers(q: string) {
  return useInfiniteQuery({
    queryKey: iamKeys.users(q),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api<IamUsersResponse>(`/api/iam/users${qs({ q, limit: PAGE, offset: pageParam })}`),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.users.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

export function usePatchIamUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchIamUserBody & { id: string }) =>
      api<IamUser>(`/api/iam/users/${encodeURIComponent(id)}`, { method: 'PATCH', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['iam', 'users'] });
      void qc.invalidateQueries({ queryKey: appKeys.me });
    },
  });
}

// ---- accounts ------------------------------------------------------------

export function useIamAccounts(q = '', kind?: 'personal' | 'shared') {
  return useQuery({
    queryKey: iamKeys.accounts(q, kind),
    queryFn: () => api<{ accounts: IamAccount[] }>(`/api/iam/billing-accounts${qs({ q, kind })}`).then((r) => r.accounts),
    placeholderData: keepPreviousData,
  });
}

export function useIamAccount(id: string | null) {
  return useQuery({
    queryKey: iamKeys.account(id ?? ''),
    queryFn: () => api<IamAccountDetail>(`/api/iam/billing-accounts/${id}`),
    enabled: Boolean(id),
  });
}

/** Any change to an account refreshes lists, its detail, ledgers, usage and users' account chips. */
function useAccountMutation<V>(fn: (v: V) => Promise<IamAccountDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      qc.setQueryData(iamKeys.account(detail.id), detail);
      void qc.invalidateQueries({ queryKey: ['iam', 'accounts'] });
      void qc.invalidateQueries({ queryKey: ['iam', 'ledger', detail.id] });
      void qc.invalidateQueries({ queryKey: ['iam', 'usage'] });
      void qc.invalidateQueries({ queryKey: ['iam', 'users'] });
      void qc.invalidateQueries({ queryKey: appKeys.me });
    },
  });
}

export const useCreateAccount = () =>
  useAccountMutation((name: string) => api<IamAccountDetail>('/api/iam/billing-accounts', { method: 'POST', json: { name } }));

export const usePatchAccount = () =>
  useAccountMutation(({ id, ...body }: PatchAccountBody & { id: string }) =>
    api<IamAccountDetail>(`/api/iam/billing-accounts/${id}`, { method: 'PATCH', json: body }),
  );

export const useSetMember = () =>
  useAccountMutation(({ accountId, userId, member }: { accountId: string; userId: string; member: boolean }) =>
    api<IamAccountDetail>(`/api/iam/billing-accounts/${accountId}/members/${encodeURIComponent(userId)}`, {
      method: member ? 'PUT' : 'DELETE',
    }),
  );

export const useGrantCredit = () =>
  useAccountMutation(({ id, ...body }: CreditBody & { id: string }) =>
    api<IamAccountDetail>(`/api/iam/billing-accounts/${id}/credit`, { method: 'POST', json: body }),
  );

export function useLedger(id: string, range: DateRange) {
  return useInfiniteQuery({
    queryKey: iamKeys.ledger(id, range),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<IamLedgerResponse>(`/api/iam/billing-accounts/${id}/ledger${qs({ ...range, limit: 50, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useUsage(groupBy: 'user' | 'model', range: DateRange, accountId?: string) {
  return useQuery({
    queryKey: iamKeys.usage(groupBy, range, accountId),
    queryFn: () => api<UsageResponse>(`/api/iam/usage${qs({ groupBy, ...range, accountId })}`),
    placeholderData: keepPreviousData,
  });
}

// ---- models --------------------------------------------------------------

export function useIamModels() {
  return useQuery({
    queryKey: iamKeys.models,
    queryFn: () => api<{ models: IamModel[] }>('/api/iam/models').then((r) => r.models),
  });
}

export function usePatchModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchIamModelBody & { id: string }) =>
      api<IamModel>(`/api/iam/models/${id}`, { method: 'PATCH', json: body }),
    onSuccess: (m) => {
      qc.setQueryData<IamModel[]>(iamKeys.models, (list) => list?.map((x) => (x.id === m.id ? m : x)));
      void qc.invalidateQueries({ queryKey: appKeys.models });
    },
  });
}
