import { z } from 'zod';

export const MEMORY_TYPES = ['preference', 'fact', 'reminder', 'other'] as const;
export const MemoryType = z.enum(MEMORY_TYPES);
export type MemoryType = z.infer<typeof MemoryType>;

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  preference: 'Preference',
  fact: 'Fact',
  reminder: 'Reminder',
  other: 'Other',
};

export const MAX_MEMORY_CHARS = 2000;
export const MAX_MEMORY_ITEMS = 200;

export const MemoryItemDto = z.object({
  id: z.string(),
  type: MemoryType,
  content: z.string(),
  aiGenerated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryItemDto = z.infer<typeof MemoryItemDto>;

export const CreateMemoryBody = z.object({
  type: MemoryType,
  content: z.string().trim().min(1, 'Write something to remember.').max(MAX_MEMORY_CHARS),
});
export type CreateMemoryBody = z.infer<typeof CreateMemoryBody>;

export const PatchMemoryBody = CreateMemoryBody.partial().refine(
  (b) => b.type !== undefined || b.content !== undefined,
  'Nothing to update',
);
export type PatchMemoryBody = z.infer<typeof PatchMemoryBody>;
