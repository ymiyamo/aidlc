import {
  countLiveDishes,
  countMatchingDishes,
  getDish,
  listCandidateIds,
  listMatchingDishes,
  type Dish,
  type DishFilter,
} from '@/repo/dishes';
import { listPicked, pickDish, removePicked, type PickedRow } from '@/repo/picked';
import type { AppDeps } from './deps';
import type { HouseholdContext } from './dish';
import { notFound } from './errors';
import { getTasteExclusion } from './taste/exclusion';

/** 「今日の気分」の絞り込みの条件（U2。調理時間・手間・気分のタグ。BR10.10）。名前は U1 の実装（over30、cookTime）に合わせる */
export type CandidateFilter = DishFilter;

export type NextCandidate =
  | { status: 'card'; dish: Dish; remaining: number }
  | { status: 'empty' } // 保存した料理が 0 件（BR4.4）
  | { status: 'done' } // 見終えた（BR4.5）
  | { status: 'no_match' } // 絞り込みの結果が 0 件（BR10.19）
  | { status: 'all_excluded' }; // 嫌いな食材のせいで、候補がすべて外れた（BR10.20）

/** 料理ごとの最新の感想（U5。契約 C2 の CookLogImpression） */
export type LatestImpression = 'again' | 'never_again' | 'none';
export type ImpressionJudge = (
  deps: AppDeps,
  householdId: string,
  dishIds: string[],
) => Promise<Map<string, LatestImpression>>;

// U5 が差し込む拡張点（BR40.20）。未設定のときは並べ替えをしない（U1 の既定の動き）
let impressionJudge: ImpressionJudge | null = null;
export function setImpressionJudge(judge: ImpressionJudge | null): void {
  impressionJudge = judge;
}

/** 「もう作りたくない」を後ろにする安定な分け方。聞けなかったときは U1 の順番のまま（BR40.20） */
async function preferredPool(deps: AppDeps, householdId: string, ids: string[]): Promise<string[]> {
  if (!impressionJudge) return ids;
  try {
    const latest = await impressionJudge(deps, householdId, ids);
    const front = ids.filter((id) => latest.get(id) !== 'never_again');
    return front.length > 0 ? front : ids;
  } catch (err) {
    deps.logger.error('impression_judge_failed', { error: err });
    return ids;
  }
}

/** 献立用の候補（U4。BR30.2）。front は先に使いたい料理、back は「もう作りたくない」で後ろにずらす料理 */
export interface PlanCandidates {
  front: string[];
  back: string[];
}

/**
 * U4 の献立用の入口（SuggestionJudge.pickCandidates）。削除済みを除き、家族の除外（U2）を通した全部の料理。
 * 「選んだもの」は除かない（includePicked。BR30.2）。U5 の並べ替えは、後ろにずらす料理を back に分けて返す。
 * 除外の一覧が取れなかったときは、失敗をそのまま返す（BR10.25）。感想の判定の失敗は、並べ替えをしないだけにする
 */
export async function listPlanCandidates(
  deps: AppDeps,
  householdId: string,
): Promise<PlanCandidates> {
  const excluded = await excludedIngredients(deps, householdId);
  const ids = await listCandidateIds(deps.db, householdId, { excluded, includePicked: true });
  if (!impressionJudge || ids.length === 0) return { front: ids, back: [] };
  try {
    const latest = await impressionJudge(deps, householdId, ids);
    return {
      front: ids.filter((id) => latest.get(id) !== 'never_again'),
      back: ids.filter((id) => latest.get(id) === 'never_again'),
    };
  } catch (err) {
    deps.logger.error('impression_judge_failed', { error: err });
    return { front: ids, back: [] };
  }
}

/** 調理時間・手間・タグのどれかを指定しているか（BR10.12：何も指定しなければ絞り込みの判定をしない） */
export function isFilterActive(filter?: CandidateFilter): boolean {
  return Boolean(
    filter && (filter.cookTime || filter.effort || (filter.moodTags?.length ?? 0) > 0),
  );
}

/**
 * 除外する食材の一覧を、窓口 TasteExclusion を通して好き嫌い（Taste）に聞く（BR10.25）。
 * 失敗したら握りつぶさず、そのまま上へ返す（除外なしの候補は出さない）。再試行もしない（C2 の決まり）
 */
const excludedIngredients = (deps: AppDeps, householdId: string): Promise<string[]> =>
  getTasteExclusion().listExcludedIngredients(deps, householdId);

/** 対象が 0 件のとき、原因で案内を出し分ける（BR4.4、BR10.19、BR10.20） */
async function noneReason(
  deps: AppDeps,
  householdId: string,
  filter: CandidateFilter | undefined,
): Promise<NextCandidate> {
  if ((await countLiveDishes(deps.db, householdId)) === 0) return { status: 'empty' };
  return isFilterActive(filter) ? { status: 'no_match' } : { status: 'all_excluded' };
}

async function pickNext(
  deps: AppDeps,
  householdId: string,
  seen: string[],
  excluded: string[],
  filter: CandidateFilter | undefined,
): Promise<NextCandidate> {
  const seenSet = new Set(seen);
  // 順序（U2 rules.md 補足）：削除済みを除く → 除外 → 絞り込み → 選んだものと見た料理を引く → ランダム
  const matching = await listMatchingDishes(deps.db, householdId, { excluded, filter });
  if (matching.length === 0) return noneReason(deps, householdId, filter);
  const ids = matching.filter((m) => !m.picked && !seenSet.has(m.dishId)).map((m) => m.dishId);
  if (ids.length === 0) return { status: 'done' };
  const pool = await preferredPool(deps, householdId, ids);
  const index = Math.min(pool.length - 1, Math.floor(deps.random() * pool.length));
  const dish = await getDish(deps.db, householdId, pool[index]);
  // 取得の合間に削除されたときは、もう一度選び直す
  if (!dish) return pickNext(deps, householdId, [...seen, pool[index]], excluded, filter);
  return { status: 'card', dish, remaining: ids.length - 1 };
}

/**
 * BR4.1、BR4.3、BR4.5：削除済みと「選んだもの」と「見た料理」を除いて、ランダムに 1 件。
 * 「見た料理の ID の一覧」は画面が持ち、サーバーは保存しない。
 * 最新の感想が「もう作りたくない」の料理は、他の候補を見終えるまで後ろにずらす（BR40.20）。
 * U2：家族の嫌いな食材を含む料理は外し（BR10.8）、filter があれば絞り込む（BR10.11）。
 * 除外の一覧が取れなかったときは、候補を出さずに失敗を返す（BR10.25）
 */
export async function nextCandidate(
  deps: AppDeps,
  householdId: string,
  seen: string[] = [],
  filter?: CandidateFilter,
): Promise<NextCandidate> {
  const excluded = await excludedIngredients(deps, householdId);
  return pickNext(deps, householdId, seen, excluded, filter);
}

/**
 * BR10.16：「おまかせ」。絞り込み・見た料理・「選んだもの」は使わず、除外だけを適用して 1 件。
 * 対象が 0 件なら、保存が 0 件なら empty、除外で全部外れたなら all_excluded（BR10.20）
 */
export async function randomCandidate(deps: AppDeps, householdId: string): Promise<NextCandidate> {
  const excluded = await excludedIngredients(deps, householdId);
  const matching = await listMatchingDishes(deps.db, householdId, { excluded });
  if (matching.length === 0) return noneReason(deps, householdId, undefined);
  let pool = matching.map((m) => m.dishId);
  // 取得の合間に削除されたときは、もう一度選び直す
  while (pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.floor(deps.random() * pool.length));
    const dish = await getDish(deps.db, householdId, pool[index]);
    if (dish) return { status: 'card', dish, remaining: pool.length - 1 };
    pool = pool.filter((_, i) => i !== index);
  }
  return noneReason(deps, householdId, undefined);
}

/**
 * BR10.13：いまの条件に合う料理の件数。除外と絞り込みの後の数で、「選んだもの」と見た料理は引かない。
 * 除外の一覧が取れなかったときは、失敗を返す（BR10.25）
 */
export async function countMatching(
  deps: AppDeps,
  householdId: string,
  filter?: CandidateFilter,
): Promise<number> {
  const excluded = await excludedIngredients(deps, householdId);
  return countMatchingDishes(deps.db, householdId, { excluded, filter });
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
