import { buildApp } from './app.js';
import { InMemoryChatEventHub } from './chat/hub.js';
import { recoverOrphans } from './chat/runner.js';
import { db, pool } from './db/client.js';
import { env } from './env.js';
import { startJobs } from './jobs/boss.js';
import { createProvidersFromEnv } from './providers/index.js';

const providers = createProvidersFromEnv();
const hub = new InMemoryChatEventHub();
const log = {
  error: (obj: unknown, msg?: string) => console.error(msg ?? 'error', obj),
};

const orphans = await recoverOrphans(db);
const { boss, titles } = await startJobs(env.DATABASE_URL, { db, hub, providers, markup: env.MARKUP }, log);
const app = await buildApp({ logger: true, providers, hub, titles });

if (orphans > 0) app.log.warn(`Marked ${orphans} interrupted repl${orphans === 1 ? 'y' : 'ies'} as failed.`);
const configured = providers.configured();
app.log.info(`LLM providers configured: ${configured.length ? configured.join(', ') : 'none (set API keys in .env)'}`);

await app.listen({ port: env.PORT, host: '127.0.0.1' });

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await app.close();
      await boss.stop({ graceful: true, timeout: 10_000 });
      await pool.end();
      process.exit(0);
    })();
  });
}
