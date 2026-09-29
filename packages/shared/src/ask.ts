import { z } from 'zod';
import { MessageDto, SessionSummary } from './chat.js';
import { Effort, MessageStatus, Provider } from './enums.js';

export const AskBody = z.object({
  modelId: z.uuid(),
  billingAccountId: z.uuid(),
  text: z.string().trim().min(1, 'Type a question first.').max(200_000),
  effort: Effort.optional(),
  webSearch: z.boolean().optional(),
});
export type AskBody = z.infer<typeof AskBody>;

export const AskResponse = z.object({
  session: SessionSummary,
  userMessage: MessageDto,
  assistantMessage: MessageDto,
});
export type AskResponse = z.infer<typeof AskResponse>;

export const AskHistoryItem = z.object({
  id: z.string(),
  question: z.string(),
  modelName: z.string(),
  provider: Provider,
  status: MessageStatus.nullable(),
  createdAt: z.string(),
});
export type AskHistoryItem = z.infer<typeof AskHistoryItem>;
