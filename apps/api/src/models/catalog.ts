import type { Effort, ModelSummary } from '@wchats/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { SeedModel } from '../../seed/models.config.js';
import type { DbOrTx } from '../db/client.js';
import { modelFavorites, models } from '../db/schema.js';
import type { ProviderRegistry } from '../providers/index.js';

export type ModelRow = typeof models.$inferSelect;

const TIER_ORDER = sql`case ${models.tier} when 'premium' then 0 when 'standard' then 1 else 2 end`;

export function toModelSummary(m: ModelRow, isFavorite: boolean): ModelSummary {
  return {
    id: m.id,
    provider: m.provider,
    displayName: m.displayName,
    description: m.description,
    tier: m.tier,
    reasoningEfforts: m.reasoningEfforts as Effort[],
    defaultEffort: (m.defaultEffort as Effort | null) ?? null,
    supportsImages: m.supportsImages,
    supportsDocuments: m.supportsDocuments,
    supportsMultiTurnTools: m.supportsMultiTurnTools,
    webSearchEnabled: m.webSearchEnabled,
    isRetired: m.isRetired,
    agentEnabled: m.agentEnabled,
    isFavorite,
  };
}

/** Picker catalog: not retired, provider configured, with the user's favorites flagged. */
export async function listPickerModels(
  db: DbOrTx,
  registry: ProviderRegistry,
  userId: string,
): Promise<ModelSummary[]> {
  const rows = await db
    .select({ model: models, favoriteAt: modelFavorites.createdAt })
    .from(models)
    .leftJoin(modelFavorites, and(eq(modelFavorites.modelId, models.id), eq(modelFavorites.userId, userId)))
    .where(eq(models.isRetired, false))
    .orderBy(asc(models.provider), asc(models.sortOrder), TIER_ORDER, asc(models.displayName));
  return rows
    .filter((r) => registry.isConfigured(r.model.provider))
    .map((r) => toModelSummary(r.model, r.favoriteAt !== null));
}

export async function upsertModels(db: DbOrTx, seed: SeedModel[]): Promise<void> {
  for (const [i, m] of seed.entries()) {
    const values = { ...m, sortOrder: i };
    await db.insert(models).values(values).onConflictDoUpdate({ target: models.slug, set: values });
  }
}

/** Cheapest configured, non-retired model by input + output price (used for titles). */
export async function cheapestModel(db: DbOrTx, registry: ProviderRegistry): Promise<ModelRow | null> {
  const rows = await db
    .select()
    .from(models)
    .where(eq(models.isRetired, false))
    .orderBy(sql`${models.inputUsdPerMtok} + ${models.outputUsdPerMtok}`, asc(models.sortOrder));
  return rows.find((m) => registry.isConfigured(m.provider)) ?? null;
}
