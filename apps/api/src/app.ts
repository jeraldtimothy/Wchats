import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { authRoutes } from './auth/bridge.js';
import { db } from './db/client.js';
import { env } from './env.js';
import { HttpError } from './http/errors.js';
import { createProvidersFromEnv, type ProviderRegistry } from './providers/index.js';
import { meRoutes } from './routes/me.js';
import { modelRoutes } from './routes/models.js';

declare module 'fastify' {
  interface FastifyInstance {
    providers: ProviderRegistry;
  }
}

export interface BuildAppOptions {
  logger?: boolean;
  /** Defaults to adapters built from env keys. Tests inject fakes. */
  providers?: ProviderRegistry;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          level: env.LOG_LEVEL,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'req.headers["x-goog-api-key"]',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
        }
      : false,
  });

  app.decorate('providers', options.providers ?? createProvidersFromEnv());

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'validation', message: (error as Error).message } });
    }
    request.log.error(error);
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong.' } });
  });

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(modelRoutes);
  return app;
}
