import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
/** A Drizzle handle usable both at top level and inside `db.transaction()`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
export const db: Db = drizzle(pool, { schema });

export { schema };
