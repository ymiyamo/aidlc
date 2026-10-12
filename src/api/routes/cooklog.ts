import {
  addRecord,
  dishRecords,
  editRecord,
  ensureCookLogHandlers,
  monthView,
  removeRecord,
} from '@/domain/cooklog';
import type { Principal } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { json } from '../http';

/**
 * U5（作った記録）の API。
 * 入口（src/api/router.ts）の `routes` に `...cooklogRoutes` を足して登録する。
 * 認証・グループの決定・CSRF は入口が行う（ADR-005）。ここでは householdId を画面の入力から受け取らない（BR40.10）
 */
export interface CookLogRouteContext {
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

export interface CookLogRoute {
  method: string;
  pattern: RegExp;
  auth: 'none' | 'user' | 'household';
  /** ログ用の名前（ID や個人情報を含めない） */
  name: string;
  handler: (c: CookLogRouteContext) => Promise<Response>;
}

const body = (c: CookLogRouteContext) =>
  c.body && typeof c.body === 'object' ? (c.body as Record<string, unknown>) : {};

/** 受け口の登録（household.deleted。BR40.21）は、最初の呼び出しで 1 回だけ行う */
const ctx = (c: CookLogRouteContext): HouseholdContext => {
  ensureCookLogHandlers(c.deps);
  return c.household!;
};

export const cooklogRoutes: CookLogRoute[] = [
  {
    // 月のカレンダーと一覧（BR40.12、BR40.13）。month は「年-月」。省くと今月
    method: 'GET',
    pattern: /^\/api\/records$/,
    auth: 'household',
    name: 'records.month',
    async handler(c) {
      return json(await monthView(c.deps, ctx(c), c.query.get('month')));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/records$/,
    auth: 'household',
    name: 'records.add',
    async handler(c) {
      return json({ record: await addRecord(c.deps, ctx(c), body(c)) }, 201);
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/records\/([^/]+)$/,
    auth: 'household',
    name: 'records.edit',
    async handler(c) {
      return json({ record: await editRecord(c.deps, ctx(c), c.params[0], body(c)) });
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/records\/([^/]+)$/,
    auth: 'household',
    name: 'records.delete',
    async handler(c) {
      await removeRecord(c.deps, ctx(c), c.params[0]);
      return json({ ok: true });
    },
  },
  {
    // 項目の詳細：作った回数と、作った日の一覧（BR40.7）
    method: 'GET',
    pattern: /^\/api\/dishes\/([^/]+)\/records$/,
    auth: 'household',
    name: 'dishes.records',
    async handler(c) {
      return json(await dishRecords(c.deps, ctx(c), c.params[0]));
    },
  },
];
