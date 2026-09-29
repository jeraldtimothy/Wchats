import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { env } from '../src/env.js';

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/** Signs up a fresh user through Better Auth and returns its session cookie. */
export async function signUp(app: FastifyInstance, name = 'Test User'): Promise<TestUser> {
  const email = `u-${randomUUID().slice(0, 8)}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json', origin: env.WEB_ORIGIN },
    payload: { email, name, password: 'correct-horse-battery' },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const cookie = cookieHeader(res.headers['set-cookie']);
  return { id: (res.json() as { user: { id: string } }).user.id, email, cookie };
}

export function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}
