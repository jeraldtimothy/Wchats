import { z } from 'zod';
import { AttachmentDto } from './attachments.js';
import { Effort, MessageStatus, Provider } from './enums.js';
import { ModelSummary } from './models.js';

export const Source = z.object({ url: z.string(), title: z.string().optional() });
export type Source = z.infer<typeof Source>;

export const SessionSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  modelId: z.string(),
  modelName: z.string(),
  provider: Provider,
  billingAccountId: z.string(),
  isRetired: z.boolean(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const MessageDto = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  status: MessageStatus,
  content: z.string(),
  sources: z.array(Source),
  attachments: z.array(AttachmentDto),
  effort: Effort.nullable(),
  webSearch: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  /** Charge for this reply in nano-USD, as a decimal string (assistant messages). */
  costNanoUsd: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const SessionDetail = z.object({
  session: SessionSummary.extend({
    includeMemories: z.boolean(),
    billingAccountName: z.string(),
    model: ModelSummary,
  }),
  messages: z.array(MessageDto),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

export const CreateSessionBody = z.object({ modelId: z.uuid(), billingAccountId: z.uuid() });
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

export const PatchSessionBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    includeMemories: z.boolean().optional(),
  })
  .refine((b) => b.title !== undefined || b.includeMemories !== undefined, 'Nothing to update');
export type PatchSessionBody = z.infer<typeof PatchSessionBody>;

export const FILES_ONLY_PROMPT = 'Describe what you want to do with the attached files.';

export const PostMessageBody = z.object({
  text: z.string().max(200_000),
  effort: Effort.optional(),
  webSearch: z.boolean().optional(),
  multiTurn: z.boolean().optional(),
  attachmentIds: z.array(z.uuid()).max(20).optional(),
});
export type PostMessageBody = z.infer<typeof PostMessageBody>;

export const PostMessageResponse = z.object({ userMessage: MessageDto, assistantMessage: MessageDto });
export type PostMessageResponse = z.infer<typeof PostMessageResponse>;

// ---------------------------------------------------------------------------
// SSE: GET /api/chat/v2/session/:id/listen
// ---------------------------------------------------------------------------

export interface InflightMessage {
  messageId: string;
  seq: number;
  status: 'pending' | 'streaming';
  content: string;
  thinking: boolean;
  sources: Source[];
}

export type TerminalStatus = Extract<MessageStatus, 'complete' | 'truncated' | 'refused' | 'error'>;

export type ChatStreamEvent =
  | { type: 'snapshot'; inflight: InflightMessage | null }
  | { type: 'message.started'; messageId: string; seq: number }
  | { type: 'text.delta'; messageId: string; seq: number; text: string }
  | { type: 'thinking'; messageId: string; seq: number; active: boolean }
  | { type: 'tool.started'; messageId: string; seq: number; tool: 'web_search'; query?: string }
  | { type: 'tool.sources'; messageId: string; seq: number; sources: Source[] }
  | { type: 'refusal'; messageId: string; seq: number; message?: string }
  | { type: 'error'; messageId: string; seq: number; code: string; message: string }
  | {
      type: 'done';
      messageId: string;
      seq: number;
      status: TerminalStatus;
      costNanoUsd: string | null;
      balanceCents: number | null;
    }
  | { type: 'session.updated'; sessionId: string; title: string | null };

export type ChatStreamEventType = ChatStreamEvent['type'];

/** Inline error texts shown under a failed reply. */
export const CHAT_ERROR_TEXT = {
  refused: 'The provider declined this request. Rephrase it before continuing.',
  truncated: 'The provider stopped before a complete answer was ready',
  insufficientCredit: 'This billing account has no credit left. Ask a manager to add credit, or pick another account.',
} as const;
