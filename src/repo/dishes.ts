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

/** 絞り込みの条件（U2。BR10.10、BR10.11）。指定していない項目は null／空で、条件にしない */
export interface DishFilter {
  cookTime?: CookTime | null;
  effort?: Effort | null;
  moodTags?: string[];
}

/** 候補・おまかせ・件数の判定に使う条件。除外する食材（BR10.8）と絞り込み（BR10.11） */
export interface MatchOptions {
  /** 除外する食材名。材料名がこの文字列を含む料理を外す（部分一致。正規化しない。BR10.7） */
  excluded?: string[];
  filter?: DishFilter;
}

/** 「30 分以内」は 15 分以内も含める（BR10.11） */
const cookTimeValues = (t: CookTime): CookTime[] =>
  t === 'within30' ? ['within15', 'within30'] : [t];

/**
 * 判定の順序（rules.md 補足）：(1) 削除済みでない → (2) 除外 → (3) 絞り込み。
 * $1 グループ、$2 除外する食材、$3 調理時間（null で条件なし）、$4 手間、$5 気分のタグ
 * - 除外：材料名のどれかが、除外する食材の文字列を含めば外す。材料が 0 行の料理は外さない（BR10.9）。
 *   position() は大文字小文字・全角半角を区別する（読み替えない）。LIKE のように記号の意味を持たない
 * - 絞り込み：指定した項目が空の料理は合わない（BR10.11）。タグは 1 つでも共通すれば合う
 */
const MATCH_WHERE = `
  d.household_id = $1 and d.deleted_at is null
  and not exists (
    select 1 from dish_ingredients i
    where i.dish_id = d.dish_id
      and exists (select 1 from unnest($2::text[]) as x(n) where position(x.n in i.ingredient_name) > 0))
  and ($3::text[] is null or d.cook_time = any($3::text[]))
  and ($4::text is null or d.effort = $4::text)
  and ($5::text[] is null or exists (
    select 1 from jsonb_array_elements_text(d.mood_tags) as t(tag) where t.tag = any($5::text[])))`;

function matchParams(householdId: string, opts: MatchOptions): unknown[] {
  const f = opts.filter ?? {};
  const tags = f.moodTags ?? [];
  return [
    householdId,
    (opts.excluded ?? []).filter((n) => n !== ''),
    f.cookTime ? cookTimeValues(f.cookTime) : null,
    f.effort ?? null,
    tags.length > 0 ? tags : null,
  ];
}

/**
 * 除外と絞り込みを通った料理（削除済みを除く）。「選んだもの」かどうかも一緒に返す。
 * 候補は選んだものを引き（BR4.1）、おまかせは引かない（BR10.16）ため
 */
export async function listMatchingDishes(
  q: Queryable,
  householdId: string,
  opts: MatchOptions = {},
): Promise<{ dishId: string; picked: boolean }[]> {
  const res = await q.query<{ dish_id: string; picked: boolean }>(
    `select d.dish_id,
            exists (select 1 from picked_items p
                    where p.household_id = d.household_id and p.dish_id = d.dish_id) as picked
     from dishes d
     where ${MATCH_WHERE}
     order by d.dish_id`,
    matchParams(householdId, opts),
  );
  return res.rows.map((r) => ({ dishId: r.dish_id, picked: r.picked }));
}

/** 該当件数（BR10.13）：除外と絞り込みの後の数。「選んだもの」と見た料理は引かない */
export async function countMatchingDishes(
  q: Queryable,
  householdId: string,
  opts: MatchOptions = {},
): Promise<number> {
  const res = await q.query<{ n: string | number }>(
    `select count(*) as n from dishes d where ${MATCH_WHERE}`,
    matchParams(householdId, opts),
  );
  return Number(res.rows[0].n);
}

/** 候補の対象：削除済みと「選んだもの」を除いた料理の ID（BR4.1）。条件があれば除外と絞り込みも通す */
export async function listCandidateIds(
  q: Queryable,
  householdId: string,
  opts: MatchOptions = {},
): Promise<string[]> {
  return (await listMatchingDishes(q, householdId, opts))
    .filter((m) => !m.picked)
    .map((m) => m.dishId);
}

/** 気分のタグの選択肢：グループの削除済みでない料理が持つタグを、重複なしで集める（BR10.10） */
export async function listMoodTagOptions(q: Queryable, householdId: string): Promise<string[]> {
  const res = await q.query<{ tag: string }>(
    `select distinct t.tag
     from dishes d, jsonb_array_elements_text(d.mood_tags) as t(tag)
     where d.household_id = $1 and d.deleted_at is null
     order by t.tag`,
    [householdId],
  );
  return res.rows.map((r) => r.tag);
}

/** 削除済みでない料理の件数（候補が 0 件か、見終えたかの区別に使う。BR4.4） */
export async function countLiveDishes(q: Queryable, householdId: string): Promise<number> {
  const res = await q.query<{ n: string | number }>(
    'select count(*) as n from dishes where household_id = $1 and deleted_at is null',
    [householdId],
  );
  return Number(res.rows[0].n);
}
