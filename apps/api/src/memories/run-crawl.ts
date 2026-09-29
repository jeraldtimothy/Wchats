/**
 * `pnpm memories:run [--user <id>]`: runs the nightly AI-memory pass now.
 */
import { pool, db } from '../db/client.js';
import { env } from '../env.js';
import { createProvidersFromEnv } from '../providers/index.js';
import { crawlMemories } from './crawl.js';

const i = process.argv.indexOf('--user');
const userId = i >= 0 ? process.argv[i + 1] : undefined;

try {
  const result = await crawlMemories(
    { db, providers: createProvidersFromEnv(), markup: env.MARKUP, log: { error: (e, m) => console.error(m ?? 'error', e) } },
    { userId },
  );
  console.log(`Crawled ${result.sessions} session(s) for ${result.users} user(s); added ${result.items} memory item(s).`);
} finally {
  await pool.end();
}
