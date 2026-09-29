import { z } from 'zod';
import { Effort, Provider, Tier } from './enums.js';

export const ModelSummary = z.object({
  id: z.string(),
  provider: Provider,
  displayName: z.string(),
  description: z.string(),
  tier: Tier,
  reasoningEfforts: z.array(Effort),
  defaultEffort: Effort.nullable(),
  supportsImages: z.boolean(),
  supportsDocuments: z.boolean(),
  supportsMultiTurnTools: z.boolean(),
  webSearchEnabled: z.boolean(),
  isRetired: z.boolean(),
  agentEnabled: z.boolean(),
  isFavorite: z.boolean(),
});
export type ModelSummary = z.infer<typeof ModelSummary>;

export const ModelListResponse = z.object({ models: z.array(ModelSummary) });
export type ModelListResponse = z.infer<typeof ModelListResponse>;
