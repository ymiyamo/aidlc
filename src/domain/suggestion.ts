import { countLiveDishes, getDish, listCandidateIds, type Dish } from '@/repo/dishes';
import { listPicked, pickDish, removePicked, type PickedRow } from '@/repo/picked';
import type { AppDeps } from './deps';
import type { HouseholdContext } from './dish';
import { notFound } from './errors';

export type NextCandidate =
  | { status: 'card'; dish: Dish; remaining: number }
  | { status: 'empty' } // 保存した料理が 0 件（BR4.4）
  | { status: 'done' }; // 見終えた（BR4.5）

/**
 * BR4.1、BR4.3、BR4.5：削除済みと「選んだもの」と「見た料理」を除いて、ランダムに 1 件。
 * 「見た料理の ID の一覧」は画面が持ち、サーバーは保存しない。
 */
export async function nextCandidate(
  deps: AppDeps,
  householdId: string,
  seen: string[] = [],
): Promise<NextCandidate> {
  const seenSet = new Set(seen);
  const ids = (await listCandidateIds(deps.db, householdId)).filter((id) => !seenSet.has(id));
  if (ids.length === 0) {
    return (await countLiveDishes(deps.db, householdId)) === 0
      ? { status: 'empty' }
      : { status: 'done' };
  }
  const index = Math.min(ids.length - 1, Math.floor(deps.random() * ids.length));
  const dish = await getDish(deps.db, householdId, ids[index]);
  // 取得の合間に削除されたときは、もう一度選び直す
  if (!dish) return nextCandidate(deps, householdId, [...seen, ids[index]]);
  return { status: 'card', dish, remaining: ids.length - 1 };
}

/** BR4.6、BR4.7：「これにする」。二重でも 1 件。他のグループ・削除済みは見つからない */
export async function pick(deps: AppDeps, ctx: HouseholdContext, dishId: string): Promise<void> {
  const ok = await pickDish(deps.db, ctx.householdId, {
    pickedId: deps.newId(),
    dishId,
    memberId: ctx.memberId,
    now: deps.now(),
  });
  if (!ok) throw notFound();
}

export const pickedList = (deps: AppDeps, ctx: HouseholdContext): Promise<PickedRow[]> =>
  listPicked(deps.db, ctx.householdId);

/** BR4.11：外す。繰り返しても結果は同じ（なくても成功） */
export async function unpick(deps: AppDeps, ctx: HouseholdContext, dishId: string): Promise<void> {
  await removePicked(deps.db, ctx.householdId, dishId);
}
