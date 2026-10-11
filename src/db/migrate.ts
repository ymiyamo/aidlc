import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './types';

export const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');

/** db/migrations/*.sql を名前順に、まだ適用していないものだけ適用する */
export async function migrate(db: Db, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set(
    (await db.query<{ name: string }>('select name from schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('insert into schema_migrations (name) values ($1)', [file]);
    });
    done.push(file);
  }
  return done;
}
