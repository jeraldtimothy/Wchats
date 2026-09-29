import { z } from 'zod';
import { Frontend } from './enums.js';
import { BillingAccountSummary } from './me.js';

export const MAX_GLOBAL_PROMPT_CHARS = 10_000;

export const ProfileResponse = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    email: z.string(),
    memberSince: z.string(),
  }),
  globalSystemPrompt: z.string(),
  generateAiMemories: z.boolean(),
  defaultApp: Frontend,
  allowedFrontends: z.array(Frontend),
  billingAccounts: z.array(BillingAccountSummary),
});
export type ProfileResponse = z.infer<typeof ProfileResponse>;

export const PatchProfileBody = z
  .object({
    globalSystemPrompt: z.string().max(MAX_GLOBAL_PROMPT_CHARS).optional(),
    generateAiMemories: z.boolean().optional(),
    defaultApp: Frontend.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to update');
export type PatchProfileBody = z.infer<typeof PatchProfileBody>;
