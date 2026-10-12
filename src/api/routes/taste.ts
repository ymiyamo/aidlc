import type { Principal } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import type { HouseholdContext } from '@/domain/dish';
import { countMatching, randomCandidate } from '@/domain/suggestion';
import {
  addDislike,
  ensureTasteHandlers,
  listMyDislikes,
  moodTagOptions,
  parseCandidateFilter,
  removeDislike,
  DISLIKE_LIMIT,
} from '@/domain/taste';
import { dishJson, json } from '../http';

/**
 * U2（好き嫌いと絞り込み）の API。
 * 入口（src/api/router.ts）の `routes` に `...tasteRoutes` を足して登録する。
 * 認証・グループの決定・CSRF は入口が行う（ADR-005）。ここでは householdId を画面の入力から受け取らない（BR10.23）。
 * 絞り込み・除外つきの「候補を 1 件」は、既存の GET /api/suggestions/next が受け持つ
 */
export interface TasteRouteContext {
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

export interface TasteRoute {
  method: string;
  pattern: RegExp;
  auth: 'none' | 'user' | 'household';
  /** ログ用の名前（ID や個人情報を含めない） */
  name: string;
  handler: (c: TasteRouteContext) => Promise<Response>;
}

const body = (c: TasteRouteContext) =>
  c.body && typeof c.body === 'object' ? (c.body as Record<string, unknown>) : {};

/** 出来事の受け口（member-left、household.deleted。BR10.21、BR10.22）は、最初の呼び出しで整える */
const ctx = (c: TasteRouteContext): HouseholdContext => {
  ensureTasteHandlers(c.deps);
  return c.household!;
};

export const tasteRoutes: TasteRoute[] = [
  {
    // 自分の嫌いな食材だけ、登録の古い順（BR10.5）
    method: 'GET',
    pattern: /^\/api\/me\/dislikes$/,
    auth: 'household',
    name: 'dislikes.list',
    async handler(c) {
      return json({ dislikes: await listMyDislikes(c.deps, ctx(c)), limit: DISLIKE_LIMIT });
    },
  },
  {
    // 登録。すでに同じ食材名があれば、何も増やさず 200（BR10.2）
    method: 'POST',
    pattern: /^\/api\/me\/dislikes$/,
    auth: 'household',
    name: 'dislikes.add',
    async handler(c) {
      const { dislike, created } = await addDislike(c.deps, ctx(c), body(c));
      return json({ dislike }, created ? 201 : 200);
    },
  },
  {
    // 本人の登録だけ外せる。他の人・他のグループの ID は見つからない（BR10.4）
    method: 'DELETE',
    pattern: /^\/api\/me\/dislikes\/([^/]+)$/,
    auth: 'household',
    name: 'dislikes.remove',
    async handler(c) {
      await removeDislike(c.deps, ctx(c), c.params[0]);
      return json({ ok: true });
    },
  },
  {
    // いまの条件に合う件数（BR10.13）。条件は time、effort、moodTag（繰り返し）
    method: 'GET',
    pattern: /^\/api\/suggestions\/count$/,
    auth: 'household',
    name: 'suggestions.count',
    async handler(c) {
      const filter = parseCandidateFilter(c.query);
      return json({ count: await countMatching(c.deps, ctx(c).householdId, filter) });
    },
  },
  {
    // 気分のタグの選択肢（BR10.10）
    method: 'GET',
    pattern: /^\/api\/suggestions\/mood-tags$/,
    auth: 'household',
    name: 'suggestions.moodTags',
    async handler(c) {
      return json({ tags: await moodTagOptions(c.deps, ctx(c)) });
    },
  },
  {
    // おまかせ：絞り込みなしで 1 件。除外だけ適用する（BR10.16）
    method: 'GET',
    pattern: /^\/api\/suggestions\/random$/,
    auth: 'household',
    name: 'suggestions.random',
    async handler(c) {
      const next = await randomCandidate(c.deps, ctx(c).householdId);
      if (next.status === 'card') {
        return json({ status: 'card', dish: dishJson(next.dish), remaining: next.remaining });
      }
      return json({ status: next.status });
    },
  },
];
