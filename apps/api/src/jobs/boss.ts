import { PgBoss } from 'pg-boss';
import type { TitleQueue } from '../chat/runner.js';
import { generateTitle, type TitleDeps } from '../chat/titles.js';

export const QUEUES = { generateTitle: 'generate-title' } as const;

/** Durable background jobs. Started by main.ts, not by buildApp (tests don't need it). */
export async function startJobs(
  connectionString: string,
  deps: TitleDeps,
  log: { error: (obj: unknown, msg?: string) => void },
): Promise<{ boss: PgBoss; titles: TitleQueue }> {
  const boss = new PgBoss({ connectionString, useListenNotify: true });
  boss.on('error', (err) => log.error(err, 'pg-boss error'));
  await boss.start();
  await boss.createQueue(QUEUES.generateTitle, { retryLimit: 2, retryDelay: 5, notify: true });

  await boss.work<{ sessionId: string }>(QUEUES.generateTitle, async ([job]) => {
    if (job) await generateTitle(deps, job.data.sessionId);
  });

  const titles: TitleQueue = {
    async enqueue(sessionId) {
      await boss.send(QUEUES.generateTitle, { sessionId }, { singletonKey: `title:${sessionId}` });
    },
  };
  return { boss, titles };
}
