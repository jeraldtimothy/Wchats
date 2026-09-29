/** Machine-readable error codes returned as `{ error: { code, message } }`. */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'account_disabled',
  'not_found',
  'validation',
  'insufficient_credit',
  'billing_account_disabled',
  'model_retired',
  'model_unavailable',
  'busy',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}
