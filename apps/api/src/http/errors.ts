import type { ErrorCode } from '@wchats/shared';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have access to this page.') =>
  new HttpError(403, 'forbidden', message);
