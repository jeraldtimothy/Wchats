import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Better Auth (stock schema; field names are what Better Auth expects)
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// App profile (one row per user)
// ---------------------------------------------------------------------------

export const profiles = pgTable('profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  username: text('username').notNull().unique(),
  isManager: boolean('is_manager').notNull().default(false),
  allowedFrontends: text('allowed_frontends')
    .array()
    .notNull()
    .default(sql`'{chat,ask}'::text[]`),
  isDisabled: boolean('is_disabled').notNull().default(false),
  defaultApp: text('default_app').notNull().default('chat'),
  globalSystemPrompt: text('global_system_prompt').notNull().default(''),
  generateAiMemories: boolean('generate_ai_memories').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export const providerEnum = pgEnum('provider', ['openai', 'anthropic', 'google']);
export const tierEnum = pgEnum('model_tier', ['value', 'standard', 'premium']);

export const models = pgTable('models', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  provider: providerEnum('provider').notNull(),
  providerModelId: text('provider_model_id').notNull(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull().default(''),
  tier: tierEnum('tier').notNull(),
  reasoningEfforts: text('reasoning_efforts').array().notNull().default(sql`'{}'::text[]`),
  defaultEffort: text('default_effort'),
  thinkingBudgets: jsonb('thinking_budgets').$type<Record<string, number>>().notNull().default({}),
  maxOutputTokens: integer('max_output_tokens').notNull().default(8192),
  supportsImages: boolean('supports_images').notNull().default(false),
  supportsDocuments: boolean('supports_documents').notNull().default(false),
  supportsMultiTurnTools: boolean('supports_multi_turn_tools').notNull().default(false),
  webSearchEnabled: boolean('web_search_enabled').notNull().default(false),
  inputUsdPerMtok: numeric('input_usd_per_mtok', { precision: 12, scale: 6 }).notNull(),
  cachedInputUsdPerMtok: numeric('cached_input_usd_per_mtok', { precision: 12, scale: 6 }).notNull(),
  outputUsdPerMtok: numeric('output_usd_per_mtok', { precision: 12, scale: 6 }).notNull(),
  webSearchUsdPerCall: numeric('web_search_usd_per_call', { precision: 12, scale: 6 }).notNull().default('0'),
  isRetired: boolean('is_retired').notNull().default(false),
  agentEnabled: boolean('agent_enabled').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const modelFavorites = pgTable(
  'model_favorites',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.modelId] })],
);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const billingAccountKindEnum = pgEnum('billing_account_kind', ['personal', 'shared']);
export const ledgerKindEnum = pgEnum('ledger_kind', ['credit_grant', 'usage_charge', 'refund', 'adjustment']);

export const billingAccounts = pgTable(
  'billing_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: billingAccountKindEnum('kind').notNull(),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    isDisabled: boolean('is_disabled').notNull().default(false),
    /** Cache of SUM(ledger_entries.amount_nano_usd); only ever changed inside a ledger transaction. */
    balanceNanoUsd: bigint('balance_nano_usd', { mode: 'bigint' }).notNull().default(sql`0`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('billing_accounts_personal_owner_uq').on(t.ownerUserId).where(sql`${t.kind} = 'personal'`)],
);

export const billingAccountMembers = pgTable(
  'billing_account_members',
  {
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.billingAccountId, t.userId] }), index('bam_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccounts.id),
    title: text('title'),
    includeMemories: boolean('include_memories').notNull().default(false),
    createdAt: createdAt(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('chat_sessions_user_activity_idx').on(t.userId, t.lastActivityAt)],
);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant']);
export const messageStatusEnum = pgEnum('message_status', [
  'pending',
  'streaming',
  'complete',
  'truncated',
  'refused',
  'error',
]);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    status: messageStatusEnum('status').notNull(),
    content: text('content').notNull().default(''),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    sources: jsonb('sources').$type<{ url: string; title?: string }[]>().notNull().default([]),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    stopReason: text('stop_reason'),
    usage: jsonb('usage').$type<Record<string, number>>(),
    usageRaw: jsonb('usage_raw'),
    pricing: jsonb('pricing').$type<Record<string, string>>(),
    costNanoUsd: bigint('cost_nano_usd', { mode: 'bigint' }),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('messages_session_created_idx').on(t.sessionId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Ledger (append-only)
// ---------------------------------------------------------------------------

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    billingAccountId: uuid('billing_account_id')
      .notNull()
      .references(() => billingAccounts.id),
    kind: ledgerKindEnum('kind').notNull(),
    amountNanoUsd: bigint('amount_nano_usd', { mode: 'bigint' }).notNull(),
    balanceAfterNanoUsd: bigint('balance_after_nano_usd', { mode: 'bigint' }).notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    /** The model behind a usage charge (replies and titles). */
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    reason: text('reason'),
    source: text('source').notNull().default('manual'),
    externalRef: text('external_ref').unique(),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_account_created_idx').on(t.billingAccountId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Attachments (Phase 2)
// ---------------------------------------------------------------------------

export const attachmentKindEnum = pgEnum('attachment_kind', ['image', 'pdf', 'text']);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Null until the upload is sent with a message. */
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    kind: attachmentKindEnum('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    filename: text('filename').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    /** For text/office files: the text sent to the model. */
    extractedText: text('extracted_text'),
    truncated: boolean('truncated').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_message_idx').on(t.messageId), index('attachments_user_created_idx').on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Memory items (Phase 2; AI-generated ones arrive in Phase 4)
// ---------------------------------------------------------------------------

export const memoryTypeEnum = pgEnum('memory_type', ['preference', 'fact', 'reminder', 'other']);

export const memoryItems = pgTable(
  'memory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: memoryTypeEnum('type').notNull(),
    content: text('content').notNull(),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    sourceSessionId: uuid('source_session_id').references(() => chatSessions.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('memory_items_user_idx').on(t.userId, t.createdAt)],
);
