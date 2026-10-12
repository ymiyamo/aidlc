import { csrfOk, SAFE_METHODS } from '@/api/csrf';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  domainErrorResponse,
  errorResponse,
} from '@/api/http';
import { authenticate, type Principal } from '@/domain/auth';
import type { AppDeps } from '@/domain/deps';
import { DomainError, notFound } from '@/domain/errors';
import { imagesRoutes } from '../images';

const ORIGIN = 'http://localhost';
const CSRF = 'test-csrf-token';

/**
 * U6 のルートだけを、入口（router.ts）と同じ手順で動かす試験用の入口。
 * router.ts への登録（`...imagesRoutes`）の前でも、ルートの動作を確かめられる。
 * 手順（CSRF → 認証 → グループ → 本文 → 誤りの変換）は router.ts の handle と同じ順
 */
async function handleImages(req: Request, deps: AppDeps): Promise<Response> {
  const url = new URL(req.url);
  const hit = imagesRoutes
    .map((route) => ({ route, m: route.pattern.exec(url.pathname) }))
    .find((x) => x.m && x.route.method === req.method);
  const cookies: string[] = [];
  let res: Response;
  try {
    if (!hit) throw notFound();
    const { route, m } = hit;
    if (!SAFE_METHODS.has(req.method) && !csrfOk(req, deps)) {
      res = errorResponse('csrf', 'リクエストを確認できませんでした。画面を開き直してください');
    } else {
      const cookieHeader = req.headers.get('cookie') ?? '';
      const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookieHeader)?.[1] ?? null;
      let principal: Principal | null = null;
      if (route.auth !== 'none') {
        principal = await authenticate(deps, token);
        if (!principal) throw new DomainError('unauthorized', 'ログインしてください');
        if (route.auth === 'household' && !principal.household) {
          throw new DomainError('no_household', 'グループを作成してください');
        }
      }
      const text = SAFE_METHODS.has(req.method) ? '' : await req.text();
      res = await route.handler({
        req,
        deps,
        params: m!.slice(1).map(decodeURIComponent),
        query: url.searchParams,
        body: text ? JSON.parse(text) : {},
        principal,
        household: principal?.household ?? null,
        sessionToken: token,
        cookies,
      });
    }
  } catch (err) {
    if (err instanceof DomainError) res = domainErrorResponse(err);
    else throw err;
  }
  return new Response(res.body, { status: res.status, headers: res.headers });
}

/** 応答の本文（試験では項目を自由に読むので、緩い形にしてある） */
export type ImagesBody = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ImagesClient {
  call(
    method: string,
    path: string,
    opts?: { body?: unknown; csrf?: boolean; origin?: boolean },
  ): Promise<{ status: number; body: ImagesBody; text: string }>;
  /** 画像の実体など、JSON でない応答を読む */
  raw(path: string): Promise<{ status: number; headers: Headers; bytes: Uint8Array }>;
  get(path: string): ReturnType<ImagesClient['call']>;
  post(path: string, body?: unknown): ReturnType<ImagesClient['call']>;
  put(path: string, body?: unknown): ReturnType<ImagesClient['call']>;
  del(path: string): ReturnType<ImagesClient['call']>;
}

/** sessionToken を持つ（または未ログインの）、ブラウザの代わり */
export function imagesClient(deps: AppDeps, sessionToken: string | null = null): ImagesClient {
  const request = (
    method: string,
    path: string,
    opts: { body?: unknown; csrf?: boolean; origin?: boolean } = {},
  ) => {
    const headers: Record<string, string> = {
      cookie: [`${CSRF_COOKIE}=${CSRF}`, sessionToken ? `${SESSION_COOKIE}=${sessionToken}` : '']
        .filter(Boolean)
        .join('; '),
    };
    if (opts.csrf !== false) headers[CSRF_HEADER] = CSRF;
    if (opts.origin !== false) headers.origin = ORIGIN;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return handleImages(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
      deps,
    );
  };
  const call: ImagesClient['call'] = async (method, path, opts = {}) => {
    const res = await request(method, path, opts);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  return {
    call,
    async raw(path) {
      const res = await request('GET', path);
      return {
        status: res.status,
        headers: res.headers,
        bytes: new Uint8Array(await res.arrayBuffer()),
      };
    },
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, { body: body ?? {} }),
    put: (path, body) => call('PUT', path, { body: body ?? {} }),
    del: (path) => call('DELETE', path),
  };
}
