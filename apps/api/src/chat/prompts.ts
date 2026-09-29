export const BASE_SYSTEM_PROMPT = `You are LiteChat, a helpful, accurate assistant.
- Answer clearly and concisely; use Markdown (headings, lists, tables, fenced code blocks with a language) when it helps.
- If you are unsure or lack information, say so instead of guessing.
- When you use web results, cite them.`;

export interface MemoryItem {
  type: string;
  content: string;
}

/**
 * Assembles the system prompt: base prompt, the user's Global System Prompt,
 * memory items (when Include Memories is on), and today's date.
 */
export function buildSystemPrompt(input: {
  globalSystemPrompt?: string | null;
  memories?: MemoryItem[];
  now?: Date;
  timeZone?: string;
}): string {
  const parts = [BASE_SYSTEM_PROMPT];
  const global = input.globalSystemPrompt?.trim();
  if (global) parts.push(`User instructions (apply to every conversation):\n${global}`);
  if (input.memories?.length) {
    parts.push(
      `Things to remember about the user:\n${input.memories.map((m) => `- (${m.type}) ${m.content}`).join('\n')}`,
    );
  }
  const date = (input.now ?? new Date()).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: input.timeZone ?? 'UTC',
  });
  parts.push(`Today's date is ${date}.`);
  return parts.join('\n\n');
}
