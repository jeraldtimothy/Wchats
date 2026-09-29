import { describe, expect, it } from 'vitest';
import { safeErrorMessage } from '../../src/providers/util.js';

const withStatus = (message: string, status?: number) => Object.assign(new Error(message), status ? { status } : {});

describe('safeErrorMessage', () => {
  it("maps Google's HTTP 400 invalid-key error to the credentials message", () => {
    const google = withStatus(
      '{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 400,\\n    \\"message\\": \\"API key not valid. Please pass a valid API key.\\",\\n    \\"status\\": \\"INVALID_ARGUMENT\\",\\n    \\"details\\": [{\\"reason\\": \\"API_KEY_INVALID\\"}]\\n  }\\n}\\n","code":400,"status":"Bad Request"}}',
      400,
    );
    expect(safeErrorMessage(google)).toBe('The provider rejected the API credentials.');
    expect(safeErrorMessage(withStatus('Incorrect API key provided: lp_2D0abcdefghijklmnopqrstuvwxyz0123'))).toBe(
      'The provider rejected the API credentials.',
    );
  });

  it('unwraps JSON error bodies into their human message', () => {
    expect(safeErrorMessage(withStatus('400 {"error":{"type":"invalid_request_error","message":"max_tokens is too large"}}', 400))).toBe(
      'max_tokens is too large',
    );
  });

  it('keeps status mappings and redacts anything key-like', () => {
    expect(safeErrorMessage(withStatus('x', 401))).toBe('The provider rejected the API credentials.');
    expect(safeErrorMessage(withStatus('slow down', 429))).toContain('rate limiting');
    expect(safeErrorMessage(withStatus('boom', 503))).toBe('The provider had an internal error (503).');
    expect(safeErrorMessage(withStatus('bad token lp_2D0abcdefghijklmnopqrstuvwxyz0123 here', 400))).toBe('bad token [redacted] here');
  });
});
