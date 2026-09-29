import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('responds ok', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
