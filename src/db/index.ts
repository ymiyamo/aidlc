import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createPgDb, createPgliteDb } from './client';
import { migrate } from './migrate';
import type { Db } from './types';

export type { Db, Queryable, QueryResult } from './types';
export { createPgDb, createPgliteDb } from './client';
export { migrate } from './migrate';

/** DATABASE_URL があれば PostgreSQL、なければ .data/ に保存する組み込み PostgreSQL を使う */
export async function openDbFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Db> {
  let db: Db;
  if (env.DATABASE_URL) {
    db = createPgDb(env.DATABASE_URL);
  } else {
    const dir = path.join(process.cwd(), '.data');
    await mkdir(dir, { recursive: true });
    db = createPgliteDb(path.join(dir, 'pgdata'));
  }
  await migrate(db);
  return db;
}
