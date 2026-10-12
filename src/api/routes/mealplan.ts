import type { Principal } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { DomainError } from '@/domain/errors';
import {
  assignDish,
  clearSkipDay,
  createShoppingList,
  ensureMealPlanHandlers,
  getCurrentPlan,
  getPlanView,
  listAssignableDishes,
  listSavedPlanSummaries,
  proposePlan,
  recallPlan,
  redoDay,
  redoWeek,
  savePlan,
  setSkipDay,
} from '@/domain/mealplan';
import { json } from '../http';

/**
 * U4（献立）の API。
 * 入口（src/api/router.ts）の `routes` に `...mealPlanRoutes` を足して登録する。
 * 認証・グループの決定・CSRF は入口が行う（ADR-005）。ここでは householdId を画面の入力から受け取らない（BR30.20）
 */
export interface MealPlanRouteContext {
  req: Request;
  deps: AppDeps;
  params: string[];
  query: URLSearchParams;
  body: unknown;
  principal: Principal | null;
  household: HouseholdContext | null;
  sessionToken: string | null;
  cookies: string[];
}

export interface MealPlanRoute {
  method: string;
  pattern: RegExp;
  auth: 'none' | 'user' | 'household';
  /** ログ用の名前（ID や個人情報を含めない） */
  name: string;
  handler: (c: MealPlanRouteContext) => Promise<Response>;
}

const body = (c: MealPlanRouteContext) =>
  c.body && typeof c.body === 'object' ? (c.body as Record<string, unknown>) : {};

/** 受け口の登録（household.deleted。BR30.22）は、最初の呼び出しで 1 回だけ行う */
const ctx = (c: MealPlanRouteContext): HouseholdContext => {
  ensureMealPlanHandlers(c.deps);
  return c.household!;
};

const flag = (value: unknown, key: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new DomainError('validation', '入力エラー', {
      [key]: 'true か false を指定してください',
    });
  }
  return value;
};

const ID = '([^/]+)';
const DATE = '(\\d{4}-\\d{2}-\\d{2})';

export const mealPlanRoutes: MealPlanRoute[] = [
  {
    // 作業中の献立（なければ null）
    method: 'GET',
    pattern: /^\/api\/meal-plans\/current$/,
    auth: 'household',
    name: 'mealplan.current',
    async handler(c) {
      return json({ plan: await getCurrentPlan(c.deps, ctx(c)) });
    },
  },
  {
    // 日に割り当てられる「選んだもの」（BR30.16）
    method: 'GET',
    pattern: /^\/api\/meal-plans\/assignable$/,
    auth: 'household',
    name: 'mealplan.assignable',
    async handler(c) {
      return json({ dishes: await listAssignableDishes(c.deps, ctx(c)) });
    },
  },
  {
    // 保存済みの献立の一覧
    method: 'GET',
    pattern: /^\/api\/meal-plans$/,
    auth: 'household',
    name: 'mealplan.list',
    async handler(c) {
      return json({ plans: await listSavedPlanSummaries(c.deps, ctx(c)) });
    },
  },
  {
    // 7 日分の提案を作る（BR30.1、BR30.5）。前の作業中の献立は捨てる
    method: 'POST',
    pattern: /^\/api\/meal-plans$/,
    auth: 'household',
    name: 'mealplan.propose',
    async handler(c) {
      return json(await proposePlan(c.deps, ctx(c), body(c)), 201);
    },
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/meal-plans/${ID}$`),
    auth: 'household',
    name: 'mealplan.get',
    async handler(c) {
      return json({ plan: await getPlanView(c.deps, ctx(c), c.params[0]) });
    },
  },
  {
    // 週全体のやり直し（BR30.12）
    method: 'POST',
    pattern: new RegExp(`^/api/meal-plans/${ID}/redo$`),
    auth: 'household',
    name: 'mealplan.redoWeek',
    async handler(c) {
      return json(await redoWeek(c.deps, ctx(c), c.params[0]));
    },
  },
  {
    // 日ごとのやり直し（BR30.9）
    method: 'POST',
    pattern: new RegExp(`^/api/meal-plans/${ID}/days/${DATE}/redo$`),
    auth: 'household',
    name: 'mealplan.redoDay',
    async handler(c) {
      return json(await redoDay(c.deps, ctx(c), c.params[0], c.params[1]));
    },
  },
  {
    // 「作らない」の設定・解除。結果の値（skip: true / false）を指定する（繰り返しても同じ。BR30.10、BR30.11）
    method: 'PUT',
    pattern: new RegExp(`^/api/meal-plans/${ID}/days/${DATE}/skip$`),
    auth: 'household',
    name: 'mealplan.skip',
    async handler(c) {
      const skip = flag(body(c).skip, 'skip');
      const run = skip ? setSkipDay : clearSkipDay;
      return json(await run(c.deps, ctx(c), c.params[0], c.params[1]));
    },
  },
  {
    // 日に料理を割り当てる（BR30.17）
    method: 'PUT',
    pattern: new RegExp(`^/api/meal-plans/${ID}/days/${DATE}/dish$`),
    auth: 'household',
    name: 'mealplan.assign',
    async handler(c) {
      return json(await assignDish(c.deps, ctx(c), c.params[0], c.params[1], body(c).dishId));
    },
  },
  {
    // 保存（BR30.14）。繰り返しても同じ
    method: 'POST',
    pattern: new RegExp(`^/api/meal-plans/${ID}/save$`),
    auth: 'household',
    name: 'mealplan.save',
    async handler(c) {
      return json({ plan: await savePlan(c.deps, ctx(c), c.params[0], body(c)) });
    },
  },
  {
    // 保存した献立を呼び出す＝写しを作業中にする（BR30.15）
    method: 'POST',
    pattern: new RegExp(`^/api/meal-plans/${ID}/recall$`),
    auth: 'household',
    name: 'mealplan.recall',
    async handler(c) {
      return json(await recallPlan(c.deps, ctx(c), c.params[0]), 201);
    },
  },
  {
    // この献立の買い物リストを作る（BR30.18）
    method: 'POST',
    pattern: new RegExp(`^/api/meal-plans/${ID}/shopping-list$`),
    auth: 'household',
    name: 'mealplan.shoppingList',
    async handler(c) {
      return json(await createShoppingList(c.deps, ctx(c), c.params[0]));
    },
  },
];
