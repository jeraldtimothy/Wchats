import multipart from '@fastify/multipart';
import { MAX_UPLOAD_BYTES, type AttachmentDto } from '@wchats/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUpload, deleteUnsent, getOwnedAttachment, toAttachmentDto } from '../attachments/service.js';
import { getAuth, requireUser } from '../auth/guards.js';
import { db } from '../db/client.js';
import { HttpError } from '../http/errors.js';
import { parse } from '../http/validate.js';

const IdParams = z.object({ id: z.uuid() });

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0 } });
  app.addHook('preHandler', requireUser);

  app.post('/api/uploads', async (request, reply): Promise<AttachmentDto> => {
    if (!request.isMultipart()) throw new HttpError(400, 'validation', 'Send the file as multipart/form-data.');
    const file = await request.file();
    if (!file) throw new HttpError(400, 'validation', 'No file was attached.');
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch {
      throw new HttpError(413, 'validation', `"${file.filename}" is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    }
    if (data.length === 0) throw new HttpError(400, 'validation', `"${file.filename}" is empty.`);
    const row = await createUpload(db, app.storage, { userId: getAuth(request).user.id, filename: file.filename, data });
    reply.status(201);
    return toAttachmentDto(row);
  });

  app.get('/api/uploads/:id/content', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    const row = await getOwnedAttachment(db, getAuth(request).user.id, id);
    const data = await app.storage.get(row.storageKey);
    const inline = row.kind === 'image' || row.kind === 'pdf';
    return reply
      .header('content-type', row.mimeType)
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=3600')
      .send(data);
  });

  app.delete('/api/uploads/:id', async (request, reply) => {
    const { id } = parse(IdParams, request.params);
    await deleteUnsent(db, app.storage, getAuth(request).user.id, id);
    return reply.status(204).send();
  });
}
