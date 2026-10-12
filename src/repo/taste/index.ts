import type { Queryable } from '@/db/types';

export interface DislikeRow {
  dislikeId: string;
  householdId: string;
  memberId: string;
  ingredientName: string;
  registeredAt: Date;
}

interface RawDislike {
  dislike_id: string;
  household_id: string;
  member_id: string;
  ingredient_name: string;
  registered_at: Date;
}

const COLUMNS = 'dislike_id, household_id, member_id, ingredient_name, registered_at';

const toRow = (r: RawDislike): DislikeRow => ({
  dislikeId: r.dislike_id,
  householdId: r.household_id,
  memberId: r.member_id,
  ingredientName: r.ingredient_name,
  registeredAt: r.registered_at,
});

/**
 * そのグループの有効なメンバーの行をロックする（登録の件数の確認と追加を、同じ人については 1 件ずつ行う。BR10.3）。
 * 抜けたメンバー・他のグループのメンバーなら false。取引の中で呼ぶこと
 */
export async function lockActiveMember(
  q: Queryable,
  householdId: string,
  memberId: string,
): Promise<boolean> {
  const res = await q.query(
    `select member_id from members
     where member_id = $1 and household_id = $2 and left_at is null for update`,
    [memberId, householdId],
  );
  return res.rows.length === 1;
}

/** そのメンバーの登録の件数（BR10.3） */
export async function countDislikesOfMember(
  q: Queryable,
  householdId: string,
  memberId: string,
): Promise<number> {
  const res = await q.query<{ n: string | number }>(
    'select count(*) as n from disliked_ingredients where household_id = $1 and member_id = $2',
    [householdId, memberId],
  );
  return Number(res.rows[0].n);
}

/** 同じメンバー・同じ食材名（完全一致）の登録。なければ null（BR10.2） */
export async function findDislikeByName(
  q: Queryable,
  householdId: string,
  memberId: string,
  ingredientName: string,
): Promise<DislikeRow | null> {
  const res = await q.query<RawDislike>(
    `select ${COLUMNS} from disliked_ingredients
     where household_id = $1 and member_id = $2 and ingredient_name = $3`,
    [householdId, memberId, ingredientName],
  );
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

/**
 * 登録する。同じメンバーの同じ食材名がすでにあれば作らず false（BR10.2。一意制約が最後の守り）。
 * すべての問い合わせは householdId を必須にする（ADR-005）
 */
export async function insertDislike(
  q: Queryable,
  householdId: string,
  d: { dislikeId: string; memberId: string; ingredientName: string; now: Date },
): Promise<boolean> {
  const res = await q.query(
    `insert into disliked_ingredients (dislike_id, household_id, member_id, ingredient_name, registered_at)
     values ($1, $2, $3, $4, $5)
     on conflict (member_id, ingredient_name) do nothing`,
    [d.dislikeId, householdId, d.memberId, d.ingredientName, d.now],
  );
  return res.rowCount === 1;
}

/** 自分の登録だけを、登録の古い順に返す（BR10.5） */
export async function listDislikesOfMember(
  q: Queryable,
  householdId: string,
  memberId: string,
): Promise<DislikeRow[]> {
  const res = await q.query<RawDislike>(
    `select ${COLUMNS} from disliked_ingredients
     where household_id = $1 and member_id = $2
     order by registered_at, dislike_id`,
    [householdId, memberId],
  );
  return res.rows.map(toRow);
}

/** 本人の登録を 1 件消す。他の人・他のグループのものや、すでにないものは false（BR10.4） */
export async function deleteDislike(
  q: Queryable,
  householdId: string,
  memberId: string,
  dislikeId: string,
): Promise<boolean> {
  const res = await q.query(
    `delete from disliked_ingredients
     where household_id = $1 and member_id = $2 and dislike_id = $3`,
    [householdId, memberId, dislikeId],
  );
  return res.rowCount > 0;
}

/** メンバーが抜けたとき：そのメンバーの登録をすべて消す。0 件でも成功（BR10.21） */
export async function deleteDislikesOfMember(
  q: Queryable,
  householdId: string,
  memberId: string,
): Promise<number> {
  const res = await q.query(
    'delete from disliked_ingredients where household_id = $1 and member_id = $2',
    [householdId, memberId],
  );
  return res.rowCount;
}

/** グループが削除されたとき：そのグループの登録をすべて消す。他のグループには触れない（BR10.22） */
export async function deleteDislikesOfHousehold(
  q: Queryable,
  householdId: string,
): Promise<number> {
  const res = await q.query('delete from disliked_ingredients where household_id = $1', [
    householdId,
  ]);
  return res.rowCount;
}

/**
 * 除外する食材の一覧：そのグループの、現在のメンバー（退会していない人）の登録だけ。同じ食材名は 1 つにまとめる（BR10.6）。
 * 抜けた人の登録が残っていても使わない。誰の登録かは返さない
 */
export async function listExcludedNames(q: Queryable, householdId: string): Promise<string[]> {
  const res = await q.query<{ ingredient_name: string }>(
    `select distinct x.ingredient_name
     from disliked_ingredients x
     join members m on m.member_id = x.member_id and m.household_id = x.household_id
     where x.household_id = $1 and m.left_at is null
     order by x.ingredient_name`,
    [householdId],
  );
  return res.rows.map((r) => r.ingredient_name);
}
