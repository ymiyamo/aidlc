import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { Db, Queryable, QueryResult } from './types';

type PgliteLike = Pick<PGlite, 'query' | 'exec'>;

function wrapPglite(q: PgliteLike): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      const res = await q.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.affectedRows || res.rows.length };
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  };
}

/** 組み込みの PostgreSQL（PGlite）。dataDir を省略するとメモリ上（テスト用） */
export function createPgliteDb(dataDir?: string): Db {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  const base = wrapPglite(pg);
  return {
    query: base.query,
    exec: base.exec,
    async transaction(fn) {
      return pg.transaction(async (t) => fn(wrapPglite(t as unknown as PgliteLike)));
    },
    async close() {
      await pg.close();
    },
  };
}

interface PgClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

function wrapPg(c: PgClientLike): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
      // パラメータなしのときは、複数文も通る簡易プロトコルになる
      const res = params.length > 0 ? await c.query(sql, params) : await c.query(sql);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string) {
      await c.query(sql);
    },
  };
}

/** コンテナ等の PostgreSQL（pg）。DATABASE_URL で接続する */
export function createPgDb(connectionString: string): Db {
  const pool = new Pool({ connectionString, max: 5 });
  const base = wrapPg(pool as unknown as PgClientLike);
  return {
    query: base.query,
    exec: base.exec,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(wrapPg(client as unknown as PgClientLike));
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
