import {
  findUserDishByUrl,
  getDish,
  insertDish,
  listDishes,
  setFavorite,
  softDeleteDish,
  updateDish,
  type Dish,
} from '@/repo/dishes';
import type { AppDeps } from './deps';
import { DomainError, notFound } from './errors';
import { dishSchema, parseOrThrow } from './validation';

/** 業務の呼び出しに渡す、入口で決めたグループ（画面の入力からは決めない。BR2.3） */
export interface HouseholdContext {
  householdId: string;
  memberId: string;
}

/**
 * BR3.1〜BR3.7：料理を保存する。同じ URL があれば、利用者が選ぶまで保存しない。
 * confirmDuplicate が true のときだけ、確認を飛ばして保存する。
 */
export async function createDish(
  deps: AppDeps,
  ctx: HouseholdContext,
  raw: unknown,
  opts: { confirmDuplicate?: boolean } = {},
): Promise<Dish> {
  const input = parseOrThrow(dishSchema, raw);
  if (!opts.confirmDuplicate) {
    const dup = await findUserDishByUrl(deps.db, ctx.householdId, input.url);
    if (dup) {
      throw new DomainError('duplicate_url', 'すでに保存済みです', undefined, {
        existing: { dishId: dup.dishId, name: dup.name },
      });
    }
  }
  const dishId = deps.newId();
  // 料理本体と材料は 1 つの取引で書く（途中で失敗しても半端な状態を残さない）
  return deps.db.transaction(async (tx) => {
    await insertDish(tx, ctx.householdId, {
      ...input,
      dishId,
      createdBy: ctx.memberId,
      now: deps.now(),
    });
    return (await getDish(tx, ctx.householdId, dishId))!;
  });
}

/** BR3.8：グループのメンバーなら誰でも編集できる。他のグループは見つからない（BR2.4） */
export async function editDish(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
  raw: unknown,
): Promise<Dish> {
  const input = parseOrThrow(dishSchema, raw);
  // 行の更新（＝行ロック）→ 材料の入れ直しを 1 つの取引で行う。同時編集は順番に処理される
  const dish = await deps.db.transaction(async (tx) => {
    const ok = await updateDish(tx, ctx.householdId, dishId, { ...input, now: deps.now() });
    return ok ? await getDish(tx, ctx.householdId, dishId) : null;
  });
  if (!dish) throw notFound();
  return dish;
}

export async function removeDish(deps: AppDeps, ctx: HouseholdContext, dishId: string) {
  const ok = await softDeleteDish(deps.db, ctx.householdId, dishId, deps.now());
  if (!ok) throw notFound();
}

/** BR3.10：「付いた状態にする」「外れた状態にする」。繰り返しても結果は同じ */
export async function markFavorite(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
  isFavorite: boolean,
): Promise<Dish> {
  const ok = await setFavorite(deps.db, ctx.householdId, dishId, isFavorite, deps.now());
  if (!ok) throw notFound();
  return (await getDish(deps.db, ctx.householdId, dishId))!;
}

export async function findDish(
  deps: AppDeps,
  ctx: HouseholdContext,
  dishId: string,
): Promise<Dish> {
  const dish = await getDish(deps.db, ctx.householdId, dishId);
  if (!dish) throw notFound();
  return dish;
}

export const listHouseholdDishes = (
  deps: AppDeps,
  ctx: HouseholdContext,
  opts: { favoriteOnly?: boolean } = {},
) => listDishes(deps.db, ctx.householdId, opts);
