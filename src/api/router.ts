import { randomUUID } from 'node:crypto';
import {
  authenticate,
  login,
  logout,
  register,
  type IssuedSession,
  type Principal,
} from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import {
  createDish,
  editDish,
  findDish,
  listHouseholdDishes,
  markFavorite,
  removeDish,
  type HouseholdContext,
} from '@/domain/dish';
import { DomainError, notFound } from '@/domain/errors';
import { deleteImagesForDish } from '@/domain/images';
import { createHousehold, listHouseholdMembers, prepareHome } from '@/domain/household';
import { nextCandidate, pick, pickedList, unpick } from '@/domain/suggestion';
import { parseCandidateFilter } from '@/domain/taste';
import { newCsrfToken, csrfOk, SAFE_METHODS } from './csrf';
import { adminRoutes } from './routes/admin';
import { cooklogRoutes } from './routes/cooklog';
import { imagesRoutes } from './routes/images';
import { shoppingRoutes } from './routes/shopping';
import { tasteRoutes } from './routes/taste';
import { mealPlanRoutes } from './routes/mealplan';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  UUID_RE,
  dishJson,
  domainErrorResponse,
  errorResponse,
  json,
  parseCookies,
  serializeCookie,
} from './http';

type Auth = 'none' | 'user' | 'household';

interface RouteContext {
  req: Request;
  deps: AppDeps;
  params: string[];
  query: URLSearchParams;
  body: unknown;
  principal: Principal | null;
  /** 入口で決めたグループ。画面の入力からは決めない（BR2.3、NFR3.5） */
  household: HouseholdContext | null;
  sessionToken: string | null;
  /** 応答に付ける Set-Cookie */
  cookies: string[];
}

interface Route {
  method: string;
  pattern: RegExp;
  auth: Auth;
  /** ログ用の名前（ID や個人情報を含めない） */
  name: string;
  handler: (c: RouteContext) => Promise<Response>;
}

const sessionCookie = (c: RouteContext, s: IssuedSession) =>
  serializeCookie(SESSION_COOKIE, s.token, {
    secure: c.deps.config.cookieSecure,
    expires: s.expiresAt,
    maxAgeSeconds: Math.floor((s.expiresAt.getTime() - c.deps.now().getTime()) / 1000),
  });

const clearSessionCookie = (c: RouteContext) =>
  serializeCookie(SESSION_COOKIE, '', { secure: c.deps.config.cookieSecure, maxAgeSeconds: 0 });

const body = (c: RouteContext) =>
  c.body && typeof c.body === 'object' ? (c.body as Record<string, unknown>) : {};
const requireId = (id: string) => {
  if (!UUID_RE.test(id)) throw notFound();
  return id;
};
const hh = (c: RouteContext) => c.household!;

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/api\/csrf$/,
    auth: 'none',
    name: 'csrf',
    async handler(c) {
      const existing = parseCookies(c.req.headers.get('cookie'))[CSRF_COOKIE];
      const token = existing || newCsrfToken();
      c.cookies.push(
        serializeCookie(CSRF_COOKIE, token, {
          secure: c.deps.config.cookieSecure,
          maxAgeSeconds: 60 * 60 * 24 * 30,
        }),
      );
      return json({ token });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/register$/,
    auth: 'none',
    name: 'register',
    async handler(c) {
      const s = await register(c.deps, c.body);
      c.cookies.push(sessionCookie(c, s));
      return json({ ok: true }, 201);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/login$/,
    auth: 'none',
    name: 'login',
    async handler(c) {
      const s = await login(c.deps, c.body);
      c.cookies.push(sessionCookie(c, s));
      return json({ ok: true });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/logout$/,
    auth: 'none',
    name: 'logout',
    async handler(c) {
      await logout(c.deps, c.sessionToken);
      c.cookies.push(clearSessionCookie(c));
      return json({ ok: true });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/me$/,
    auth: 'user',
    name: 'me',
    async handler(c) {
      const p = c.principal!;
      return json({
        account: { displayName: p.displayName },
        hasHousehold: p.household !== null,
      });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/household$/,
    auth: 'user',
    name: 'household.create',
    async handler(c) {
      await createHousehold(c.deps, c.principal!.accountId, c.body);
      return json({ ok: true }, 201);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/household\/members$/,
    auth: 'household',
    name: 'household.members',
    async handler(c) {
      return json({ members: await listHouseholdMembers(c.deps, hh(c).householdId) });
    },
  },
  {
    // 初期データの補完。何度呼んでも結果は同じ（冪等）
    method: 'POST',
    pattern: /^\/api\/home\/prepare$/,
    auth: 'household',
    name: 'home.prepare',
    async handler(c) {
      const home = await prepareHome(c.deps, hh(c).householdId);
      return json({ householdName: home.household.name, seedStatus: home.seedStatus });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/dishes$/,
    auth: 'household',
    name: 'dishes.list',
    async handler(c) {
      const dishes = await listHouseholdDishes(c.deps, hh(c), {
        favoriteOnly: c.query.get('favorite') === '1',
      });
      return json({ dishes: dishes.map(dishJson) });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/dishes$/,
    auth: 'household',
    name: 'dishes.create',
    async handler(c) {
      const { confirmDuplicate, ...input } = body(c);
      const dish = await createDish(c.deps, hh(c), input, {
        confirmDuplicate: confirmDuplicate === true,
      });
      return json({ dish: dishJson(dish) }, 201);
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/dishes\/([^/]+)$/,
    auth: 'household',
    name: 'dishes.get',
    async handler(c) {
      return json({ dish: dishJson(await findDish(c.deps, hh(c), requireId(c.params[0]))) });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/dishes\/([^/]+)$/,
    auth: 'household',
    name: 'dishes.update',
    async handler(c) {
      const { confirmDuplicate: _ignored, ...input } = body(c);
      void _ignored;
      return json({ dish: dishJson(await editDish(c.deps, hh(c), requireId(c.params[0]), input)) });
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/dishes\/([^/]+)$/,
    auth: 'household',
    name: 'dishes.delete',
    async handler(c) {
      const dishId = requireId(c.params[0]);
      await removeDish(c.deps, hh(c), dishId);
      // 画像の実体と記録も消す（BR60.12）。失敗しても料理の削除は成功のまま
      try {
        await deleteImagesForDish(c.deps, hh(c).householdId, dishId);
      } catch (err) {
        c.deps.logger.error('image_delete_for_dish_failed', { error: err });
      }
      return json({ ok: true });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/dishes\/([^/]+)\/favorite$/,
    auth: 'household',
    name: 'dishes.favorite',
    async handler(c) {
      const flag = body(c).isFavorite;
      if (typeof flag !== 'boolean') {
        throw new DomainError('validation', '入力エラー', {
          isFavorite: 'true か false を指定してください',
        });
      }
      return json({
        dish: dishJson(await markFavorite(c.deps, hh(c), requireId(c.params[0]), flag)),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/suggestions\/next$/,
    auth: 'household',
    name: 'suggestions.next',
    async handler(c) {
      // 「見た料理の ID の一覧」は画面が持ち、毎回送ってくる（BR4.3）。形の正しい ID だけ使う
      const seen = (c.query.get('seen') ?? '').split(',').filter((id) => UUID_RE.test(id));
      // U2：「今日の気分」の条件（time、effort、moodTag）は、要求のたびに画面が渡す（BR10.14）。除外は提案が適用する
      const next = await nextCandidate(
        c.deps,
        hh(c).householdId,
        seen,
        parseCandidateFilter(c.query),
      );
      if (next.status === 'card') {
        return json({ status: 'card', dish: dishJson(next.dish), remaining: next.remaining });
      }
      return json({ status: next.status });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/picked$/,
    auth: 'household',
    name: 'picked.list',
    async handler(c) {
      const picked = await pickedList(c.deps, hh(c));
      return json({
        picked: picked.map((p) => ({ dish: dishJson(p.dish), pickedAt: p.pickedAt })),
      });
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/picked$/,
    auth: 'household',
    name: 'picked.add',
    async handler(c) {
      const dishId = body(c).dishId;
      if (typeof dishId !== 'string') {
        throw new DomainError('validation', '入力エラー', { dishId: '料理を指定してください' });
      }
      await pick(c.deps, hh(c), requireId(dishId));
      return json({ ok: true }, 201);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/picked\/([^/]+)$/,
    auth: 'household',
    name: 'picked.remove',
    async handler(c) {
      await unpick(c.deps, hh(c), requireId(c.params[0]));
      return json({ ok: true });
    },
  },
  // U7（グループとアカウントの管理）
  ...adminRoutes,
  // U5（作った記録）
  ...cooklogRoutes,
  // U6（画像）
  ...imagesRoutes,
  // U2（好き嫌いと絞り込み）
  ...tasteRoutes,
  // U3（買い物リスト）
  ...shoppingRoutes,
  // U4（献立）
  ...mealPlanRoutes,
];

async function readBody(req: Request): Promise<unknown> {
  if (SAFE_METHODS.has(req.method)) return undefined;
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError('validation', '入力エラー', { _: 'JSON の形式が正しくありません' });
  }
}

/** API の入口。認証、グループの決定、CSRF、ログをここ 1 か所で行う（ADR-005、NFR3.x） */
export async function handle(req: Request, deps: AppDeps): Promise<Response> {
  const started = Date.now();
  const requestId = req.headers.get('x-request-id') || randomUUID();
  const url = new URL(req.url);
  const matched = routes.map((r) => ({ r, m: r.pattern.exec(url.pathname) })).filter((x) => x.m);
  const hit = matched.find((x) => x.r.method === req.method);
  let routeName = 'unmatched';
  let res: Response;
  const cookies: string[] = [];

  try {
    if (!hit) {
      res = matched.length
        ? errorResponse('bad_request', '許可されていない操作です')
        : domainErrorResponse(notFound());
      if (matched.length) res = new Response(res.body, { status: 405, headers: res.headers });
    } else {
      routeName = hit.r.name;
      if (!SAFE_METHODS.has(req.method) && !csrfOk(req, deps)) {
        res = errorResponse('csrf', 'リクエストを確認できませんでした。画面を開き直してください');
      } else {
        const sessionToken = parseCookies(req.headers.get('cookie'))[SESSION_COOKIE] ?? null;
        let principal: Principal | null = null;
        if (hit.r.auth !== 'none') {
          principal = await authenticate(deps, sessionToken);
          if (!principal) throw new DomainError('unauthorized', 'ログインしてください');
          if (hit.r.auth === 'household' && !principal.household) {
            throw new DomainError('no_household', 'グループを作成してください');
          }
        }
        res = await hit.r.handler({
          req,
          deps,
          params: (hit.m as RegExpExecArray).slice(1).map(decodeURIComponent),
          query: url.searchParams,
          body: await readBody(req),
          principal,
          household: principal?.household ?? null,
          sessionToken,
          cookies,
        });
      }
    }
  } catch (err) {
    if (err instanceof DomainError) {
      res = domainErrorResponse(err);
    } else {
      // 内容（個人情報を含みうる）は出さず、種類だけ記録する
      deps.logger.error('request_failed', { requestId, route: routeName, error: err });
      res = errorResponse('internal', 'エラーが発生しました。時間をおいてもう一度お試しください');
    }
  }

  const headers = new Headers(res.headers);
  for (const c of cookies) headers.append('set-cookie', c);
  headers.set('x-request-id', requestId);
  headers.set('cache-control', 'no-store');
  const out = new Response(res.body, { status: res.status, headers });
  // 個人情報（パスワード、メール、Cookie、メモ、URL）は、ログに出さない（NFR4.13）
  deps.logger.info('request', {
    requestId,
    method: req.method,
    route: routeName,
    status: out.status,
    durationMs: Date.now() - started,
  });
  return out;
}
