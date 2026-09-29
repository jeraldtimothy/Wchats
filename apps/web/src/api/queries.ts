import type {
  CreateSessionBody,
  MeResponse,
  ModelListResponse,
  ModelSummary,
  PostMessageBody,
  PostMessageResponse,
  PublicConfig,
  SessionDetail,
  SessionSummary,
} from '@wchats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';

export const qk = {
  me: ['me'] as const,
  config: ['config'] as const,
  models: ['models'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
};

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: () => api<PublicConfig>('/api/config'), staleTime: Infinity });
}

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api<MeResponse>('/api/me'),
    retry: (count, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 403)) && count < 2,
    staleTime: 30_000,
  });
}

export function useModels(enabled = true) {
  return useQuery({
    queryKey: qk.models,
    queryFn: () => api<ModelListResponse>('/api/models').then((r) => r.models),
    enabled,
    staleTime: 60_000,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      api<void>(`/api/models/${id}/favorite`, { method: favorite ? 'PUT' : 'DELETE' }),
    onMutate: async ({ id, favorite }) => {
      await qc.cancelQueries({ queryKey: qk.models });
      const prev = qc.getQueryData<ModelSummary[]>(qk.models);
      qc.setQueryData<ModelSummary[]>(qk.models, (list) =>
        list?.map((m) => (m.id === id ? { ...m, isFavorite: favorite } : m)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.models, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.models }),
  });
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => api<{ sessions: SessionSummary[] }>('/api/chat/v2/sessions').then((r) => r.sessions),
    enabled,
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: qk.session(id ?? ''),
    queryFn: () => api<SessionDetail>(`/api/chat/v2/session/${id}`),
    enabled: Boolean(id),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSessionBody) =>
      api<SessionDetail>('/api/chat/v2/sessions', { method: 'POST', json: body }),
    onSuccess: (detail) => {
      qc.setQueryData(qk.session(detail.session.id), detail);
      qc.setQueryData<SessionSummary[]>(qk.sessions, (list) => [detail.session, ...(list ?? [])]);
    },
  });
}

export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api<SessionDetail>(`/api/chat/v2/session/${id}`, { method: 'PATCH', json: { title } }),
    onSuccess: (detail) => {
      qc.setQueryData(qk.session(detail.session.id), detail);
      qc.setQueryData<SessionSummary[]>(qk.sessions, (list) =>
        list?.map((s) => (s.id === detail.session.id ? { ...s, title: detail.session.title } : s)),
      );
    },
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/chat/v2/session/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      qc.setQueryData<SessionSummary[]>(qk.sessions, (list) => list?.filter((s) => s.id !== id));
      qc.removeQueries({ queryKey: qk.session(id) });
    },
  });
}

export function usePostMessage(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PostMessageBody) =>
      api<PostMessageResponse>(`/api/chat/v2/session/${sessionId}/post-message`, { method: 'POST', json: body }),
    onSuccess: ({ userMessage, assistantMessage }) => {
      qc.setQueryData<SessionDetail>(qk.session(sessionId), (d) =>
        d
          ? {
              ...d,
              messages: [
                ...d.messages.filter((m) => m.id !== userMessage.id && m.id !== assistantMessage.id),
                userMessage,
                assistantMessage,
              ],
            }
          : d,
      );
      qc.setQueryData<SessionSummary[]>(qk.sessions, (list) => {
        if (!list) return list;
        const current = list.find((s) => s.id === sessionId);
        if (!current) return list;
        return [{ ...current, lastActivityAt: userMessage.createdAt }, ...list.filter((s) => s.id !== sessionId)];
      });
    },
  });
}
