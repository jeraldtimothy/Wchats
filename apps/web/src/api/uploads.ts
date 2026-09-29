import type { AttachmentDto } from '@wchats/shared';
import { api, ApiError } from './client';

export async function uploadFile(file: File, signal?: AbortSignal): Promise<AttachmentDto> {
  const form = new FormData();
  form.append('file', file, file.name);
  let res: Response;
  try {
    res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin', signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Upload failed. Check your connection.');
  }
  const body = (await res.json().catch(() => null)) as AttachmentDto | { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    const err = (body as { error?: { message: string } } | null)?.error;
    throw new ApiError(res.status, 'validation', err?.message ?? `Upload failed (${res.status})`);
  }
  return body as AttachmentDto;
}

export const deleteUpload = (id: string) => api<void>(`/api/uploads/${id}`, { method: 'DELETE' });

export const uploadUrl = (id: string) => `/api/uploads/${id}/content`;
