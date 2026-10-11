import type { Queryable } from '@/db/types';

/** 再設定のリンクを探す（変換値だけで探す。BR50.3）。使えるかどうかの判定は呼び出し側 */
export async function findResetByDigest(
  q: Queryable,
  tokenDigest: string,
  now: Date,
): Promise<{ resetId: string; accountId: string } | null> {
  const res = await q.query<{ reset_id: string; account_id: string }>(
    `select r.reset_id, r.account_id from password_resets r
     join accounts a on a.account_id = r.account_id and a.deleted_at is null
     where r.token_digest = $1 and r.used_at is null and r.invalidated_at is null
       and r.expires_at > $2`,
    [tokenDigest, now],
  );
  return res.rows[0] ? { resetId: res.rows[0].reset_id, accountId: res.rows[0].account_id } : null;
}

/** 直近 since 以降に、このアカウントで発行した本数（BR50.2） */
export async function countResetsSince(
  q: Queryable,
  accountId: string,
  since: Date,
): Promise<number> {
  const res = await q.query<{ n: number | string }>(
    'select count(*) as n from password_resets where account_id = $1 and issued_at > $2',
    [accountId, since],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** 未使用で有効なリンクをすべて無効にする（同時に有効なのは 1 本。BR50.3） */
export async function invalidateActiveResets(q: Queryable, accountId: string, now: Date) {
  await q.query(
    `update password_resets set invalidated_at = $2
     where account_id = $1 and used_at is null and invalidated_at is null`,
    [accountId, now],
  );
}

export async function insertReset(
  q: Queryable,
  r: { resetId: string; accountId: string; tokenDigest: string; issuedAt: Date; expiresAt: Date },
): Promise<void> {
  await q.query(
    `insert into password_resets (reset_id, account_id, token_digest, issued_at, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [r.resetId, r.accountId, r.tokenDigest, r.issuedAt, r.expiresAt],
  );
}

/**
 * 使用済みにする。有効なものだけが対象で、同時に 2 回確定しても成功は 1 回（BR50.4）。
 * 成功したらそのアカウントの ID、できなかったら null
 */
export async function consumeReset(
  q: Queryable,
  tokenDigest: string,
  now: Date,
): Promise<string | null> {
  const res = await q.query<{ account_id: string }>(
    `update password_resets set used_at = $2
     where token_digest = $1 and used_at is null and invalidated_at is null and expires_at > $2
     returning account_id`,
    [tokenDigest, now],
  );
  return res.rows[0]?.account_id ?? null;
}

/** 再設定の確定：新しいパスワードの変換値にして、ロックを解く（BR50.4） */
export async function setPasswordAndUnlock(q: Queryable, accountId: string, digest: string) {
  await q.query(
    `update accounts set password_digest = $2, failed_login_count = 0, locked_until = null
     where account_id = $1 and deleted_at is null`,
    [accountId, digest],
  );
}

/** アカウント削除のとき、再設定のリンクをすべて消す（BR50.20） */
export async function deleteResetsOfAccount(q: Queryable, accountId: string) {
  await q.query('delete from password_resets where account_id = $1', [accountId]);
}

/** そのアカウントのすべてのログイン状態を終わらせる（BR50.4、BR50.20） */
export async function deleteSessionsOfAccount(q: Queryable, accountId: string) {
  await q.query('delete from login_sessions where account_id = $1', [accountId]);
}

// ---------- 開発用の送信箱（BR50.25） ----------
export interface OutboxMail {
  to: string;
  subject: string;
  body: string;
}

export async function insertOutboxMail(
  q: Queryable,
  m: { outboxId: string; accountId: string; createdAt: Date; expiresAt: Date } & OutboxMail,
): Promise<void> {
  await q.query(
    `insert into dev_mail_outbox (outbox_id, account_id, to_address, subject, body, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [m.outboxId, m.accountId, m.to, m.subject, m.body, m.createdAt, m.expiresAt],
  );
}

/** 宛先ごとの最新の 1 通。有効期限（60 分）を過ぎたものは見えない（BR50.25） */
export async function findLatestOutboxMail(
  q: Queryable,
  to: string,
  now: Date,
): Promise<OutboxMail | null> {
  const res = await q.query<{ to_address: string; subject: string; body: string }>(
    `select to_address, subject, body from dev_mail_outbox
     where lower(to_address) = lower($1) and expires_at > $2
     order by created_at desc limit 1`,
    [to, now],
  );
  const r = res.rows[0];
  return r ? { to: r.to_address, subject: r.subject, body: r.body } : null;
}

export async function deleteOutboxOfAccount(q: Queryable, accountId: string) {
  await q.query('delete from dev_mail_outbox where account_id = $1', [accountId]);
}

/** 期限を過ぎた送信箱の記録を消す */
export async function purgeExpiredOutbox(q: Queryable, now: Date) {
  await q.query('delete from dev_mail_outbox where expires_at <= $1', [now]);
}
