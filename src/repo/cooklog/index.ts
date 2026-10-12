import type { Queryable } from '@/db/types';

export type Impression = 'again' | 'never_again';

export interface CookRecordRow {
  recordId: string;
  householdId: string;
  dishId: string;
  memberId: string;
  /** 日本時間の暦の日（YYYY-MM-DD） */
  cookedOn: string;
  impression: Impression | null;
  cautionMemo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawRecord {
  record_id: string;
  household_id: string;
  dish_id: string;
  member_id: string;
  cooked_on: string;
  impression: Impression | null;
  caution_memo: string | null;
  created_at: Date;
  updated_at: Date;
}

// date 型は Date に変換されて時差でずれるため、文字列のまま受け取る
const COLUMNS = `record_id, household_id, dish_id, member_id,
  to_char(cooked_on, 'YYYY-MM-DD') as cooked_on, impression, caution_memo, created_at, updated_at`;

const toRow = (r: RawRecord): CookRecordRow => ({
  recordId: r.record_id,
  householdId: r.household_id,
  dishId: r.dish_id,
  memberId: r.member_id,
  cookedOn: r.cooked_on,
  impression: r.impression,
  cautionMemo: r.caution_memo,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** 一意制約（同じグループ・料理・日）に当たった失敗か */
const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

/**
 * 記録を作る。同じ料理の同じ日がすでにあれば作らず、その recordId を返す（BR40.4）。
 * すべての問い合わせは householdId を必須にする（ADR-005）
 */
export async function insertRecord(
  q: Queryable,
  householdId: string,
  r: {
    recordId: string;
    dishId: string;
    memberId: string;
    cookedOn: string;
    impression: Impression | null;
    cautionMemo: string | null;
    now: Date;
  },
): Promise<{ created: true } | { created: false; existingRecordId: string }> {
  const res = await q.query(
    `insert into cook_records (record_id, household_id, dish_id, member_id, cooked_on,
                               impression, caution_memo, created_at, updated_at)
     values ($1, $2, $3, $4, $5::date, $6, $7, $8, $8)
     on conflict (household_id, dish_id, cooked_on) do nothing`,
    [r.recordId, householdId, r.dishId, r.memberId, r.cookedOn, r.impression, r.cautionMemo, r.now],
  );
  if (res.rowCount === 1) return { created: true };
  const existing = await findRecordByDishDay(q, householdId, r.dishId, r.cookedOn);
  // 確認の合間に既存の記録が消されたときは、もう一度作る（取り直しは 1 回だけ）
  if (!existing) {
    const retry = await q.query(
      `insert into cook_records (record_id, household_id, dish_id, member_id, cooked_on,
                                 impression, caution_memo, created_at, updated_at)
       values ($1, $2, $3, $4, $5::date, $6, $7, $8, $8)
       on conflict (household_id, dish_id, cooked_on) do nothing`,
      [
        r.recordId,
        householdId,
        r.dishId,
        r.memberId,
        r.cookedOn,
        r.impression,
        r.cautionMemo,
        r.now,
      ],
    );
    if (retry.rowCount === 1) return { created: true };
    const again = await findRecordByDishDay(q, householdId, r.dishId, r.cookedOn);
    if (again) return { created: false, existingRecordId: again.recordId };
    throw new Error('cook_record_insert_failed');
  }
  return { created: false, existingRecordId: existing.recordId };
}

export async function getRecord(
  q: Queryable,
  householdId: string,
  recordId: string,
): Promise<CookRecordRow | null> {
  const res = await q.query<RawRecord>(
    `select ${COLUMNS} from cook_records where household_id = $1 and record_id = $2`,
    [householdId, recordId],
  );
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

export async function findRecordByDishDay(
  q: Queryable,
  householdId: string,
  dishId: string,
  cookedOn: string,
): Promise<CookRecordRow | null> {
  const res = await q.query<RawRecord>(
    `select ${COLUMNS} from cook_records
     where household_id = $1 and dish_id = $2 and cooked_on = $3::date`,
    [householdId, dishId, cookedOn],
  );
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

/**
 * 日付・感想・メモだけを置き換える（BR40.8）。dishId・memberId・createdAt は変えない。
 * 他のグループの記録は 'not_found'。日付を変えて同じ料理の別の記録とぶつかるときは 'duplicate'
 */
export async function updateRecord(
  q: Queryable,
  householdId: string,
  recordId: string,
  v: { cookedOn: string; impression: Impression | null; cautionMemo: string | null; now: Date },
): Promise<'updated' | 'not_found' | 'duplicate'> {
  try {
    const res = await q.query(
      `update cook_records set cooked_on = $3::date, impression = $4, caution_memo = $5, updated_at = $6
       where household_id = $1 and record_id = $2`,
      [householdId, recordId, v.cookedOn, v.impression, v.cautionMemo, v.now],
    );
    return res.rowCount === 1 ? 'updated' : 'not_found';
  } catch (err) {
    if (isUniqueViolation(err)) return 'duplicate';
    throw err;
  }
}

/** 物理削除。他のグループの記録・すでに無い記録は false（BR40.9） */
export async function deleteRecord(
  q: Queryable,
  householdId: string,
  recordId: string,
): Promise<boolean> {
  const res = await q.query('delete from cook_records where household_id = $1 and record_id = $2', [
    householdId,
    recordId,
  ]);
  return res.rowCount === 1;
}

/** 日付の範囲（両端を含む）の記録。作った日の新しい順、同じ日は作成の新しい順（BR40.13） */
export async function listRecordsBetween(
  q: Queryable,
  householdId: string,
  from: string,
  to: string,
): Promise<CookRecordRow[]> {
  const res = await q.query<RawRecord>(
    `select ${COLUMNS} from cook_records
     where household_id = $1 and cooked_on between $2::date and $3::date
     order by cooked_on desc, created_at desc, record_id`,
    [householdId, from, to],
  );
  return res.rows.map(toRow);
}

/** その料理の記録。作った日の新しい順（BR40.7） */
export async function listRecordsByDish(
  q: Queryable,
  householdId: string,
  dishId: string,
): Promise<CookRecordRow[]> {
  const res = await q.query<RawRecord>(
    `select ${COLUMNS} from cook_records
     where household_id = $1 and dish_id = $2
     order by cooked_on desc, created_at desc, record_id`,
    [householdId, dishId],
  );
  return res.rows.map(toRow);
}

/**
 * 料理ごとの、作った日が最も新しい記録 1 件の感想（BR40.19）。
 * 記録のない料理は結果に含めない（呼び出し側が none として扱う）
 */
export async function latestImpressionRows(
  q: Queryable,
  householdId: string,
  dishIds: string[],
): Promise<Map<string, Impression | null>> {
  const out = new Map<string, Impression | null>();
  if (dishIds.length === 0) return out;
  const res = await q.query<{ dish_id: string; impression: Impression | null }>(
    `select distinct on (dish_id) dish_id, impression from cook_records
     where household_id = $1 and dish_id = any($2::uuid[])
     order by dish_id, cooked_on desc`,
    [householdId, dishIds],
  );
  for (const r of res.rows) out.set(r.dish_id, r.impression);
  return out;
}

/** 記録の表示に使う料理名（削除済みも含める。BR40.11）。他のグループの料理は含めない */
export async function getDishNames(
  q: Queryable,
  householdId: string,
  dishIds: string[],
): Promise<Map<string, { name: string; deleted: boolean }>> {
  const out = new Map<string, { name: string; deleted: boolean }>();
  if (dishIds.length === 0) return out;
  const res = await q.query<{ dish_id: string; name: string; deleted_at: Date | null }>(
    `select dish_id, name, deleted_at from dishes
     where household_id = $1 and dish_id = any($2::uuid[])`,
    [householdId, dishIds],
  );
  for (const r of res.rows) out.set(r.dish_id, { name: r.name, deleted: r.deleted_at !== null });
  return out;
}

/** 記録した人の表示名の元（退会後も行は残る。BR40.23）。他のグループのメンバーは含めない */
export async function getMemberLabels(
  q: Queryable,
  householdId: string,
  memberIds: string[],
): Promise<Map<string, { displayName: string | null; leftAt: Date | null }>> {
  const out = new Map<string, { displayName: string | null; leftAt: Date | null }>();
  if (memberIds.length === 0) return out;
  const res = await q.query<{
    member_id: string;
    display_name: string | null;
    left_at: Date | null;
  }>(
    `select member_id, display_name, left_at from members
     where household_id = $1 and member_id = any($2::uuid[])`,
    [householdId, memberIds],
  );
  for (const r of res.rows)
    out.set(r.member_id, { displayName: r.display_name, leftAt: r.left_at });
  return out;
}

/** グループの記録をすべて消す（household.deleted。何度呼んでも同じ。BR40.21） */
export async function deleteRecordsOfHousehold(q: Queryable, householdId: string): Promise<number> {
  const res = await q.query('delete from cook_records where household_id = $1', [householdId]);
  return res.rowCount;
}
