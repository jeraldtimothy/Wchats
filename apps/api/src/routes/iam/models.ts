import { PatchIamModelBody, type Effort, type IamModel } from '@wchats/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { models } from '../../db/schema.js';
import { HttpError, notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import type { ModelRow } from '../../models/catalog.js';
import type { ProviderRegistry } from '../../providers/index.js';

const IdParams = z.object({ id: z.uuid() });

/** Postgres numeric comes back as "1.250000"; show it without trailing zeros. */
const price = (v: string) => v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

function toIamModel(m: ModelRow, providers: ProviderRegistry): IamModel {
  return {
    id: m.id,
    slug: m.slug,
    provider: m.provider,
    providerConfigured: providers.isConfigured(m.provider),
    providerModelId: m.providerModelId,
    displayName: m.displayName,
    description: m.description,
    tier: m.tier,
    reasoningEfforts: m.reasoningEfforts as Effort[],
    defaultEffort: (m.defaultEffort as Effort | null) ?? null,
    thinkingBudgets: m.thinkingBudgets,
    maxOutputTokens: m.maxOutputTokens,
    supportsImages: m.supportsImages,
    supportsDocuments: m.supportsDocuments,
    supportsMultiTurnTools: m.supportsMultiTurnTools,
    webSearchEnabled: m.webSearchEnabled,
    inputUsdPerMtok: price(m.inputUsdPerMtok),
    cachedInputUsdPerMtok: price(m.cachedInputUsdPerMtok),
    outputUsdPerMtok: price(m.outputUsdPerMtok),
    webSearchUsdPerCall: price(m.webSearchUsdPerCall),
    isRetired: m.isRetired,
    agentEnabled: m.agentEnabled,
    editedAt: m.editedAt?.toISOString() ?? null,
  };
}

export async function iamModelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/iam/models', async (): Promise<{ models: IamModel[] }> => {
    const rows = await db.select().from(models).orderBy(asc(models.provider), asc(models.sortOrder), asc(models.displayName));
    return { models: rows.map((m) => toIamModel(m, app.providers)) };
  });

  app.patch('/api/iam/models/:id', async (request): Promise<IamModel> => {
    const { id } = parse(IdParams, request.params);
    const body = parse(PatchIamModelBody, request.body);
    const current = await db.query.models.findFirst({ where: eq(models.id, id) });
    if (!current) throw notFound('Model');

    // Validate against the merged result so partial edits stay consistent.
    const efforts = body.reasoningEfforts ?? (current.reasoningEfforts as Effort[]);
    let defaultEffort = body.defaultEffort !== undefined ? body.defaultEffort : (current.defaultEffort as Effort | null);
    if (efforts.length === 0) defaultEffort = null;
    else if (defaultEffort === null || !efforts.includes(defaultEffort)) {
      if (body.defaultEffort !== undefined && body.defaultEffort !== null) {
        throw new HttpError(400, 'validation', 'The default effort must be one of the allowed efforts.');
      }
      defaultEffort = efforts[0]!;
    }

    const [updated] = await db
      .update(models)
      .set({ ...body, reasoningEfforts: efforts, defaultEffort, editedAt: new Date() })
      .where(eq(models.id, id))
      .returning();
    return toIamModel(updated!, app.providers);
  });
}
