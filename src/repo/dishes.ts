import type { Queryable } from '@/db/types';

export type CookTime = 'within15' | 'within30' | 'over30';
export type Effort = 'easy' | 'normal' | 'hard';

export interface Ingredient {
  name: string;
  amount: string | null;
  unit: string | null;
}

export interface Dish {
  dishId: string;
  name: string;
  url: string;
  cookTime: CookTime | null;
  effort: Effort | null;
  moodTags: string[];
  ingredients: Ingredient[];
  memo: string | null;
  isFavorite: boolean;
  source: 'user' | 'seed';
  seedKey: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DishInput {
  name: string;
  url: string;
  cookTime: CookTime | null;
  effort: Effort | null;
  moodTags: string[];
  ingredients: Ingredient[];
  memo: string | null;
}

interface RawDish {
  dish_id: string;
  name: string;
  url: string;
  cook_time: CookTime | null;
  effort: Effort | null;
  mood_tags: string[];
  ingredients: Ingredient[];
  memo: string | null;
  is_favorite: boolean;
  source: 'user' | 'seed';
  seed_key: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

// 材料は 1 回の問い合わせで一緒に読む（position 順）
const SELECT_DISH = `
  select d.dish_id, d.name, d.url, d.cook_time, d.effort, d.mood_tags, d.memo, d.is_favorite,
         d.source, d.seed_key, d.created_by, d.created_at, d.updated_at,
         coalesce((
           select json_agg(json_build_object('name', i.ingredient_name, 'amount', i.amount, 'unit', i.unit)
                           order by i.position)
           from dish_ingredients i where i.dish_id = d.dish_id
         ), '[]'::json) as ingredients
  from dishes d`;

const toDish = (r: RawDish): Dish => ({
  dishId: r.dish_id,
  name: r.name,
  url: r.url,
  cookTime: r.cook_time,
  effort: r.effort,
  moodTags: r.mood_tags,
  ingredients: r.ingredients,
  memo: r.memo,
  isFavorite: r.is_favorite,
  source: r.source,
  seedKey: r.seed_key,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** 呼び出し側が取引（deps.db.transaction）の中で呼ぶこと。途中で失敗しても材料が消えたままにならないようにする */
async function replaceIngredients(q: Queryable, dishId: string, items: Ingredient[]) {
  await q.query('delete from dish_ingredients where dish_id = $1', [dishId]);
  for (const [i, ing] of items.entries()) {
    await q.query(
      `insert into dish_ingredients (dish_id, position, ingredient_name, amount, unit)
       values ($1, $2, $3, $4, $5)`,
      [dishId, i, ing.name, ing.amount, ing.unit],
    );
  }
}

/** すべての問い合わせは householdId を必須にする（NFR3.7、ADR-005） */
export async function insertDish(
  q: Queryable,
  householdId: string,
  d: DishInput & { dishId: string; createdBy: string | null; now: Date },
): Promise<void> {
  await q.query(
    `insert into dishes (dish_id, household_id, name, url, cook_time, effort, mood_tags, memo,
                         source, created_by, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'user', $9, $10, $10)`,
    [
      d.dishId,
      householdId,
      d.name,
      d.url,
      d.cookTime,
      d.effort,
      JSON.stringify(d.moodTags),
      d.memo,
      d.createdBy,
      d.now,
    ],
  );
  await replaceIngredients(q, d.dishId, d.ingredients);
}

/** 初期データ 1 件を作る。同じ seedKey があれば（削除済みを含め）作らず false（BR3.12） */
export async function insertSeedDish(
  q: Queryable,
  householdId: string,
  d: DishInput & { dishId: string; seedKey: string; now: Date },
): Promise<boolean> {
  const res = await q.query(
    `insert into dishes (dish_id, household_id, name, url, cook_time, effort, mood_tags, memo,
                         source, seed_key, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'seed', $9, $10, $10)
     on conflict do nothing`,
    [
      d.dishId,
      householdId,
      d.name,
      d.url,
      d.cookTime,
      d.effort,
      JSON.stringify(d.moodTags),
      d.memo,
      d.seedKey,
      d.now,
    ],
  );
  if (res.rowCount !== 1) return false;
  await replaceIngredients(q, d.dishId, d.ingredients);
  return true;
}

export async function getDish(
  q: Queryable,
  householdId: string,
  dishId: string,
): Promise<Dish | null> {
  const res = await q.query<RawDish>(
    `${SELECT_DISH} where d.household_id = $1 and d.dish_id = $2 and d.deleted_at is null`,
    [householdId, dishId],
  );
  return res.rows[0] ? toDish(res.rows[0]) : null;
}

/** 削除済みを除き、新しく保存・更新した順（BR3.15、BR3.11） */
export async function listDishes(
  q: Queryable,
  householdId: string,
  opts: { favoriteOnly?: boolean } = {},
): Promise<Dish[]> {
  const res = await q.query<RawDish>(
    `${SELECT_DISH} where d.household_id = $1 and d.deleted_at is null
       and ($2::boolean is false or d.is_favorite)
     order by d.updated_at desc, d.dish_id`,
    [householdId, opts.favoriteOnly === true],
  );
  return res.rows.map(toDish);
}

/**
 * 更新できたら true。他のグループ・削除済みなら false。
 * 取引の中で呼ぶこと。先に料理の行を更新して行ロックを取ってから、材料を入れ直す（同時編集は直列になる）
 */
export async function updateDish(
  q: Queryable,
  householdId: string,
  dishId: string,
  d: DishInput & { now: Date },
): Promise<boolean> {
  const res = await q.query(
    `update dishes set name = $3, url = $4, cook_time = $5, effort = $6, mood_tags = $7::jsonb,
                       memo = $8, updated_at = $9
     where household_id = $1 and dish_id = $2 and deleted_at is null`,
    [
      householdId,
      dishId,
      d.name,
      d.url,
      d.cookTime,
      d.effort,
      JSON.stringify(d.moodTags),
      d.memo,
      d.now,
    ],
  );
  if (res.rowCount !== 1) return false;
  await replaceIngredients(q, dishId, d.ingredients);
  return true;
}

export async function setFavorite(
  q: Queryable,
  householdId: string,
  dishId: string,
  isFavorite: boolean,
  now: Date,
): Promise<boolean> {
  const res = await q.query(
    `update dishes set is_favorite = $3, updated_at = $4
     where household_id = $1 and dish_id = $2 and deleted_at is null`,
    [householdId, dishId, isFavorite, now],
  );
  return res.rowCount === 1;
}

/** 論理削除（ADR-008）。すでに削除済みでも、他のグループでも false */
export async function softDeleteDish(
  q: Queryable,
  householdId: string,
  dishId: string,
  now: Date,
): Promise<boolean> {
  const res = await q.query(
    `update dishes set deleted_at = $3
     where household_id = $1 and dish_id = $2 and deleted_at is null`,
    [householdId, dishId, now],
  );
  return res.rowCount === 1;
}

/** BR3.7：削除済みでなく、source が user の料理で、URL が完全一致するもの */
export async function findUserDishByUrl(
  q: Queryable,
  householdId: string,
  url: string,
  excludeDishId?: string,
): Promise<{ dishId: string; name: string } | null> {
  const res = await q.query<{ dish_id: string; name: string }>(
    `select dish_id, name from dishes
     where household_id = $1 and url = $2 and source = 'user' and deleted_at is null
       and ($3::uuid is null or dish_id <> $3::uuid)
     order by created_at limit 1`,
    [householdId, url, excludeDishId ?? null],
  );
  return res.rows[0] ? { dishId: res.rows[0].dish_id, name: res.rows[0].name } : null;
}

/** そのグループにある seedKey の一覧（削除済みを含む。BR3.12） */
export async function listSeedKeys(q: Queryable, householdId: string): Promise<string[]> {
  const res = await q.query<{ seed_key: string }>(
    'select seed_key from dishes where household_id = $1 and seed_key is not null',
    [householdId],
  );
  return res.rows.map((r) => r.seed_key);
}

/** 候補の対象：削除済みと「選んだもの」を除いた料理の ID（BR4.1） */
export async function listCandidateIds(q: Queryable, householdId: string): Promise<string[]> {
  const res = await q.query<{ dish_id: string }>(
    `select d.dish_id from dishes d
     where d.household_id = $1 and d.deleted_at is null
       and not exists (select 1 from picked_items p
                       where p.household_id = d.household_id and p.dish_id = d.dish_id)
     order by d.dish_id`,
    [householdId],
  );
  return res.rows.map((r) => r.dish_id);
}

/** 削除済みでない料理の件数（候補が 0 件か、見終えたかの区別に使う。BR4.4） */
export async function countLiveDishes(q: Queryable, householdId: string): Promise<number> {
  const res = await q.query<{ n: string | number }>(
    'select count(*) as n from dishes where household_id = $1 and deleted_at is null',
    [householdId],
  );
  return Number(res.rows[0].n);
}
