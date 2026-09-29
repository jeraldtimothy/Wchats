import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

/** Recreates the test database from scratch and applies all migrations. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/test/.test(name)) throw new Error(`Refusing to reset non-test database "${name}"`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
