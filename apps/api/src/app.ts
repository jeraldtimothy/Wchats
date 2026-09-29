import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { authRoutes } from './auth/bridge.js';
import { InMemoryChatEventHub, type ChatEventHub } from './chat/hub.js';
import { GenerationRunner, type TitleQueue } from './chat/runner.js';
import { InlineTitleQueue } from './chat/titles.js';
import { db } from './db/client.js';
import { env } from './env.js';
import { HttpError } from './http/errors.js';
import { createProvidersFromEnv, type ProviderRegistry } from './providers/index.js';
import { chatRoutes } from './routes/chat.js';
import { meRoutes } from './routes/me.js';
import { uploadRoutes } from './routes/uploads.js';
import { LocalDiskStorage, type Storage } from './storage/index.js';
import { modelRoutes } from './routes/models.js';

declare module 'fastify' {
  interface FastifyInstance {
    providers: ProviderRegistry;
    chat: { hub: ChatEventHub; runner: GenerationRunner; titles: TitleQueue };
    storage: Storage;
  }
}

export interface BuildAppOptions {
  logger?: boolean;
  /** Defaults to adapters built from env keys. Tests inject fakes. */
  providers?: ProviderRegistry;
  hub?: ChatEventHub;
  /** Defaults to running title jobs in-process. main.ts passes the pg-boss queue. */
  titles?: TitleQueue;
  storage?: Storage;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Open SSE streams must not block shutdown; clients reconnect on their own.
    forceCloseConnections: true,
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

  const providers = options.providers ?? createProvidersFromEnv();
  const hub = options.hub ?? new InMemoryChatEventHub();
  const log = { error: (obj: unknown, msg?: string) => app.log.error(obj, msg) };
  const titles = options.titles ?? new InlineTitleQueue({ db, hub, providers, markup: env.MARKUP }, log);
  const runner = new GenerationRunner({ db, hub, providers, titles, markup: env.MARKUP, log });
  const storage = options.storage ?? new LocalDiskStorage(env.STORAGE_DIR);
  app.decorate('providers', providers);
  app.decorate('storage', storage);
  app.decorate('chat', { hub, runner, titles });
  app.addHook('onClose', async () => {
    await runner.idle();
  });

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
  await app.register(chatRoutes);
  await app.register(uploadRoutes);
  return app;
}
