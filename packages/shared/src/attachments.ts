import { z } from 'zod';

export const ATTACHMENT_KINDS = ['image', 'pdf', 'text'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Extensions the composer accepts (lowercase, with dot). */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;
export const PDF_EXTENSIONS = ['.pdf'] as const;
export const OFFICE_EXTENSIONS = ['.docx', '.xlsx', '.pptx'] as const;
export const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.csv'] as const;
export const DOCUMENT_EXTENSIONS = [...PDF_EXTENSIONS, ...OFFICE_EXTENSIONS, ...TEXT_EXTENSIONS] as const;

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export const AttachmentDto = z.object({
  id: z.string(),
  kind: z.enum(ATTACHMENT_KINDS),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  /** Text/office files: extraction hit the character limit. */
  truncated: z.boolean(),
});
export type AttachmentDto = z.infer<typeof AttachmentDto>;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}
