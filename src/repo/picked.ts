import type { Queryable } from '@/db/types';
import type { Dish } from './dishes';
import { getDish } from './dishes';

export interface PickedRow {
  pickedId: string;
  dish: Dish;
  memberId: string;
  pickedAt: Date;
}

/** 「選んだもの」に入れる。すでにあれば何もせず成功（BR4.7）。料理が自分のグループの削除済みでないものでなければ false */
export async function pickDish(
  q: Queryable,
  householdId: string,
  p: { pickedId: string; dishId: string; memberId: string; now: Date },
): Promise<boolean> {
  const dish = await getDish(q, householdId, p.dishId);
  if (!dish) return false;
  await q.query(
    `insert into picked_items (picked_id, household_id, dish_id, member_id, picked_at)
     values ($1, $2, $3, $4, $5) on conflict do nothing`,
    [p.pickedId, householdId, p.dishId, p.memberId, p.now],
  );
  return true;
}

/** 削除済みの料理を指すものは除いて返す（BR3.9） */
export async function listPicked(q: Queryable, householdId: string): Promise<PickedRow[]> {
  const res = await q.query<{
    picked_id: string;
    dish_id: string;
    member_id: string;
    picked_at: Date;
  }>(
    `select p.picked_id, p.dish_id, p.member_id, p.picked_at
     from picked_items p join dishes d on d.dish_id = p.dish_id
     where p.household_id = $1 and d.household_id = $1 and d.deleted_at is null
     order by p.picked_at desc, p.picked_id`,
    [householdId],
  );
  const rows: PickedRow[] = [];
  for (const r of res.rows) {
    const dish = await getDish(q, householdId, r.dish_id);
    if (dish)
      rows.push({ pickedId: r.picked_id, dish, memberId: r.member_id, pickedAt: r.picked_at });
  }
  return rows;
}

/** 外す。なくても成功扱い（冪等）だが、戻り値で有無を返す（BR4.11） */
export async function removePicked(
  q: Queryable,
  householdId: string,
  dishId: string,
): Promise<boolean> {
  const res = await q.query('delete from picked_items where household_id = $1 and dish_id = $2', [
    householdId,
    dishId,
  ]);
  return res.rowCount > 0;
}
