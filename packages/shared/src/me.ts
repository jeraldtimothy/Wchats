import { z } from 'zod';
import { Frontend } from './enums.js';

export const BillingAccountSummary = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['personal', 'shared']),
  isDisabled: z.boolean(),
  /** Display balance in USD cents (floor of the nano-USD ledger balance). */
  balanceCents: z.number().int(),
});
export type BillingAccountSummary = z.infer<typeof BillingAccountSummary>;

export const MeResponse = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    createdAt: z.string(),
  }),
  profile: z.object({
    username: z.string(),
    isManager: z.boolean(),
    allowedFrontends: z.array(Frontend),
    defaultApp: Frontend,
  }),
  billingAccounts: z.array(BillingAccountSummary),
  config: z.object({
    googleAuthEnabled: z.boolean(),
    simgenUrl: z.string(),
  }),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const PublicConfig = z.object({ googleAuthEnabled: z.boolean() });
export type PublicConfig = z.infer<typeof PublicConfig>;
