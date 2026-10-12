import type { Principal } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import {
  completeShoppingList,
  ensureShoppingHandlers,
  openShoppingList,
  setItemChecked,
  STALE_MESSAGE,
} from '@/domain/shopping';
import { json } from '../http';

/**
 * U3（買い物リスト）の API。
 * 入口（src/api/router.ts）の `routes` に `...shoppingRoutes` を足して登録する。
 * 認証・グループの決定・CSRF は入口が行う（ADR-005）。ここでは householdId を画面の入力から受け取らない（BR20.1）
 */
export interface ShoppingRouteContext {
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

export interface ShoppingRoute {
  method: string;
  pattern: RegExp;
  auth: 'none' | 'user' | 'household';
  /** ログ用の名前（ID や個人情報を含めない） */
  name: string;
  handler: (c: ShoppingRouteContext) => Promise<Response>;
}

const body = (c: ShoppingRouteContext) =>
  c.body && typeof c.body === 'object' ? (c.body as Record<string, unknown>) : {};

/** 受け口の登録（household.deleted。BR20.15）は、最初の呼び出しで 1 回だけ行う */
const ctx = (c: ShoppingRouteContext): HouseholdContext => {
  ensureShoppingHandlers(c.deps);
  return c.household!;
};

export const shoppingRoutes: ShoppingRoute[] = [
  {
    // リストを開く＝今の「選んだもの」にそろえて返す（BR20.2、BR20.3）
    method: 'GET',
    pattern: /^\/api\/shopping-list$/,
    auth: 'household',
    name: 'shopping.open',
    async handler(c) {
      const list = await openShoppingList(c.deps, ctx(c));
      return json({ list, ...(list.stale ? { staleMessage: STALE_MESSAGE } : {}) });
    },
  },
  {
    // 結果の値（付ける / 外す）を指定する。繰り返しても同じ（BR20.10）
    method: 'PUT',
    pattern: /^\/api\/shopping-list\/items\/([^/]+)\/checked$/,
    auth: 'household',
    name: 'shopping.check',
    async handler(c) {
      return json({ item: await setItemChecked(c.deps, ctx(c), c.params[0], body(c).checked) });
    },
  },
  {
    // 「買い物おわり」：リストを完了し、リストの料理を「選んだもの」から外す（BR20.13）
    method: 'POST',
    pattern: /^\/api\/shopping-list\/complete$/,
    auth: 'household',
    name: 'shopping.complete',
    async handler(c) {
      return json(await completeShoppingList(c.deps, ctx(c)));
    },
  },
];
