import { createPgliteDb, migrate, type Db } from '@/db';

/** テストファイルごとの、空のメモリ上 DB（移行を適用済み） */
export async function createTestDb(): Promise<Db> {
  const db = createPgliteDb();
  await migrate(db);
  return db;
}
