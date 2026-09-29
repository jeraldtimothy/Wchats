import type { z } from 'zod';
import { HttpError } from './errors.js';

/** Parses `value` with `schema`, turning failures into a 400 with a readable message. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    throw new HttpError(400, 'validation', message);
  }
  return result.data;
}
