import { z } from 'zod';

export const PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export const Provider = z.enum(PROVIDERS);
export type Provider = z.infer<typeof Provider>;
