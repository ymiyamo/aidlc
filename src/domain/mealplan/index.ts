import { z } from 'zod';
import { isRealDate, todayJst } from '@/domain/cooklog/dates';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { DomainError, notFound } from '@/domain/errors';
import { composeFromIngredients, type ShoppingListView } from '@/domain/shopping';
import { listPlanCandidates, pickedList } from '@/domain/suggestion';
import { parseOrThrow } from '@/domain/validation';
import type { Queryable } from '@/db/types';
import type { IngredientKind } from '@/repo/dishes';
import {
  deletePlansOfHousehold,
  deleteWorkingPlan,
  getPlan,
  getPlanDishes,
  getWorkingPlan,
  insertPlan,
  listDays,
  listSavedPlans,
  markSaved,
  touchPlan,
  updateDay,
  type DayContent,
  type DayStatus,
  type EmptyReason,
  type MealPlanRow,
  type PlanDayRow,
  type PlanDishRow,
  type PlanOrigin,
} from '@/repo/mealplan';
import {
  MAX_SAME_DISH,
  assignmentMakesStreak,
  countElsewhere,
  hasKindStreak,
  pickReplacement,
  proposeWeek,
  type DayState,
  type PlanCandidate,
  type ProposedDay,
  type Slot,
} from './planner';

export { MAX_SEARCH_STEPS } from './planner';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 献立は常に 7 日（BR30.1） */
export const PLAN_DAYS = 7;

export const MESSAGES = {
  planSaved: '保存した献立は変更できません。呼び出して使ってください',
  dayIsSkip: '作らない日には入れられません。先に解除してください',
  redoSkip: '作らない日はやり直せません。先に解除してください',
  dishLimit: '同じ料理は 1 週間に 2 回までです',
  dishNotAvailable: 'この料理は使えません（除外している食材が含まれています）',
  noOtherDish: '他に使える料理がありません',
  noOtherCombination: '他の組み合わせがありません',
  sameKindStreak: '同じ種類が 3 日続きます',
  noIngredients: '材料がありません',
  deletedSkipped: '削除済みの料理は材料に含めていません',
} as const;

const conflict = (code: string, message: string) =>
  new DomainError('conflict', message, undefined, { code });

// ---------- 表示用の形 ----------

export interface PlanDishView {
  dishId: string;
  name: string;
  /** 削除済み（ADR-008）。名前は残し、「削除済み」の印を出す（BR30.21） */
  deleted: boolean;
  ingredientKind: IngredientKind | null;
}

export interface PlanDayView {
  date: string;
  dayStatus: DayStatus;
  origin: PlanOrigin | null;
  emptyReason: EmptyReason | null;
  dish: PlanDishView | null;
}

export interface MealPlanView {
  planId: string;
  startDate: string;
  isSaved: boolean;
  name: string | null;
  savedAt: string | null;
  days: PlanDayView[];
  /** 空き（empty の日）の数。作らない日は数えない（BR30.13） */
  emptyCount: number;
  skipCount: number;
  /** 同じ種類が 3 日続く並びがあるか（BR30.4。手割り当てや呼び出しで起こりうる） */
  sameKindStreak: boolean;
}

export interface PlanNotice {
  code: 'NO_OTHER_DISH' | 'NO_OTHER_COMBINATION' | 'SAME_KIND_STREAK';
  message: string;
}

export interface PlanResult {
  plan: MealPlanView;
  notices: PlanNotice[];
}

export interface SavedPlanSummary {
  planId: string;
  name: string;
  startDate: string;
  savedAt: string;
}

const toView = (
  plan: MealPlanRow,
  rows: PlanDayRow[],
  dishes: Map<string, PlanDishRow>,
): MealPlanView => {
  const days: PlanDayView[] = rows.map((r) => {
    const d = r.dishId ? dishes.get(r.dishId) : undefined;
    return {
      date: r.date,
      dayStatus: r.dayStatus,
      origin: r.origin,
      emptyReason: r.emptyReason,
      dish: d
        ? { dishId: d.dishId, name: d.name, deleted: d.deleted, ingredientKind: d.ingredientKind }
        : null,
    };
  });
  return {
    planId: plan.planId,
    startDate: plan.startDate,
    isSaved: plan.isSaved,
    name: plan.name,
    savedAt: plan.savedAt ? plan.savedAt.toISOString() : null,
    days,
    emptyCount: days.filter((d) => d.dayStatus === 'empty').length,
    skipCount: days.filter((d) => d.dayStatus === 'skip').length,
    sameKindStreak: hasKindStreak(
      days.map((d) => (d.dayStatus === 'assigned' ? (d.dish?.ingredientKind ?? null) : null)),
    ),
  };
};

const dishIdsOf = (rows: PlanDayRow[]) => [
  ...new Set(rows.map((r) => r.dishId).filter((x): x is string => x !== null)),
];

async function viewOf(q: Queryable, householdId: string, planId: string): Promise<MealPlanView> {
  const plan = await getPlan(q, householdId, planId);
  if (!plan) throw notFound();
  const rows = await listDays(q, householdId, planId);
  return toView(plan, rows, await getPlanDishes(q, householdId, dishIdsOf(rows)));
}

// ---------- 日付 ----------

/** YYYY-MM-DD に日数を足す（暦の日のまま。時差に左右されない） */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const planDates = (startDate: string) =>
  Array.from({ length: PLAN_DAYS }, (_, i) => addDays(startDate, i));

/** 「M/D からの献立」（BR30.14 の既定の名前） */
const defaultName = (startDate: string) => {
  const [, m, d] = startDate.split('-').map(Number);
  return `${m}/${d}からの献立`;
};

// ---------- 入力の検証 ----------

const dateText = z
  .string({ message: '日付の形式が正しくありません（YYYY-MM-DD）' })
  .refine(isRealDate, '日付の形式が正しくありません（YYYY-MM-DD）');

const proposeSchema = z.object({
  startDate: z.preprocess((v) => (v === '' || v === null ? undefined : v), dateText.optional()),
  skipDates: z.array(dateText).max(PLAN_DAYS, '作らない日が多すぎます').optional(),
});

const saveSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
    z.string().max(50, '名前は50文字までです').optional(),
  ),
});

const requirePlanId = (id: string) => {
  if (!UUID.test(id)) throw notFound();
  return id;
};
const requireDate = (date: string) => {
  if (!isRealDate(date)) throw notFound();
  return date;
};

// ---------- 候補（SuggestionJudge.pickCandidates + DishCatalog.getMany） ----------

interface Pool {
  front: PlanCandidate[];
  back: PlanCandidate[];
  ids: Set<string>;
}

/** BR30.2：候補の判定に 1 回だけ問い合わせ、種類は料理の要約からまとめて引く */
async function candidatePool(deps: AppDeps, householdId: string): Promise<Pool> {
  const c = await listPlanCandidates(deps, householdId);
  const info = await getPlanDishes(deps.db, householdId, [...c.front, ...c.back]);
  const toCandidate = (dishId: string): PlanCandidate => ({
    dishId,
    kind: info.get(dishId)?.ingredientKind ?? null,
  });
  return {
    front: c.front.map(toCandidate),
    back: c.back.map(toCandidate),
    ids: new Set([...c.front, ...c.back]),
  };
}

const toDayState = (r: PlanDayRow, dishes: Map<string, PlanDishRow>): DayState => ({
  status: r.dayStatus,
  dishId: r.dishId,
  kind: r.dishId ? (dishes.get(r.dishId)?.ingredientKind ?? null) : null,
});

const proposedToContent = (p: ProposedDay): DayContent =>
  p.status === 'assigned'
    ? { dayStatus: 'assigned', dishId: p.dishId, origin: 'suggested' }
    : p.status === 'skip'
      ? { dayStatus: 'skip' }
      : { dayStatus: 'empty', emptyReason: p.reason };

/** 取引の中で献立の行ロックを取る。見つからない（他のグループを含む）ときは 404、保存済みは 409 */
async function lockEditable(tx: Queryable, householdId: string, planId: string) {
  const plan = await getPlan(tx, householdId, requirePlanId(planId), true);
  if (!plan) throw notFound();
  if (plan.isSaved) throw conflict('PLAN_SAVED', MESSAGES.planSaved);
  return plan;
}

const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';

// ---------- WF1 提案 ----------

/**
 * BR30.1、BR30.5、BR30.8：7 日分の献立を提案し、作業中の献立にする。前の作業中の献立は捨てる（BR30.15）。
 * 作らない日（skipDates）は skip にする。足りない日は空欄（理由つき）で、エラーにしない
 */
export async function proposePlan(
  deps: AppDeps,
  ctx: HouseholdContext,
  raw: unknown,
): Promise<PlanResult> {
  ensureMealPlanHandlers(deps);
  const input = parseOrThrow(proposeSchema, raw);
  const startDate = input.startDate ?? todayJst(deps.now());
  const dates = planDates(startDate);
  const skip = new Set(input.skipDates ?? []);
  for (const s of skip) {
    if (!dates.includes(s)) {
      throw new DomainError('validation', '入力エラー', {
        skipDates: '作らない日は、献立の 7 日の中から選んでください',
      });
    }
  }
  const pool = await candidatePool(deps, ctx.householdId);
  const slots: Slot[] = dates.map((d) => (skip.has(d) ? 'skip' : 'free'));
  const proposed = proposeWeek({
    slots,
    front: pool.front,
    back: pool.back,
    random: deps.random,
  });
  const planId = deps.newId();
  const now = deps.now();
  try {
    await deps.db.transaction(async (tx) => {
      await deleteWorkingPlan(tx, ctx.householdId);
      await insertPlan(tx, ctx.householdId, {
        planId,
        startDate,
        createdBy: ctx.memberId,
        now,
        days: dates.map((date, i) => ({
          planDayId: deps.newId(),
          date,
          content: proposedToContent(proposed[i]),
        })),
      });
    });
  } catch (err) {
    // 同時に 2 つ作ろうとして「作業中は 1 件」の制約に当たった
    if (isUniqueViolation(err))
      throw conflict('PLAN_CONFLICT', '献立を作り直しています。もう一度お試しください');
    throw err;
  }
  return { plan: await viewOf(deps.db, ctx.householdId, planId), notices: [] };
}

// ---------- 読む ----------

/** 作業中の献立（なければ null） */
export async function getCurrentPlan(
  deps: AppDeps,
  ctx: HouseholdContext,
): Promise<MealPlanView | null> {
  ensureMealPlanHandlers(deps);
  const plan = await getWorkingPlan(deps.db, ctx.householdId);
  return plan ? viewOf(deps.db, ctx.householdId, plan.planId) : null;
}

/** 献立 1 件（作業中でも保存済みでも）。他のグループのものは見つからない（BR30.20） */
export async function getPlanView(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
): Promise<MealPlanView> {
  ensureMealPlanHandlers(deps);
  return viewOf(deps.db, ctx.householdId, requirePlanId(planId));
}

export async function listSavedPlanSummaries(
  deps: AppDeps,
  ctx: HouseholdContext,
): Promise<SavedPlanSummary[]> {
  ensureMealPlanHandlers(deps);
  return (await listSavedPlans(deps.db, ctx.householdId)).map((p) => ({
    planId: p.planId,
    name: p.name ?? defaultName(p.startDate),
    startDate: p.startDate,
    savedAt: (p.savedAt ?? p.createdAt).toISOString(),
  }));
}

/** BR30.16：「選んだもの」を、日に割り当てる候補として読む（複製しない。削除済みは入らない） */
export async function listAssignableDishes(
  deps: AppDeps,
  ctx: HouseholdContext,
): Promise<PlanDishView[]> {
  ensureMealPlanHandlers(deps);
  const picked = await pickedList(deps, ctx);
  return picked.map((p) => ({
    dishId: p.dish.dishId,
    name: p.dish.name,
    deleted: false,
    ingredientKind: p.dish.ingredientKind,
  }));
}

// ---------- WF2 やり直し ----------

/** BR30.9：その日だけを別の料理に変える。他の日は変えない。見つからなければ今のまま、案内を返す */
export async function redoDay(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
  date: string,
): Promise<PlanResult> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  requireDate(date);
  const pool = await candidatePool(deps, ctx.householdId);
  const notices: PlanNotice[] = [];
  await deps.db.transaction(async (tx) => {
    await lockEditable(tx, ctx.householdId, planId);
    const rows = await listDays(tx, ctx.householdId, planId);
    const index = rows.findIndex((r) => r.date === date);
    if (index < 0) throw notFound();
    if (rows[index].dayStatus === 'skip') throw conflict('DAY_IS_SKIP', MESSAGES.redoSkip);
    const dishes = await getPlanDishes(tx, ctx.householdId, dishIdsOf(rows));
    const choice = pickReplacement({
      days: rows.map((r) => toDayState(r, dishes)),
      index,
      candidates: pool.front,
      back: pool.back,
      random: deps.random,
    });
    if (!choice) {
      notices.push({ code: 'NO_OTHER_DISH', message: MESSAGES.noOtherDish });
      return;
    }
    await updateDay(tx, ctx.householdId, planId, date, {
      dayStatus: 'assigned',
      dishId: choice.dishId,
      origin: 'suggested',
    });
    await touchPlan(tx, ctx.householdId, planId, deps.now());
  });
  return { plan: await viewOf(deps.db, ctx.householdId, planId), notices };
}

/** 直前と同じ並びにならないよう、やり直す回数の上限（BR30.12） */
const REDO_ATTEMPTS = 8;

/**
 * BR30.12：作らない日を固定して、残りの日を別の組み合わせにする。
 * 手で割り当てた日も置き換わる。別の組み合わせがなければ今のまま、案内を返す
 */
export async function redoWeek(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
): Promise<PlanResult> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  const pool = await candidatePool(deps, ctx.householdId);
  const notices: PlanNotice[] = [];
  await deps.db.transaction(async (tx) => {
    await lockEditable(tx, ctx.householdId, planId);
    const rows = await listDays(tx, ctx.householdId, planId);
    const slots: Slot[] = rows.map((r) => (r.dayStatus === 'skip' ? 'skip' : 'free'));
    const signature = (xs: string[]) => xs.join('|');
    const before = signature(
      rows.map((r) => (r.dayStatus === 'skip' ? 'skip' : (r.dishId ?? '-'))),
    );
    let next: ProposedDay[] | null = null;
    for (let attempt = 0; attempt < REDO_ATTEMPTS; attempt++) {
      const candidate = proposeWeek({
        slots,
        front: pool.front,
        back: pool.back,
        random: deps.random,
      });
      const after = signature(
        candidate.map((p) =>
          p.status === 'skip' ? 'skip' : p.status === 'assigned' ? p.dishId : '-',
        ),
      );
      if (after !== before) {
        next = candidate;
        break;
      }
    }
    if (!next) {
      notices.push({ code: 'NO_OTHER_COMBINATION', message: MESSAGES.noOtherCombination });
      return;
    }
    for (const [i, row] of rows.entries()) {
      if (row.dayStatus === 'skip') continue;
      await updateDay(tx, ctx.householdId, planId, row.date, proposedToContent(next[i]));
    }
    await touchPlan(tx, ctx.householdId, planId, deps.now());
  });
  return { plan: await viewOf(deps.db, ctx.householdId, planId), notices };
}

// ---------- WF3 作らない日 ----------

/** BR30.10：その日を「作らない」にする。料理があれば外す。すでに作らない日なら何もせず成功 */
export async function setSkipDay(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
  date: string,
): Promise<PlanResult> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  requireDate(date);
  await deps.db.transaction(async (tx) => {
    await lockEditable(tx, ctx.householdId, planId);
    const rows = await listDays(tx, ctx.householdId, planId);
    const row = rows.find((r) => r.date === date);
    if (!row) throw notFound();
    if (row.dayStatus === 'skip') return;
    await updateDay(tx, ctx.householdId, planId, date, { dayStatus: 'skip' });
    await touchPlan(tx, ctx.householdId, planId, deps.now());
  });
  return { plan: await viewOf(deps.db, ctx.householdId, planId), notices: [] };
}

/** BR30.11：「作らない」を解除して空欄（not_proposed）に戻す。作らない日でなければ何もせず成功 */
export async function clearSkipDay(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
  date: string,
): Promise<PlanResult> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  requireDate(date);
  await deps.db.transaction(async (tx) => {
    await lockEditable(tx, ctx.householdId, planId);
    const rows = await listDays(tx, ctx.householdId, planId);
    const row = rows.find((r) => r.date === date);
    if (!row) throw notFound();
    if (row.dayStatus !== 'skip') return;
    await updateDay(tx, ctx.householdId, planId, date, {
      dayStatus: 'empty',
      emptyReason: 'not_proposed',
    });
    await touchPlan(tx, ctx.householdId, planId, deps.now());
  });
  return { plan: await viewOf(deps.db, ctx.householdId, planId), notices: [] };
}

// ---------- WF4 手割り当て ----------

/**
 * BR30.17：日に料理を手で割り当てる。作らない日と、3 回目の割り当ては断る。
 * 同じ種類が 3 日続くときは、注意を返して割り当てる。同じ日に同じ料理を割り当て直しても結果は同じ
 */
export async function assignDish(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
  date: string,
  dishId: unknown,
): Promise<PlanResult> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  requireDate(date);
  if (typeof dishId !== 'string') {
    throw new DomainError('validation', '入力エラー', { dishId: '料理を指定してください' });
  }
  if (!UUID.test(dishId)) throw notFound();
  // 自分のグループの、削除済みでない料理だけ（他のグループは「見つからない」。BR30.20）
  const info = (await getPlanDishes(deps.db, ctx.householdId, [dishId])).get(dishId);
  if (!info || info.deleted) throw notFound();
  const pool = await candidatePool(deps, ctx.householdId);
  if (!pool.ids.has(dishId)) {
    const picked = await pickedList(deps, ctx);
    if (!picked.some((p) => p.dish.dishId === dishId)) {
      throw conflict('DISH_NOT_AVAILABLE', MESSAGES.dishNotAvailable);
    }
  }
  const notices: PlanNotice[] = [];
  await deps.db.transaction(async (tx) => {
    await lockEditable(tx, ctx.householdId, planId);
    const rows = await listDays(tx, ctx.householdId, planId);
    const index = rows.findIndex((r) => r.date === date);
    if (index < 0) throw notFound();
    if (rows[index].dayStatus === 'skip') throw conflict('DAY_IS_SKIP', MESSAGES.dayIsSkip);
    const dishes = await getPlanDishes(tx, ctx.householdId, dishIdsOf(rows));
    const states = rows.map((r) => toDayState(r, dishes));
    if (countElsewhere(states, index, dishId) >= MAX_SAME_DISH) {
      throw conflict('DISH_LIMIT', MESSAGES.dishLimit);
    }
    if (assignmentMakesStreak(states, index, info.ingredientKind)) {
      notices.push({ code: 'SAME_KIND_STREAK', message: MESSAGES.sameKindStreak });
    }
    await updateDay(tx, ctx.householdId, planId, date, {
      dayStatus: 'assigned',
      dishId,
      origin: 'assigned_by_user',
    });
    await touchPlan(tx, ctx.householdId, planId, deps.now());
  });
  return { plan: await viewOf(deps.db, ctx.householdId, planId), notices };
}

// ---------- WF5 保存と呼び出し ----------

/** BR30.14：作業中の献立を保存する。保存後は日の内容が変わらない。保存済みなら何もせず成功 */
export async function savePlan(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
  raw: unknown,
): Promise<MealPlanView> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  const input = parseOrThrow(saveSchema, raw);
  await deps.db.transaction(async (tx) => {
    const plan = await getPlan(tx, ctx.householdId, planId, true);
    if (!plan) throw notFound();
    if (plan.isSaved) return;
    await markSaved(tx, ctx.householdId, planId, {
      name: input.name ?? defaultName(plan.startDate),
      now: deps.now(),
    });
  });
  return viewOf(deps.db, ctx.householdId, planId);
}

/**
 * BR30.15：保存した献立の写しを、新しい作業中の献立として開く（元は変わらない）。前の作業中の献立は捨てる。
 * 料理が削除済み、または新しく除外された日は、空欄（dish_unavailable）にする。「選んだもの」であることでは変えない
 */
export async function recallPlan(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
): Promise<PlanResult> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  const source = await getPlan(deps.db, ctx.householdId, planId);
  if (!source || !source.isSaved) throw notFound();
  const pool = await candidatePool(deps, ctx.householdId);
  const rows = await listDays(deps.db, ctx.householdId, planId);
  const dishes = await getPlanDishes(deps.db, ctx.householdId, dishIdsOf(rows));
  const content = (r: PlanDayRow): DayContent => {
    if (r.dayStatus === 'skip') return { dayStatus: 'skip' };
    if (r.dayStatus === 'empty') {
      return { dayStatus: 'empty', emptyReason: r.emptyReason ?? 'not_proposed' };
    }
    const d = r.dishId ? dishes.get(r.dishId) : undefined;
    if (!r.dishId || !d || d.deleted || !pool.ids.has(r.dishId)) {
      return { dayStatus: 'empty', emptyReason: 'dish_unavailable' };
    }
    return { dayStatus: 'assigned', dishId: r.dishId, origin: r.origin ?? 'suggested' };
  };
  const copyId = deps.newId();
  try {
    await deps.db.transaction(async (tx) => {
      await deleteWorkingPlan(tx, ctx.householdId);
      await insertPlan(tx, ctx.householdId, {
        planId: copyId,
        startDate: source.startDate,
        createdBy: ctx.memberId,
        now: deps.now(),
        days: rows.map((r) => ({ planDayId: deps.newId(), date: r.date, content: content(r) })),
      });
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw conflict('PLAN_CONFLICT', '献立を作り直しています。もう一度お試しください');
    throw err;
  }
  const plan = await viewOf(deps.db, ctx.householdId, copyId);
  return {
    plan,
    notices: plan.sameKindStreak
      ? [{ code: 'SAME_KIND_STREAK', message: MESSAGES.sameKindStreak }]
      : [],
  };
}

// ---------- WF6 買い物リスト ----------

export interface MealPlanShoppingResult {
  list: ShoppingListView;
  /** 削除済みで、材料に含めなかった日の数（BR30.18、BR30.21） */
  skippedDeleted: number;
  message: string | null;
}

/**
 * BR30.18：料理がある日（assigned）の材料だけを、買い物リストの窓口に渡して作る。
 * 作らない日と空欄の日は含めない。削除済みの料理は含めず、案内する。合算は U3 の担当。
 * 渡せる料理が 0 件なら、作らずに断る
 */
export async function createShoppingList(
  deps: AppDeps,
  ctx: HouseholdContext,
  planId: string,
): Promise<MealPlanShoppingResult> {
  ensureMealPlanHandlers(deps);
  requirePlanId(planId);
  const plan = await getPlan(deps.db, ctx.householdId, planId);
  if (!plan) throw notFound();
  const rows = (await listDays(deps.db, ctx.householdId, planId)).filter(
    (r) => r.dayStatus === 'assigned' && r.dishId !== null,
  );
  const dishes = await getPlanDishes(deps.db, ctx.householdId, dishIdsOf(rows));
  const usable = rows.filter((r) => {
    const d = dishes.get(r.dishId!);
    return d !== undefined && !d.deleted;
  });
  if (usable.length === 0) throw conflict('NO_INGREDIENTS', MESSAGES.noIngredients);
  const list = await composeFromIngredients(deps, ctx, {
    planId,
    dishes: usable.map((r) => {
      const d = dishes.get(r.dishId!)!;
      return { dishId: d.dishId, name: d.name, ingredients: d.ingredients };
    }),
  });
  const skippedDeleted = rows.length - usable.length;
  return {
    list,
    skippedDeleted,
    message: skippedDeleted > 0 ? MESSAGES.deletedSkipped : null,
  };
}

// ---------- グループ削除の受け口（BR30.22、ADR-007） ----------

const registered = new WeakSet<AppDeps>();

/**
 * 出来事の受け口を登録する（何度呼んでも 1 回だけ）。
 * household.deleted を受けたら、そのグループの献立と日をすべて消す。何度受けても結果は同じ
 */
export function ensureMealPlanHandlers(deps: AppDeps): void {
  if (registered.has(deps)) return;
  registered.add(deps);
  deps.events.subscribe('household.deleted', async ({ householdId }) => {
    await deletePlansOfHousehold(deps.db, householdId);
  });
}
