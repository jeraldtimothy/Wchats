import { PgBoss } from 'pg-boss';
import { cleanupUnsent } from '../attachments/service.js';
import type { TitleQueue } from '../chat/runner.js';
import { generateTitle, type TitleDeps } from '../chat/titles.js';
import { crawlMemories } from '../memories/crawl.js';
import type { Storage } from '../storage/index.js';

export const QUEUES = {
  generateTitle: 'generate-title',
  cleanupUploads: 'cleanup-uploads',
  crawlMemories: 'crawl-memories',
} as const;

/** Durable background jobs. Started by main.ts, not by buildApp (tests don't need it). */
export async function startJobs(
  connectionString: string,
  deps: TitleDeps & { storage: Storage },
  log: { error: (obj: unknown, msg?: string) => void },
): Promise<{ boss: PgBoss; titles: TitleQueue }> {
  const boss = new PgBoss({ connectionString, useListenNotify: true });
  boss.on('error', (err) => log.error(err, 'pg-boss error'));
  await boss.start();
  await boss.createQueue(QUEUES.generateTitle, { retryLimit: 2, retryDelay: 5, notify: true });

  await boss.work<{ sessionId: string }>(QUEUES.generateTitle, async ([job]) => {
    if (job) await generateTitle(deps, job.data.sessionId);
  });

  // Daily: delete uploads that were never sent (older than 24h).
  await boss.createQueue(QUEUES.cleanupUploads, { retryLimit: 1 });
  await boss.schedule(QUEUES.cleanupUploads, '17 3 * * *');
  await boss.work(QUEUES.cleanupUploads, async () => {
    await cleanupUnsent(deps.db, deps.storage);
  });

  // Nightly: propose AI memory items for users who opted in.
  await boss.createQueue(QUEUES.crawlMemories, { retryLimit: 1 });
  await boss.schedule(QUEUES.crawlMemories, '30 2 * * *');
  await boss.work(QUEUES.crawlMemories, async () => {
    await crawlMemories({ db: deps.db, providers: deps.providers, markup: deps.markup, log });
  });

  const titles: TitleQueue = {
    async enqueue(sessionId) {
      await boss.send(QUEUES.generateTitle, { sessionId }, { singletonKey: `title:${sessionId}` });
    },
  };
  return { boss, titles };
}
