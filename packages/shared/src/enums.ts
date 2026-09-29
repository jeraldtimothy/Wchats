import { z } from 'zod';

export const PROVIDERS = ['openai', 'anthropic', 'google'] as const;
export const Provider = z.enum(PROVIDERS);
export type Provider = z.infer<typeof Provider>;

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
};

export const FRONTENDS = ['chat', 'simgen'] as const;
export const Frontend = z.enum(FRONTENDS);
export type Frontend = z.infer<typeof Frontend>;

export const TIERS = ['value', 'standard', 'premium'] as const;
export const Tier = z.enum(TIERS);
export type Tier = z.infer<typeof Tier>;

export const EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
export const Effort = z.enum(EFFORTS);
export type Effort = z.infer<typeof Effort>;

export const MESSAGE_STATUSES = ['pending', 'streaming', 'complete', 'truncated', 'refused', 'error'] as const;
export const MessageStatus = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatus>;

export const LEDGER_KINDS = ['credit_grant', 'usage_charge', 'refund', 'adjustment'] as const;
export const LedgerKind = z.enum(LEDGER_KINDS);
export type LedgerKind = z.infer<typeof LedgerKind>;
