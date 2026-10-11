import type { Queryable } from '@/db/types';

export interface AccountRow {
  accountId: string;
  email: string;
  passwordDigest: string;
  displayName: string | null;
}

interface RawAccount {
  account_id: string;
  email: string;
  password_digest: string;
  display_name: string | null;
}

const COLUMNS = 'account_id, email, password_digest, display_name';

const toAccount = (r: RawAccount): AccountRow => ({
  accountId: r.account_id,
  email: r.email,
  passwordDigest: r.password_digest,
  displayName: r.display_name,
});

/** 作れたら Account、メールアドレスが重複していたら null（BR1.2。同時でも 1 件） */
export async function insertAccount(
  q: Queryable,
  a: { accountId: string; email: string; passwordDigest: string; displayName?: string | null },
): Promise<AccountRow | null> {
  const res = await q.query<RawAccount>(
    `insert into accounts (account_id, email, password_digest, display_name) values ($1, $2, $3, $4)
     on conflict do nothing returning ${COLUMNS}`,
    [a.accountId, a.email, a.passwordDigest, a.displayName ?? null],
  );
  return res.rows[0] ? toAccount(res.rows[0]) : null;
}

export async function findAccountByEmail(q: Queryable, email: string): Promise<AccountRow | null> {
  const res = await q.query<RawAccount>(
    `select ${COLUMNS} from accounts where lower(email) = lower($1) and deleted_at is null`,
    [email],
  );
  return res.rows[0] ? toAccount(res.rows[0]) : null;
}

export async function findAccountById(q: Queryable, accountId: string): Promise<AccountRow | null> {
  const res = await q.query<RawAccount>(
    `select ${COLUMNS} from accounts where account_id = $1 and deleted_at is null`,
    [accountId],
  );
  return res.rows[0] ? toAccount(res.rows[0]) : null;
}

// ---------- ログイン失敗の制限（U7。BR50.5〜BR50.8） ----------
/** 続けて失敗できる回数と、ロックの長さ */
export const MAX_LOGIN_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

/** ロックの期限が過ぎていたら、失敗の回数を 0 から数え直す（BR50.7） */
export async function clearExpiredLoginLock(q: Queryable, accountId: string, now: Date) {
  await q.query(
    `update accounts set failed_login_count = 0, locked_until = null
     where account_id = $1 and locked_until is not null and locked_until <= $2`,
    [accountId, now],
  );
}

/** ロック中ならロック解除の時刻、そうでなければ null */
export async function getLoginLockedUntil(
  q: Queryable,
  accountId: string,
  now: Date,
): Promise<Date | null> {
  const res = await q.query<{ locked_until: Date | null }>(
    'select locked_until from accounts where account_id = $1 and locked_until > $2',
    [accountId, now],
  );
  return res.rows[0]?.locked_until ?? null;
}

/** 失敗を 1 つ数える。1 つの文で増やすので、同時に来ても数え落とさない。5 回に達したらロックする（BR50.5） */
export async function recordLoginFailure(q: Queryable, accountId: string, now: Date) {
  await q.query(
    `update accounts set
       failed_login_count = failed_login_count + 1,
       locked_until = case when failed_login_count + 1 >= $2
         then $3::timestamptz + ($4 * interval '1 millisecond') else locked_until end
     where account_id = $1 and deleted_at is null`,
    [accountId, MAX_LOGIN_FAILURES, now, LOCK_MS],
  );
}

/** ログインに成功したら数え直す（BR50.7） */
export async function clearLoginFailures(q: Queryable, accountId: string) {
  await q.query(
    `update accounts set failed_login_count = 0, locked_until = null
     where account_id = $1 and (failed_login_count <> 0 or locked_until is not null)`,
    [accountId],
  );
}
