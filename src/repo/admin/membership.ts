import type { Queryable } from '@/db/types';

/**
 * グループの行をロックする（参加・退会・有効なメンバー数の判定・グループ削除を 1 件ずつ確定する。BR50.12、BR50.16）。
 * 削除済みのグループや、存在しないグループは false
 */
export async function lockLiveHousehold(q: Queryable, householdId: string): Promise<boolean> {
  const res = await q.query(
    'select household_id from households where household_id = $1 and deleted_at is null for update',
    [householdId],
  );
  return res.rows.length === 1;
}

/** グループの名前（削除済みは見つからない） */
export async function findLiveHouseholdName(
  q: Queryable,
  householdId: string,
): Promise<string | null> {
  const res = await q.query<{ name: string }>(
    'select name from households where household_id = $1 and deleted_at is null',
    [householdId],
  );
  return res.rows[0]?.name ?? null;
}

export async function countActiveMembers(q: Queryable, householdId: string): Promise<number> {
  const res = await q.query<{ n: number | string }>(
    'select count(*) as n from members where household_id = $1 and left_at is null',
    [householdId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/** accountId の有効な Member（グループつき）。ロックの前に、対象のグループを知るために使う */
export async function findActiveMembership(
  q: Queryable,
  accountId: string,
): Promise<{ memberId: string; householdId: string } | null> {
  const res = await q.query<{ member_id: string; household_id: string }>(
    'select member_id, household_id from members where account_id = $1 and left_at is null',
    [accountId],
  );
  const r = res.rows[0];
  return r ? { memberId: r.member_id, householdId: r.household_id } : null;
}

/**
 * 退会にする：leftAt を付け、名前とアカウントとのつながりを消す（BR50.16）。
 * すでに退会済みなら false（冪等）
 */
export async function markMemberLeft(q: Queryable, memberId: string, now: Date): Promise<boolean> {
  const res = await q.query(
    `update members set left_at = $2, display_name = null, account_id = null
     where member_id = $1 and left_at is null`,
    [memberId, now],
  );
  return res.rowCount === 1;
}

/**
 * グループを削除済みにする（BR50.22。暫定）。他のユニットの表が参照しているため行は残し、印を付ける。
 * すでに削除済みなら false（冪等。BR50.24）
 */
export async function markHouseholdDeleted(
  q: Queryable,
  householdId: string,
  now: Date,
): Promise<boolean> {
  const res = await q.query(
    'update households set deleted_at = $2 where household_id = $1 and deleted_at is null',
    [householdId, now],
  );
  return res.rowCount === 1;
}

// ---------- アカウント削除（BR50.19、BR50.20） ----------
export interface DeletionState {
  passwordDigest: string | null;
  deleteFailCount: number;
  deleteLockedUntil: Date | null;
  deleted: boolean;
}

export async function getDeletionState(
  q: Queryable,
  accountId: string,
): Promise<DeletionState | null> {
  const res = await q.query<{
    password_digest: string | null;
    delete_fail_count: number;
    delete_locked_until: Date | null;
    deleted_at: Date | null;
  }>(
    `select password_digest, delete_fail_count, delete_locked_until, deleted_at
     from accounts where account_id = $1`,
    [accountId],
  );
  const r = res.rows[0];
  return r
    ? {
        passwordDigest: r.password_digest,
        deleteFailCount: r.delete_fail_count,
        deleteLockedUntil: r.delete_locked_until,
        deleted: r.deleted_at !== null,
      }
    : null;
}

/** 削除の確認でパスワードをまちがえた。1 つの文で数え、連続 5 回で 15 分の受け付け停止（BR50.19） */
export async function recordDeleteFailure(
  q: Queryable,
  accountId: string,
  now: Date,
  maxFailures: number,
  lockMs: number,
) {
  await q.query(
    `update accounts set
       delete_fail_count = delete_fail_count + 1,
       delete_locked_until = case when delete_fail_count + 1 >= $2
         then $3::timestamptz + ($4 * interval '1 millisecond') else delete_locked_until end
     where account_id = $1`,
    [accountId, maxFailures, now, lockMs],
  );
}

export async function clearDeleteFailures(q: Queryable, accountId: string) {
  await q.query(
    'update accounts set delete_fail_count = 0, delete_locked_until = null where account_id = $1',
    [accountId],
  );
}

/** ロックの期限が過ぎていたら数え直す */
export async function clearExpiredDeleteLock(q: Queryable, accountId: string, now: Date) {
  await q.query(
    `update accounts set delete_fail_count = 0, delete_locked_until = null
     where account_id = $1 and delete_locked_until is not null and delete_locked_until <= $2`,
    [accountId, now],
  );
}

/**
 * アカウントを削除済みにする：メールアドレス・パスワードの変換値・表示名を空にして、印を付ける（行は残す。BR50.20）。
 * すでに削除済みなら false（冪等）
 */
export async function markAccountDeleted(
  q: Queryable,
  accountId: string,
  now: Date,
): Promise<boolean> {
  const res = await q.query(
    `update accounts set email = null, password_digest = null, display_name = null,
       deleted_at = $2, failed_login_count = 0, locked_until = null,
       delete_fail_count = 0, delete_locked_until = null
     where account_id = $1 and deleted_at is null`,
    [accountId, now],
  );
  return res.rowCount === 1;
}
