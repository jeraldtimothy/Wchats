import {
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_UPLOAD_BYTES,
  OFFICE_EXTENSIONS,
  PDF_EXTENSIONS,
  TEXT_EXTENSIONS,
  extensionOf,
  type AttachmentDto,
  type ModelSummary,
} from '@wchats/shared';
import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { deleteUpload, uploadFile } from '../../api/uploads';

export interface PendingFile {
  localId: string;
  name: string;
  status: 'uploading' | 'ready' | 'error';
  attachment?: AttachmentDto;
  error?: string;
  preview?: string;
}

/** Extensions this model can take: images/PDFs by capability; text and office always. */
export function acceptedExtensions(model: ModelSummary): string[] {
  return [
    ...(model.supportsImages ? IMAGE_EXTENSIONS : []),
    ...(model.supportsDocuments ? PDF_EXTENSIONS : []),
    ...OFFICE_EXTENSIONS,
    ...TEXT_EXTENSIONS,
  ];
}

function rejectReason(file: File, model: ModelSummary, accepted: string[]): string | null {
  const ext = extensionOf(file.name);
  if (!accepted.includes(ext)) {
    if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return `${model.displayName} can't read images.`;
    if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) return `${model.displayName} can't read PDFs.`;
    return `"${file.name}" isn't a supported file type.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) return `"${file.name}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  return null;
}

/** Uploads files as soon as they're added; the message only carries their ids. */
export function useAttachments(model: ModelSummary, onReject: (message: string) => void) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const accepted = acceptedExtensions(model);

  const update = (localId: string, patch: Partial<PendingFile>) =>
    setFiles((list) => list.map((f) => (f.localId === localId ? { ...f, ...patch } : f)));

  const add = useCallback(
    (incoming: FileList | File[]) => {
      const list = [...incoming];
      const room = MAX_ATTACHMENTS_PER_MESSAGE - files.length;
      if (list.length > room) onReject(`Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
      for (const file of list.slice(0, Math.max(0, room))) {
        const reason = rejectReason(file, model, accepted);
        if (reason) {
          onReject(reason);
          continue;
        }
        const localId = crypto.randomUUID();
        const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
        const controller = new AbortController();
        controllers.current.set(localId, controller);
        setFiles((l) => [...l, { localId, name: file.name, status: 'uploading', preview }]);
        uploadFile(file, controller.signal)
          .then((attachment) => update(localId, { status: 'ready', attachment }))
          .catch((e: unknown) => {
            if ((e as Error).name === 'AbortError') return;
            update(localId, { status: 'error', error: e instanceof ApiError ? e.message : 'Upload failed.' });
          })
          .finally(() => controllers.current.delete(localId));
      }
    },
    [files.length, model, accepted, onReject],
  );

  const remove = useCallback((localId: string) => {
    setFiles((list) => {
      const f = list.find((x) => x.localId === localId);
      if (f?.attachment) void deleteUpload(f.attachment.id).catch(() => undefined);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      controllers.current.get(localId)?.abort();
      return list.filter((x) => x.localId !== localId);
    });
  }, []);

  /** After a successful send: the files now belong to the message. */
  const clear = useCallback(() => {
    setFiles((list) => {
      for (const f of list) if (f.preview) URL.revokeObjectURL(f.preview);
      return [];
    });
  }, []);

  return {
    files,
    add,
    remove,
    clear,
    accept: accepted.join(','),
    uploading: files.some((f) => f.status === 'uploading'),
    readyIds: files.filter((f) => f.status === 'ready').map((f) => f.attachment!.id),
    hasErrors: files.some((f) => f.status === 'error'),
  };
}
