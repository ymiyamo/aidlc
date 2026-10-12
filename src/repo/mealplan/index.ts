import type { Queryable } from '@/db/types';
import type { Ingredient, IngredientKind } from '@/repo/dishes';

export type DayStatus = 'assigned' | 'skip' | 'empty';
export type PlanOrigin = 'suggested' | 'assigned_by_user';
export type EmptyReason =
  'not_enough_dishes' | 'no_valid_combination' | 'not_proposed' | 'dish_unavailable';

export interface MealPlanRow {
  planId: string;
  householdId: string;
  /** YYYY-MM-DD */
  startDate: string;
  isSaved: boolean;
  name: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  savedAt: Date | null;
}

export interface PlanDayRow {
  planDayId: string;
  planId: string;
  householdId: string;
  /** YYYY-MM-DD */
  date: string;
  dayStatus: DayStatus;
  dishId: string | null;
  origin: PlanOrigin | null;
  emptyReason: EmptyReason | null;
}

/** 日の内容（assigned / skip / empty のどれか 1 つ。DB の検査制約と同じ組み合わせ） */
export type DayContent =
  | { dayStatus: 'assigned'; dishId: string; origin: PlanOrigin }
  | { dayStatus: 'skip' }
  | { dayStatus: 'empty'; emptyReason: EmptyReason };

interface RawPlan {
  plan_id: string;
  household_id: string;
  start_date: string;
  is_saved: boolean;
  name: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  saved_at: Date | null;
}

interface RawDay {
  plan_day_id: string;
  plan_id: string;
  household_id: string;
  date: string;
  day_status: DayStatus;
  dish_id: string | null;
  origin: PlanOrigin | null;
  empty_reason: EmptyReason | null;
}

// date 型は文字列で受け取る（ドライバによる時差のずれを避ける）
const PLAN_COLUMNS = `plan_id, household_id, to_char(start_date, 'YYYY-MM-DD') as start_date, is_saved,
  name, created_by, created_at, updated_at, saved_at`;
const DAY_COLUMNS = `plan_day_id, plan_id, household_id, to_char(date, 'YYYY-MM-DD') as date,
  day_status, dish_id, origin, empty_reason`;

const toPlan = (r: RawPlan): MealPlanRow => ({
  planId: r.plan_id,
  householdId: r.household_id,
  startDate: r.start_date,
  isSaved: r.is_saved,
  name: r.name,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  savedAt: r.saved_at,
});

const toDay = (r: RawDay): PlanDayRow => ({
  planDayId: r.plan_day_id,
  planId: r.plan_id,
  householdId: r.household_id,
  date: r.date,
  dayStatus: r.day_status,
  dishId: r.dish_id,
  origin: r.origin,
  emptyReason: r.empty_reason,
});

const contentParams = (c: DayContent) => [
  c.dayStatus,
  c.dayStatus === 'assigned' ? c.dishId : null,
  c.dayStatus === 'assigned' ? c.origin : null,
  c.dayStatus === 'empty' ? c.emptyReason : null,
];

const dateAtOffset = (startDate: string, offset: number): string | null => {
  const value = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

/** DB 移行前の不整合も含め、献立の 7 日 invariant を境界で fail closed にする。 */
const assertSevenConsecutiveDays = (startDate: string, dates: string[]): void => {
  if (dates.length !== 7) throw new Error('meal plan must contain exactly 7 days');
  const expected = Array.from({ length: 7 }, (_, offset) => dateAtOffset(startDate, offset));
  if (expected.some((date) => date === null) || new Set(dates).size !== 7) {
    throw new Error('meal plan must contain consecutive dates from startDate');
  }
  if (dates.some((date) => !expected.includes(date))) {
    throw new Error('meal plan must contain consecutive dates from startDate');
  }
};

/** すべての問い合わせは householdId を必須にする（BR30.20、ADR-005）。forUpdate は取引の中で行ロックを取る */
export async function getPlan(
  q: Queryable,
  householdId: string,
  planId: string,
  forUpdate = false,
): Promise<MealPlanRow | null> {
  const res = await q.query<RawPlan>(
    `select ${PLAN_COLUMNS} from meal_plans where household_id = $1 and plan_id = $2
     ${forUpdate ? 'for update' : ''}`,
    [householdId, planId],
  );
  return res.rows[0] ? toPlan(res.rows[0]) : null;
}

/** 作業中の献立（保存していないもの）。グループにつき最大 1 件（BR30.15） */
export async function getWorkingPlan(
  q: Queryable,
  householdId: string,
): Promise<MealPlanRow | null> {
  const res = await q.query<RawPlan>(
    `select ${PLAN_COLUMNS} from meal_plans where household_id = $1 and is_saved = false`,
    [householdId],
  );
  return res.rows[0] ? toPlan(res.rows[0]) : null;
}

/** 保存済みの献立。新しく保存した順 */
export async function listSavedPlans(q: Queryable, householdId: string): Promise<MealPlanRow[]> {
  const res = await q.query<RawPlan>(
    `select ${PLAN_COLUMNS} from meal_plans where household_id = $1 and is_saved = true
     order by saved_at desc, plan_id`,
    [householdId],
  );
  return res.rows.map(toPlan);
}

export async function listDays(
  q: Queryable,
  householdId: string,
  planId: string,
): Promise<PlanDayRow[]> {
  const plan = await getPlan(q, householdId, planId);
  if (!plan) return [];
  const res = await q.query<RawDay>(
    `select ${DAY_COLUMNS} from plan_days where household_id = $1 and plan_id = $2 order by date`,
    [householdId, planId],
  );
  const days = res.rows.map(toDay);
  assertSevenConsecutiveDays(
    plan.startDate,
    days.map((day) => day.date),
  );
  return days;
}

/** 作業中の献立を捨てる（日は連鎖して消える。保存済みは消さない。BR30.15）。捨てた件数を返す */
export async function deleteWorkingPlan(q: Queryable, householdId: string): Promise<number> {
  const res = await q.query('delete from meal_plans where household_id = $1 and is_saved = false', [
    householdId,
  ]);
  return res.rowCount;
}

/** 献立 1 件と、その 7 日を作る。取引の中で呼ぶこと */
export async function insertPlan(
  q: Queryable,
  householdId: string,
  p: {
    planId: string;
    startDate: string;
    createdBy: string;
    now: Date;
    days: { planDayId: string; date: string; content: DayContent }[];
  },
): Promise<void> {
  assertSevenConsecutiveDays(
    p.startDate,
    p.days.map((day) => day.date),
  );
  await q.query(
    `insert into meal_plans (plan_id, household_id, start_date, is_saved, created_by, created_at, updated_at)
     values ($1, $2, $3::date, false, $4, $5, $5)`,
    [p.planId, householdId, p.startDate, p.createdBy, p.now],
  );
  for (const d of p.days) {
    await q.query(
      `insert into plan_days (plan_day_id, plan_id, household_id, date, day_status, dish_id, origin, empty_reason)
       values ($1, $2, $3, $4::date, $5, $6, $7, $8)`,
      [d.planDayId, p.planId, householdId, d.date, ...contentParams(d.content)],
    );
  }
}

/**
 * 日の内容を変える。保存済みの献立の日は変えない（BR30.14）ので、作業中の献立でなければ false。
 * 他のグループ・存在しない日も false
 */
export async function updateDay(
  q: Queryable,
  householdId: string,
  planId: string,
  date: string,
  content: DayContent,
): Promise<boolean> {
  const res = await q.query(
    `update plan_days set day_status = $4, dish_id = $5, origin = $6, empty_reason = $7
     where household_id = $1 and plan_id = $2 and date = $3::date
       and exists (select 1 from meal_plans p
                   where p.plan_id = $2 and p.household_id = $1 and p.is_saved = false)`,
    [householdId, planId, date, ...contentParams(content)],
  );
  return res.rowCount === 1;
}

export async function touchPlan(
  q: Queryable,
  householdId: string,
  planId: string,
  now: Date,
): Promise<void> {
  await q.query(
    'update meal_plans set updated_at = $3 where household_id = $1 and plan_id = $2 and is_saved = false',
    [householdId, planId, now],
  );
}

/** 保存する。作業中でなければ（すでに保存済み・他のグループ）false */
export async function markSaved(
  q: Queryable,
  householdId: string,
  planId: string,
  p: { name: string; now: Date },
): Promise<boolean> {
  const res = await q.query(
    `update meal_plans set is_saved = true, name = $3, saved_at = $4, updated_at = $4
     where household_id = $1 and plan_id = $2 and is_saved = false`,
    [householdId, planId, p.name, p.now],
  );
  return res.rowCount === 1;
}

/** グループの献立と日をすべて消す（household.deleted。何度呼んでも同じ。BR30.22） */
export async function deletePlansOfHousehold(q: Queryable, householdId: string): Promise<number> {
  // 日行を先に消すと遅延 7 日制約が一時的な不整合を検出するため、親の cascade に任せる。
  const res = await q.query('delete from meal_plans where household_id = $1', [householdId]);
  return res.rowCount;
}

/** 献立で使う料理の要約（削除済みも含む。DishCatalog.getMany に当たる。BR30.21） */
export interface PlanDishRow {
  dishId: string;
  name: string;
  deleted: boolean;
  ingredientKind: IngredientKind | null;
  ingredients: Ingredient[];
}

export async function getPlanDishes(
  q: Queryable,
  householdId: string,
  dishIds: string[],
): Promise<Map<string, PlanDishRow>> {
  const out = new Map<string, PlanDishRow>();
  if (dishIds.length === 0) return out;
  const res = await q.query<{
    dish_id: string;
    name: string;
    deleted: boolean;
    ingredient_kind: IngredientKind | null;
    ingredients: Ingredient[];
  }>(
    `select d.dish_id, d.name, (d.deleted_at is not null) as deleted, d.ingredient_kind,
            coalesce((
              select json_agg(json_build_object('name', i.ingredient_name, 'amount', i.amount, 'unit', i.unit)
                              order by i.position)
              from dish_ingredients i where i.dish_id = d.dish_id
            ), '[]'::json) as ingredients
     from dishes d
     where d.household_id = $1 and d.dish_id = any($2::uuid[])`,
    [householdId, dishIds],
  );
  for (const r of res.rows) {
    out.set(r.dish_id, {
      dishId: r.dish_id,
      name: r.name,
      deleted: r.deleted,
      ingredientKind: r.ingredient_kind,
      ingredients: r.ingredients,
    });
  }
  return out;
}
