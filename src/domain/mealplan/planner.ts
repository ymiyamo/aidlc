import type { IngredientKind } from '@/repo/dishes';

/**
 * 献立の組み合わせを決める純粋な計算（BR30.3〜BR30.9、BR30.12、BR30.17）。
 * DB も時刻も知らない。乱数は呼び出し側から渡す（同じ乱数列なら同じ結果になる。BR30.5）
 */

/** 提案に使える料理 1 つ。kind が null の料理は「種類なし」で、3 日続きの判定の対象外（BR30.4） */
export interface PlanCandidate {
  dishId: string;
  kind: IngredientKind | null;
}

/** 日の枠：skip は作らない日（BR30.10）。free はこれから埋める日 */
export type Slot = 'skip' | 'free';

export type EmptyWhy = 'not_enough_dishes' | 'no_valid_combination';

export type ProposedDay =
  | { status: 'skip' }
  | { status: 'assigned'; dishId: string }
  | { status: 'empty'; reason: EmptyWhy };

/** 探索の上限（BR30.7）。上限に達したら、決まっていない日を空欄にして返す */
export const MAX_SEARCH_STEPS = 20000;
/** 同じ料理は、手割り当てでも 1 週間に 2 回まで（BR30.3） */
export const MAX_SAME_DISH = 2;

/** フィッシャー–イェーツの並べ替え。元の配列は変えない */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 連続する 3 日がすべて同じ種類の並びが index の日を含んでいるか（null は途切れ。BR30.4） */
export function kindStreakAt(kinds: readonly (IngredientKind | null)[], index: number): boolean {
  for (let start = index - 2; start <= index; start++) {
    if (start < 0 || start + 2 >= kinds.length) continue;
    const k = kinds[start];
    if (k !== null && kinds[start + 1] === k && kinds[start + 2] === k) return true;
  }
  return false;
}

/** 献立全体に、同じ種類が 3 日続く並びがあるか */
export function hasKindStreak(kinds: readonly (IngredientKind | null)[]): boolean {
  return kinds.some((_, i) => kindStreakAt(kinds, i));
}

/**
 * BR30.5：制約（同じ料理は 1 回まで、同じ種類が 3 日続かない）を満たす組み合わせを探す。
 * 日付順に当てはめ、行き詰まったら前の日に戻る。front の料理を先に、back（後ろにずらす料理）をあとに試す。
 * 空欄の数が最も少ない結果を返す。全部埋められるなら必ず埋める（完全性。P3）。
 * 探索が上限に達したら、それまでで最良の結果を返す（BR30.7）
 */
export function proposeWeek(input: {
  slots: Slot[];
  front: PlanCandidate[];
  back?: PlanCandidate[];
  random: () => number;
  maxSteps?: number;
}): ProposedDay[] {
  const { slots, random } = input;
  const maxSteps = input.maxSteps ?? MAX_SEARCH_STEPS;
  const pool = [...shuffle(input.front, random), ...shuffle(input.back ?? [], random)];
  const n = slots.length;
  // 残りの日のうち、埋める対象の日数（枝刈りに使う）
  const freeFrom: number[] = new Array(n + 1).fill(0);
  for (let d = n - 1; d >= 0; d--) freeFrom[d] = freeFrom[d + 1] + (slots[d] === 'free' ? 1 : 0);
  const freeCount = freeFrom[0];
  const upper = Math.min(freeCount, pool.length);

  const chosen: (number | null)[] = new Array(n).fill(null);
  const kinds: (IngredientKind | null)[] = new Array(n).fill(null);
  const used: boolean[] = new Array(pool.length).fill(false);
  let best: (number | null)[] = [...chosen];
  let bestFilled = -1;
  let steps = 0;
  let stop = false;

  const dfs = (day: number, filled: number, unused: number): void => {
    if (stop) return;
    if (day === n) {
      if (filled > bestFilled) {
        bestFilled = filled;
        best = [...chosen];
        if (filled >= upper) stop = true;
      }
      return;
    }
    // これ以上埋めても、いまの最良を超えられない枝は探さない
    if (filled + Math.min(freeFrom[day], unused) <= bestFilled) return;
    if (++steps > maxSteps) {
      stop = true;
      return;
    }
    if (slots[day] === 'skip') {
      dfs(day + 1, filled, unused);
      return;
    }
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const kind = pool[i].kind;
      if (kind !== null && day >= 2 && kinds[day - 1] === kind && kinds[day - 2] === kind) continue;
      used[i] = true;
      chosen[day] = i;
      kinds[day] = kind;
      dfs(day + 1, filled + 1, unused - 1);
      used[i] = false;
      chosen[day] = null;
      kinds[day] = null;
      if (stop) return;
    }
    // どの料理も入らない（またはほかの並びを試し終えた）ので、この日を空欄にして先へ進む
    dfs(day + 1, filled, unused);
  };
  dfs(0, 0, pool.length);

  // 料理の数が埋める日数より少なければ「足りない」、足りているのに埋まらなければ「組み合わせがない」
  const reason: EmptyWhy = pool.length < freeCount ? 'not_enough_dishes' : 'no_valid_combination';
  return slots.map((slot, d): ProposedDay => {
    if (slot === 'skip') return { status: 'skip' };
    const idx = best[d];
    return idx === null || idx === undefined
      ? { status: 'empty', reason }
      : { status: 'assigned', dishId: pool[idx].dishId };
  });
}

/** 献立の 1 日分（制約の判定に必要な最小の情報） */
export interface DayState {
  status: 'assigned' | 'skip' | 'empty';
  dishId: string | null;
  kind: IngredientKind | null;
}

const kindsOf = (days: readonly DayState[]) =>
  days.map((d) => (d.status === 'assigned' ? d.kind : null));

/** 他の日で、その料理が入っている日数（index の日は数えない） */
export function countElsewhere(days: readonly DayState[], index: number, dishId: string): number {
  return days.filter((d, i) => i !== index && d.status === 'assigned' && d.dishId === dishId)
    .length;
}

/**
 * BR30.9：index の日だけを別の料理に変える候補を 1 つ選ぶ。他の日は変えない。
 * 現在の料理と違い、同じ料理が 3 回以上にならず、同じ種類が 3 日続かないもの。
 * 他の日にまだ入っていない料理を先に使う。なければ null
 */
export function pickReplacement(input: {
  days: readonly DayState[];
  index: number;
  candidates: PlanCandidate[];
  back?: PlanCandidate[];
  random: () => number;
}): PlanCandidate | null {
  const { days, index, random } = input;
  const current = days[index].status === 'assigned' ? days[index].dishId : null;
  const ordered = [...shuffle(input.candidates, random), ...shuffle(input.back ?? [], random)];
  const options = ordered
    .filter((c) => c.dishId !== current)
    .filter((c) => countElsewhere(days, index, c.dishId) < MAX_SAME_DISH)
    .filter((c) => {
      const kinds = kindsOf(days);
      kinds[index] = c.kind;
      return !kindStreakAt(kinds, index);
    });
  // 他の日にまだ入っていない料理を先に（安定な並べ替え）
  const fresh = options.filter((c) => countElsewhere(days, index, c.dishId) === 0);
  const again = options.filter((c) => countElsewhere(days, index, c.dishId) > 0);
  return [...fresh, ...again][0] ?? null;
}

/** BR30.17：手割り当てが、同じ種類の 3 日続きを作るか（作っても断らず、注意を出す） */
export function assignmentMakesStreak(
  days: readonly DayState[],
  index: number,
  kind: IngredientKind | null,
): boolean {
  const kinds = kindsOf(days);
  kinds[index] = kind;
  return kindStreakAt(kinds, index);
}
