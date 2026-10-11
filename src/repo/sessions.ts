import type { Queryable } from '@/db/types';

/** sessionHash は Cookie の値の変換値。元の値は保存しない（BR1.5） */
export async function insertSession(
  q: Queryable,
  s: { sessionHash: string; accountId: string; issuedAt: Date; expiresAt: Date },
): Promise<void> {
  await q.query(
    'insert into login_sessions (session_id, account_id, issued_at, expires_at) values ($1, $2, $3, $4)',
    [s.sessionHash, s.accountId, s.issuedAt, s.expiresAt],
  );
}

/** 期限内のログイン状態の持ち主（accountId）。無効なら null */
export async function findValidSessionAccount(
  q: Queryable,
  sessionHash: string,
  now: Date,
): Promise<string | null> {
  const res = await q.query<{ account_id: string }>(
    'select account_id from login_sessions where session_id = $1 and expires_at > $2',
    [sessionHash, now],
  );
  return res.rows[0]?.account_id ?? null;
}

export async function deleteSession(q: Queryable, sessionHash: string): Promise<void> {
  await q.query('delete from login_sessions where session_id = $1', [sessionHash]);
}
