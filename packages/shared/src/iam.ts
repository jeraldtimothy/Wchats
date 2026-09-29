import { z } from 'zod';
import { Effort, Frontend, LedgerKind, Provider, Tier } from './enums.js';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const IamUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  username: z.string(),
  isManager: z.boolean(),
  isDisabled: z.boolean(),
  allowedFrontends: z.array(Frontend),
  createdAt: z.string(),
  accounts: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['personal', 'shared']) })),
});
export type IamUser = z.infer<typeof IamUser>;

export const IamUsersResponse = z.object({ users: z.array(IamUser), total: z.number().int() });
export type IamUsersResponse = z.infer<typeof IamUsersResponse>;

export const PatchIamUserBody = z
  .object({
    isDisabled: z.boolean().optional(),
    isManager: z.boolean().optional(),
    allowedFrontends: z
      .array(Frontend)
      .refine((l) => new Set(l).size === l.length, 'Duplicate app')
      .optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to update');
export type PatchIamUserBody = z.infer<typeof PatchIamUserBody>;

// ---------------------------------------------------------------------------
// Billing accounts
// ---------------------------------------------------------------------------

export const IamAccount = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['personal', 'shared']),
  isDisabled: z.boolean(),
  balanceCents: z.number().int(),
  /** Exact balance in nano-USD as a decimal string. */
  balanceNanoUsd: z.string(),
  memberCount: z.number().int(),
  ownerUserId: z.string().nullable(),
  createdAt: z.string(),
});
export type IamAccount = z.infer<typeof IamAccount>;

export const IamAccountMember = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  isOwner: z.boolean(),
  addedAt: z.string(),
});
export type IamAccountMember = z.infer<typeof IamAccountMember>;

export const IamAccountDetail = IamAccount.extend({ members: z.array(IamAccountMember) });
export type IamAccountDetail = z.infer<typeof IamAccountDetail>;

export const CreateAccountBody = z.object({ name: z.string().trim().min(1).max(120) });
export type CreateAccountBody = z.infer<typeof CreateAccountBody>;

export const PatchAccountBody = z
  .object({ name: z.string().trim().min(1).max(120).optional(), isDisabled: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.isDisabled !== undefined, 'Nothing to update');
export type PatchAccountBody = z.infer<typeof PatchAccountBody>;

/** USD with up to 2 decimals; adjustments may be negative. */
export const CreditBody = z.object({
  kind: z.enum(['credit_grant', 'adjustment']),
  amountUsd: z.string().trim().regex(/^-?\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 25 or 12.50'),
  reason: z.string().trim().min(1, 'A reason is required.').max(500),
});
export type CreditBody = z.infer<typeof CreditBody>;

export const DateRangeQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const IamLedgerEntry = z.object({
  id: z.string(),
  kind: LedgerKind,
  amountNanoUsd: z.string(),
  balanceAfterNanoUsd: z.string(),
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  modelName: z.string().nullable(),
  createdByName: z.string().nullable(),
  reason: z.string().nullable(),
  source: z.string(),
  createdAt: z.string(),
});
export type IamLedgerEntry = z.infer<typeof IamLedgerEntry>;

export const IamLedgerResponse = z.object({
  entries: z.array(IamLedgerEntry),
  from: z.string(),
  to: z.string(),
  nextCursor: z.string().nullable(),
});
export type IamLedgerResponse = z.infer<typeof IamLedgerResponse>;

export const UsageRow = z.object({
  key: z.string().nullable(),
  label: z.string(),
  requests: z.number().int(),
  costNanoUsd: z.string(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  webSearches: z.number(),
});
export type UsageRow = z.infer<typeof UsageRow>;

export const UsageResponse = z.object({
  groupBy: z.enum(['user', 'model']),
  from: z.string(),
  to: z.string(),
  rows: z.array(UsageRow),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const Price = z.string().trim().regex(/^\d{1,6}(\.\d{1,6})?$/, 'Use a decimal price with up to 6 places');

export const IamModel = z.object({
  id: z.string(),
  slug: z.string(),
  provider: Provider,
  providerConfigured: z.boolean(),
  providerModelId: z.string(),
  displayName: z.string(),
  description: z.string(),
  tier: Tier,
  reasoningEfforts: z.array(Effort),
  defaultEffort: Effort.nullable(),
  thinkingBudgets: z.record(z.string(), z.number()),
  maxOutputTokens: z.number().int(),
  supportsImages: z.boolean(),
  supportsDocuments: z.boolean(),
  supportsMultiTurnTools: z.boolean(),
  webSearchEnabled: z.boolean(),
  inputUsdPerMtok: z.string(),
  cachedInputUsdPerMtok: z.string(),
  outputUsdPerMtok: z.string(),
  webSearchUsdPerCall: z.string(),
  isRetired: z.boolean(),
  agentEnabled: z.boolean(),
  editedAt: z.string().nullable(),
});
export type IamModel = z.infer<typeof IamModel>;

export const PatchIamModelBody = z
  .object({
    providerModelId: z.string().trim().min(1).max(200),
    displayName: z.string().trim().min(1).max(100),
    description: z.string().trim().max(300),
    tier: Tier,
    reasoningEfforts: z.array(Effort).refine((l) => new Set(l).size === l.length, 'Duplicate effort'),
    defaultEffort: Effort.nullable(),
    thinkingBudgets: z.partialRecord(Effort, z.number().int().min(1024).max(200_000)),
    maxOutputTokens: z.number().int().min(256).max(200_000),
    supportsImages: z.boolean(),
    supportsDocuments: z.boolean(),
    supportsMultiTurnTools: z.boolean(),
    webSearchEnabled: z.boolean(),
    inputUsdPerMtok: Price,
    cachedInputUsdPerMtok: Price,
    outputUsdPerMtok: Price,
    webSearchUsdPerCall: Price,
    isRetired: z.boolean(),
    agentEnabled: z.boolean(),
  })
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to update');
export type PatchIamModelBody = z.infer<typeof PatchIamModelBody>;
