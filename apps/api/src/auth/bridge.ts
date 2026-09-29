import type { FastifyInstance } from 'fastify';
import { auth } from './auth.js';

/**
 * Mounts Better Auth on /api/auth/*. The route lives in its own plugin scope
 * so the raw body can be forwarded untouched to Better Auth's fetch handler.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const hasBody = request.method !== 'GET' && typeof request.body === 'string' && request.body.length > 0;
      const response = await auth.handler(
        new Request(url, { method: request.method, headers, body: hasBody ? (request.body as string) : undefined }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
}

